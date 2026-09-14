import request from "supertest";
import { describe, expect, expectTypeOf, test, vi } from "vitest";

import { createApp } from "../app.js";
import type { RooftopProfileId } from "../config/storeWorkflowConfig.js";
import { parseAccountingMonth, type AccountingMonth } from "../domain/accountingMonth.js";
import type {
  ProfiledNewSourceFile,
  PersistReconciliationRunInput,
  ReconciliationResponse,
  SourceProcessingIdentity,
  TransactionSummary,
} from "../domain/types.js";
import type { UploadPreprocessingMetadata } from "../services/preprocessing/types.js";
import { migrate } from "../db/migrate.js";
import { withDatabaseTestLock } from "../testUtils/databaseTestLock.js";
import {
  createPool,
  PostgresTransactionRepository,
} from "./postgresTransactionRepository.js";
import {
  DuplicateSourceFileError,
  MemoryTransactionRepository,
  type TransactionRepository,
} from "./transactionRepository.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

const boaUploadCsv = (stockNumber: string, vin: string, amount: string, reference: string) =>
  `,,,9/26/2025,${reference},,${stockNumber},,${vin},,"${amount}",`;

const _dealertrackUploadCsv = (stockNumber: string, amount: string) =>
  `${stockNumber},"BOA FLOORPLAN",${amount},0`;

expectTypeOf<
  Pick<
    PersistReconciliationRunInput,
    "accounting_month" | "rooftop_profile_id" | "rooftop_profile_version"
  >
>().toEqualTypeOf<{
  accounting_month: AccountingMonth | null;
  rooftop_profile_id: RooftopProfileId | null;
  rooftop_profile_version: string | null;
}>();

describe("reusable source identity persistence", () => {
  test("memory repository round-trips profiled and legacy receipts by exact identity", async () => {
    await assertReusableSourceIdentityRoundTrip(new MemoryTransactionRepository(), "memory");
  });

  test("memory repository rejects duplicate legacy receipts", async () => {
    await assertDuplicateLegacyReceiptRejected(new MemoryTransactionRepository(), "memory");
  });

  test("memory repository differentiates receipts by rooftop profile version alone", async () => {
    await assertProfileVersionDifferentiation(new MemoryTransactionRepository(), "memory");
  });

  test("memory repository protects preprocessing receipts from caller mutation", async () => {
    await assertPreprocessingReceiptImmutability(new MemoryTransactionRepository(), "memory");
  });
});

describeIfDatabase("reusable source identity persistence in PostgreSQL", () => {
  test("round-trips profiled and legacy receipts by exact identity", async () => {
    await withPostgresIdentityRepository(assertReusableSourceIdentityRoundTrip);
  });

  test("rejects duplicate legacy receipts", async () => {
    await withPostgresIdentityRepository(assertDuplicateLegacyReceiptRejected);
  });

  test("differentiates receipts by rooftop profile version alone", async () => {
    await withPostgresIdentityRepository(assertProfileVersionDifferentiation);
  });

  test("protects preprocessing receipts from caller mutation", async () => {
    await withPostgresIdentityRepository(assertPreprocessingReceiptImmutability);
  });
});

describeIfDatabase("reconciliation persistence", () => {
  test("POST /reconcile persists run counts, match groups, transactions, and exceptions", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for reconciliation persistence tests.");
    }

    await withDatabaseTestLock(databaseUrl, async () => {
      await migrate(databaseUrl);
      const pool = createPool(databaseUrl);
      const repository = new PostgresTransactionRepository(pool);
      const app = createApp(repository, [], 1, async () => undefined, {
        nodeEnv: "test",
        allowDevDealershipFallback: true,
      });
      const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const unique = `${Date.now()}-${Math.random()}`;

      try {
        const boaUpload = await uploadCsv(
          app,
          "boa",
          [
            boaUploadCsv("M50101", "1HGCM82633A004352", "$100.00", `50101${unique}`),
            boaUploadCsv("M50202", "2HGCM82633A004352", "$222.00", `50202${unique}`),
          ].join("\n"),
          `boa-persist-${unique}.csv`,
          1,
        );

        const dealertrackUpload = await uploadCsv(
          app,
          "dealertrack",
          [
            "Control,Description,2100",
            `M50101,"BOA FLOORPLAN ${unique} 1HGCM82633A004352",100`,
            `M50303,"BOA FLOORPLAN ${unique}",333`,
          ].join("\n"),
          `dealertrack-persist-${unique}.csv`,
          1,
        );

        const response = await request(app).post("/reconcile").send({
          boa_source_file_id: boaUpload.source_file_id,
          dealertrack_source_file_id: dealertrackUpload.source_file_id,
          dealership_store_id: 1,
        });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          reconciliation_run_id: expect.any(Number),
          matched_count: 1,
          exception_count: 2,
          duplicate_count: 0,
        });

        const runId = response.body.reconciliation_run_id as number;
        const sourceFileListResponse = await request(app)
          .get("/source-files")
          .query({ source_type: "boa" });
        expect(sourceFileListResponse.status).toBe(200);
        expect(sourceFileListResponse.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source_file_id: boaUpload.source_file_id,
              source_type: "boa",
              filename: `boa-persist-${unique}.csv`,
            }),
          ]),
        );

        const runListResponse = await request(app).get("/reconciliation-runs");
        expect(runListResponse.status).toBe(200);
        expect(runListResponse.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              reconciliation_run_id: runId,
              boa_filename: `boa-persist-${unique}.csv`,
              dealertrack_filename: `dealertrack-persist-${unique}.csv`,
              matched_count: response.body.matched_count,
              exception_count: response.body.exception_count,
            }),
          ]),
        );

        const runDetailResponse = await request(app).get(`/reconciliation-runs/${runId}`);
        expect(runDetailResponse.status).toBe(200);
        expect(runDetailResponse.body).toMatchObject({
          reconciliation_run_id: runId,
          boa_source_file: {
            source_file_id: boaUpload.source_file_id,
            filename: `boa-persist-${unique}.csv`,
          },
          dealertrack_source_file: {
            source_file_id: dealertrackUpload.source_file_id,
            filename: `dealertrack-persist-${unique}.csv`,
          },
        });
        expect(runDetailResponse.body.match_groups).toHaveLength(1);
        expect(runDetailResponse.body.match_groups[0].transactions).toHaveLength(2);
        expect(runDetailResponse.body.exceptions).toHaveLength(2);
        expect(runDetailResponse.body.exceptions[0]).toMatchObject({
          status: "unresolved",
          note: "",
          review_status: "unreviewed",
          assigned_to: null,
          review_notes: "",
          reviewed_at: null,
          reviewed_by: null,
        });

        const artifactsResponse = await request(app).get(`/reconciliation-runs/${runId}/artifacts`);
        expect(artifactsResponse.status).toBe(200);
        expect(artifactsResponse.body.map((artifact: { artifact_type: string }) => artifact.artifact_type)).toEqual([
          "RAW_BOA",
          "RAW_DEALERTRACK",
          "CLEANED_BOA",
          "CLEANED_DEALERTRACK",
          "MERGED_FLOORPLAN",
          "FP_REC",
        ]);
        const artifactCount = await countRows(
          pool,
          "reconciliation_artifacts",
          "reconciliation_run_id",
          runId,
        );
        expect(artifactCount).toBe(6);

        const exceptionId = runDetailResponse.body.exceptions[0].exception_id as number;
        const reviewUpdateResponse = await request(app)
          .patch(`/reconciliation-runs/${runId}/exceptions/${exceptionId}`)
          .send({
            review_status: "ignored",
            assigned_to: "Alex",
            review_notes: "Accepted timing difference.",
            reviewed_by: "Alex",
          });
        expect(reviewUpdateResponse.status).toBe(200);
        expect(reviewUpdateResponse.body).toMatchObject({
          exception_id: exceptionId,
          status: "ignored",
          review_status: "ignored",
          assigned_to: "Alex",
          note: "Accepted timing difference.",
          review_notes: "Accepted timing difference.",
          reviewed_by: "Alex",
          reviewed_at: expect.any(String),
        });

        const statusFilterResponse = await request(app)
          .get(`/reconciliation-runs/${runId}`)
          .query({ status: "ignored" });
        expect(statusFilterResponse.status).toBe(200);
        expect(statusFilterResponse.body.exceptions).toEqual([
          expect.objectContaining({
            exception_id: exceptionId,
            status: "ignored",
            review_status: "ignored",
            assigned_to: "Alex",
            note: "Accepted timing difference.",
          }),
        ]);

        const runResult = await pool.query<{
          matched_count: number;
          exception_count: number;
          duplicate_count: number;
          status: string;
        }>(
          `SELECT matched_count, exception_count, duplicate_count, status
           FROM reconciliation_runs
           WHERE id = $1`,
          [runId],
        );
        expect(runResult.rows[0]).toEqual({
          matched_count: response.body.matched_count,
          exception_count: response.body.exception_count,
          duplicate_count: response.body.duplicate_count,
          status: "completed",
        });

        const matchGroupCount = await countRows(
          pool,
          "reconciliation_match_groups",
          "reconciliation_run_id",
          runId,
        );
        const matchGroupTransactionCount = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM reconciliation_match_group_transactions mgt
           JOIN reconciliation_match_groups mg ON mg.id = mgt.match_group_id
           WHERE mg.reconciliation_run_id = $1`,
          [runId],
        );
        const exceptionCount = await countRows(
          pool,
          "reconciliation_exceptions",
          "reconciliation_run_id",
          runId,
        );
        const exceptionReviewResult = await pool.query<{
          status: string;
          note: string;
          review_status: string;
          assigned_to: string | null;
          review_notes: string;
          reviewed_at: Date | null;
          reviewed_by: string | null;
        }>(
          `SELECT status, note, review_status, assigned_to, review_notes, reviewed_at, reviewed_by
           FROM reconciliation_exceptions
           WHERE id = $1`,
          [exceptionId],
        );

        expect(matchGroupCount).toBe(1);
        expect(Number(matchGroupTransactionCount.rows[0].count)).toBe(2);
        expect(exceptionCount).toBe(2);
        expect(exceptionReviewResult.rows[0]).toEqual({
          status: "ignored",
          note: "Accepted timing difference.",
          review_status: "ignored",
          assigned_to: "Alex",
          review_notes: "Accepted timing difference.",
          reviewed_at: expect.any(Date),
          reviewed_by: "Alex",
        });
      } finally {
        stderr.mockRestore();
        await pool.end();
      }
    });
  });

  test("rolls back the reconciliation run when match persistence fails", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for reconciliation persistence tests.");
    }

    await withDatabaseTestLock(databaseUrl, async () => {
      await migrate(databaseUrl);
      const pool = createPool(databaseUrl);
      const repository = new PostgresTransactionRepository(pool);
      const unique = `${Date.now()}-${Math.random()}`;

      try {
        const boaImport = await repository.createSourceFileWithTransactions(
          1,
          {
            source_type: "boa",
            original_filename: "boa-rollback.csv",
            stored_filename: null,
            file_hash: `rollback-boa-${unique}`,
            row_count: 1,
            validation_error_count: 0,
          },
          [
            {
              source_file_id: null,
              source_type: "boa",
              transaction_date: "2025-09-26",
              post_date: null,
              amount_cents: 10000,
              reference_number: "99101",
              description: "BOA floorplan",
              account: null,
              stock_number: "M99101",
              vin: "1HGCM82633A004352",
              raw_data: {},
            },
          ],
        );
        const dealertrackImport = await repository.createSourceFileWithTransactions(
          1,
          {
            source_type: "dealertrack",
            original_filename: "dealertrack-rollback.csv",
            stored_filename: null,
            file_hash: `rollback-dealertrack-${unique}`,
            row_count: 1,
            validation_error_count: 0,
          },
          [
            {
              source_file_id: null,
              source_type: "dealertrack",
              transaction_date: null,
              post_date: null,
              amount_cents: -10000,
              reference_number: null,
              description: "BOA FLOORPLAN",
              account: null,
              stock_number: "M99101",
              vin: null,
              raw_data: {},
            },
          ],
        );

        const invalidTransactionId =
          Math.max(boaImport.transactions[0].id, dealertrackImport.transactions[0].id) + 1_000_000;
        const failedResult: ReconciliationResponse = {
          matched_count: 1,
          exception_count: 0,
          duplicate_count: 0,
          match_groups: [
            {
              match_reason: "stock_number_amount",
              confidence_score: 0.92,
              transactions: [
                toSummary(boaImport.transactions[0]),
                {
                  ...toSummary(dealertrackImport.transactions[0]),
                  id: invalidTransactionId,
                },
              ],
            },
          ],
          exceptions: [],
          vin_presence_diagnostics: {
            extracted_vin_sets: { boa: [], dealertrack: [] },
            vin_presence_exceptions: {
              dealertrack_not_in_boa: [],
              boa_not_in_dealertrack: [],
            },
            transaction_unmatched_shared_vins: [],
          },
        };

        await expect(
          repository.createReconciliationRun({
            dealership_id: 1,
            boa_source_file_id: boaImport.sourceFile.id,
            dealertrack_source_file_id: dealertrackImport.sourceFile.id,
            accounting_month: null,
            rooftop_profile_id: null,
            rooftop_profile_version: null,
            result: failedResult,
          }),
        ).rejects.toThrow();

        const runResult = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM reconciliation_runs
           WHERE boa_source_file_id = $1
             AND dealertrack_source_file_id = $2`,
          [boaImport.sourceFile.id, dealertrackImport.sourceFile.id],
        );
        expect(Number(runResult.rows[0].count)).toBe(0);
      } finally {
        await pool.end();
      }
    });
  });
});

async function uploadCsv(
  app: ReturnType<typeof createApp>,
  sourceType: string,
  csv: string,
  filename: string,
  storeId?: number,
) {
  const uploadRequest = request(app)
    .post("/upload")
    .field("source_type", sourceType);
  if (sourceType === "boa" || sourceType === "dealertrack") {
    uploadRequest.field("accounting_month", "2026-04");
  }
  if (storeId) {
    uploadRequest.field("store_id", String(storeId));
  }
  const response = await uploadRequest.attach("file", Buffer.from(csv), filename);

  expect(response.status).toBe(200);
  return response.body as { source_file_id: number };
}

async function countRows(
  pool: ReturnType<typeof createPool>,
  tableName: string,
  columnName: string,
  value: number,
): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${tableName} WHERE ${columnName} = $1`,
    [value],
  );
  return Number(result.rows[0].count);
}

function toSummary(transaction: {
  id: number;
  dealership_id: number;
  source_type: TransactionSummary["source_type"];
  transaction_date: string | null;
  post_date: string | null;
  amount_cents: number;
  reference_number: string | null;
  description: string | null;
  account: string | null;
  account_type?: string;
  account_identifier?: string;
  stock_number: string | null;
  vin: string | null;
}): TransactionSummary {
  return {
    id: transaction.id,
    dealership_id: transaction.dealership_id,
    source_type: transaction.source_type,
    transaction_date: transaction.transaction_date,
    post_date: transaction.post_date,
    amount: (transaction.amount_cents / 100).toFixed(2),
    amount_cents: transaction.amount_cents,
    reference_number: transaction.reference_number,
    description: transaction.description,
    account: transaction.account,
    account_type: transaction.account_type ?? "floorplan",
    account_identifier: transaction.account_identifier ?? transaction.account ?? "floorplan",
    stock_number: transaction.stock_number,
    vin: transaction.vin,
  };
}

async function assertReusableSourceIdentityRoundTrip(
  repository: TransactionRepository,
  namespace: string,
): Promise<void> {
  const april = accountingMonth("2026-04");
  const may = accountingMonth("2026-05");
  const sharedHash = `task5-${namespace}-shared`;
  const legacyHash = `task5-${namespace}-legacy`;
  const dealertrackHash = `task5-${namespace}-dealertrack`;
  const aprilIdentity: SourceProcessingIdentity = {
    accounting_month: april,
    rooftop_profile_id: "acura-v1",
    rooftop_profile_version: "1",
    parser_name: "boa-csv",
    parser_version: "1",
    preprocessor_name: "boa-floorplan",
    preprocessor_version: "preprocessing-v1",
  };
  const mayIdentity: SourceProcessingIdentity = {
    ...aprilIdentity,
    accounting_month: may,
  };
  const newerProcessingIdentity: SourceProcessingIdentity = {
    ...aprilIdentity,
    parser_version: "2",
    preprocessor_version: "preprocessing-v2",
  };

  const legacy = await repository.createSourceFileWithTransactions(
    1,
    {
      dealership_store_id: 1,
      source_type: "boa",
      original_filename: "legacy.csv",
      stored_filename: null,
      file_hash: legacyHash,
      row_count: 0,
      validation_error_count: 0,
    },
    [],
  );
  expect(legacy.sourceFile).toMatchObject({
    accounting_month: null,
    rooftop_profile_id: null,
    rooftop_profile_version: null,
    parser_name: null,
    parser_version: null,
    preprocessor_name: null,
    preprocessor_version: null,
    preprocessing_metadata: null,
  });
  await expect(repository.getSourceFile(legacy.sourceFile.id)).resolves.toMatchObject({
    id: legacy.sourceFile.id,
    accounting_month: null,
    rooftop_profile_id: null,
    rooftop_profile_version: null,
    parser_name: null,
    parser_version: null,
    preprocessor_name: null,
    preprocessor_version: null,
    preprocessing_metadata: null,
  });
  await expect(
    repository.getReusableSourceFile(1, 1, "boa", legacyHash, aprilIdentity),
  ).resolves.toBeNull();

  const aprilMetadata = preprocessingMetadata(april, aprilIdentity, 2);
  const aprilReceipt = await repository.createSourceFileWithTransactions(
    1,
    profiledSourceFile("april.csv", sharedHash, aprilIdentity, aprilMetadata),
    [],
  );
  const mayReceipt = await repository.createSourceFileWithTransactions(
    1,
    profiledSourceFile(
      "may.csv",
      sharedHash,
      mayIdentity,
      preprocessingMetadata(may, mayIdentity, 3),
    ),
    [],
  );
  const newerProcessingReceipt = await repository.createSourceFileWithTransactions(
    1,
    profiledSourceFile(
      "april-reprocessed.csv",
      sharedHash,
      newerProcessingIdentity,
      preprocessingMetadata(april, newerProcessingIdentity, 4),
    ),
    [],
  );

  expect(new Set([
    aprilReceipt.sourceFile.id,
    mayReceipt.sourceFile.id,
    newerProcessingReceipt.sourceFile.id,
  ]).size).toBe(3);
  expect(aprilReceipt.sourceFile).toMatchObject({
    ...aprilIdentity,
    preprocessing_metadata: aprilMetadata,
  });
  expect(mayReceipt.sourceFile).toMatchObject(mayIdentity);
  expect(newerProcessingReceipt.sourceFile).toMatchObject(newerProcessingIdentity);

  const reusableApril = await repository.getReusableSourceFile(
    1,
    1,
    "boa",
    sharedHash,
    aprilIdentity,
  );
  expect(reusableApril).toMatchObject({
    id: aprilReceipt.sourceFile.id,
    ...aprilIdentity,
    preprocessing_metadata: aprilMetadata,
  });
  expect(reusableApril?.preprocessing_metadata?.removed_rows).toEqual([
    {
      source: "boa",
      source_row_number: 2,
      removal_reason: "zero_balance",
      key_values: { stock_number: "A100" },
    },
  ]);
  await expect(
    repository.getReusableSourceFile(1, 1, "boa", sharedHash, mayIdentity),
  ).resolves.toMatchObject({ id: mayReceipt.sourceFile.id, ...mayIdentity });
  await expect(
    repository.getReusableSourceFile(1, 1, "boa", sharedHash, newerProcessingIdentity),
  ).resolves.toMatchObject({
    id: newerProcessingReceipt.sourceFile.id,
    ...newerProcessingIdentity,
  });

  const sourceSummaries = await repository.listSourceFiles(1, "boa", 1);
  expect(sourceSummaries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source_file_id: aprilReceipt.sourceFile.id,
        ...aprilIdentity,
        preprocessing_metadata: aprilMetadata,
      }),
      expect.objectContaining({
        source_file_id: legacy.sourceFile.id,
        accounting_month: null,
        rooftop_profile_id: null,
        rooftop_profile_version: null,
        parser_name: null,
        parser_version: null,
        preprocessor_name: null,
        preprocessor_version: null,
        preprocessing_metadata: null,
      }),
    ]),
  );

  const dealertrackIdentity: SourceProcessingIdentity = {
    accounting_month: april,
    rooftop_profile_id: "acura-v1",
    rooftop_profile_version: "1",
    parser_name: "dealertrack-csv",
    parser_version: "1",
    preprocessor_name: "dealertrack-floorplan",
    preprocessor_version: "preprocessing-v1",
  };
  const dealertrackReceipt = await repository.createSourceFileWithTransactions(
    1,
    profiledSourceFile(
      "dealertrack.csv",
      dealertrackHash,
      dealertrackIdentity,
      preprocessingMetadata(april, dealertrackIdentity, 5, "dealertrack"),
      "dealertrack",
    ),
    [],
  );
  const run = await repository.createReconciliationRun({
    dealership_id: 1,
    dealership_store_id: 1,
    boa_source_file_id: aprilReceipt.sourceFile.id,
    dealertrack_source_file_id: dealertrackReceipt.sourceFile.id,
    accounting_month: april,
    rooftop_profile_id: "acura-v1",
    rooftop_profile_version: "1",
    result: emptyReconciliationResult(),
  });
  expect(run).toMatchObject({
    accounting_month: april,
    rooftop_profile_id: "acura-v1",
    rooftop_profile_version: "1",
  });
  await expect(repository.listReconciliationRuns(1, { dealershipStoreId: 1 })).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        reconciliation_run_id: run.id,
        accounting_month: april,
        rooftop_profile_id: "acura-v1",
        rooftop_profile_version: "1",
      }),
    ]),
  );
  await expect(repository.getReconciliationRunDetail(1, run.id)).resolves.toMatchObject({
    reconciliation_run_id: run.id,
    accounting_month: april,
    rooftop_profile_id: "acura-v1",
    rooftop_profile_version: "1",
    boa_source_file: expect.objectContaining({
      source_file_id: aprilReceipt.sourceFile.id,
      ...aprilIdentity,
      preprocessing_metadata: aprilMetadata,
    }),
    dealertrack_source_file: expect.objectContaining({
      source_file_id: dealertrackReceipt.sourceFile.id,
      ...dealertrackIdentity,
    }),
  });
}

async function assertDuplicateLegacyReceiptRejected(
  repository: TransactionRepository,
  namespace: string,
): Promise<void> {
  const fileHash = `task5-${namespace}-legacy-duplicate`;
  const legacySource = {
    dealership_store_id: 1,
    source_type: "boa" as const,
    original_filename: "legacy.csv",
    stored_filename: null,
    file_hash: fileHash,
    row_count: 0,
    validation_error_count: 0,
  };

  await repository.createSourceFileWithTransactions(1, legacySource, []);
  await expect(
    repository.createSourceFileWithTransactions(
      1,
      { ...legacySource, original_filename: "legacy-copy.csv" },
      [],
    ),
  ).rejects.toBeInstanceOf(DuplicateSourceFileError);
}

async function assertProfileVersionDifferentiation(
  repository: TransactionRepository,
  namespace: string,
): Promise<void> {
  const month = accountingMonth("2026-04");
  const fileHash = `task5-${namespace}-profile-version`;
  const versionOne: SourceProcessingIdentity = {
    accounting_month: month,
    rooftop_profile_id: "acura-v1",
    rooftop_profile_version: "1",
    parser_name: "boa-csv",
    parser_version: "1",
    preprocessor_name: "boa-floorplan",
    preprocessor_version: "preprocessing-v1",
  };
  const versionTwo: SourceProcessingIdentity = {
    ...versionOne,
    rooftop_profile_version: "2",
  };

  const first = await repository.createSourceFileWithTransactions(
    1,
    profiledSourceFile(
      "profile-v1.csv",
      fileHash,
      versionOne,
      preprocessingMetadata(month, versionOne, 6),
    ),
    [],
  );
  const second = await repository.createSourceFileWithTransactions(
    1,
    profiledSourceFile(
      "profile-v2.csv",
      fileHash,
      versionTwo,
      preprocessingMetadata(month, versionTwo, 7),
    ),
    [],
  );

  expect(second.sourceFile.id).not.toBe(first.sourceFile.id);
  await expect(
    repository.getReusableSourceFile(1, 1, "boa", fileHash, versionOne),
  ).resolves.toMatchObject({ id: first.sourceFile.id, rooftop_profile_version: "1" });
  await expect(
    repository.getReusableSourceFile(1, 1, "boa", fileHash, versionTwo),
  ).resolves.toMatchObject({ id: second.sourceFile.id, rooftop_profile_version: "2" });
}

async function assertPreprocessingReceiptImmutability(
  repository: TransactionRepository,
  namespace: string,
): Promise<void> {
  const month = accountingMonth("2026-04");
  const fileHash = `task5-${namespace}-immutable-receipt`;
  const dealertrackHash = `task5-${namespace}-immutable-dealertrack`;
  const identity: SourceProcessingIdentity = {
    accounting_month: month,
    rooftop_profile_id: "acura-v1",
    rooftop_profile_version: "1",
    parser_name: "boa-csv",
    parser_version: "1",
    preprocessor_name: "boa-floorplan",
    preprocessor_version: "preprocessing-v1",
  };
  const metadata = preprocessingMetadata(month, identity, 8);
  const created = await repository.createSourceFileWithTransactions(
    1,
    profiledSourceFile("immutable.csv", fileHash, identity, metadata),
    [],
  );

  mutateReceipt(metadata);
  await expectOriginalReceipt(repository, fileHash, identity);

  mutateReceipt(created.sourceFile.preprocessing_metadata);
  await expectOriginalReceipt(repository, fileHash, identity);

  const directRead = await repository.getSourceFile(created.sourceFile.id);
  expect(directRead).not.toBeNull();
  mutateReceipt(directRead?.preprocessing_metadata ?? null);
  await expectOriginalReceipt(repository, fileHash, identity);

  const compatibilityRead = await repository.getSourceFileByHash(1, 1, "boa", fileHash);
  expect(compatibilityRead).not.toBeNull();
  mutateReceipt(compatibilityRead?.preprocessing_metadata ?? null);
  await expectOriginalReceipt(repository, fileHash, identity);

  const reusableRead = await repository.getReusableSourceFile(1, 1, "boa", fileHash, identity);
  expect(reusableRead).not.toBeNull();
  mutateReceipt(reusableRead?.preprocessing_metadata ?? null);
  await expectOriginalReceipt(repository, fileHash, identity);

  const listedRead = (await repository.listSourceFiles(1, "boa", 1)).find(
    (sourceFile) => sourceFile.source_file_id === created.sourceFile.id,
  );
  expect(listedRead).toBeDefined();
  mutateReceipt(listedRead?.preprocessing_metadata ?? null);
  await expectOriginalReceipt(repository, fileHash, identity);

  const dealertrackIdentity: SourceProcessingIdentity = {
    ...identity,
    parser_name: "dealertrack-csv",
    preprocessor_name: "dealertrack-floorplan",
  };
  const dealertrack = await repository.createSourceFileWithTransactions(
    1,
    profiledSourceFile(
      "immutable-dealertrack.csv",
      dealertrackHash,
      dealertrackIdentity,
      preprocessingMetadata(month, dealertrackIdentity, 9, "dealertrack"),
      "dealertrack",
    ),
    [],
  );
  const run = await repository.createReconciliationRun({
    dealership_id: 1,
    dealership_store_id: 1,
    boa_source_file_id: created.sourceFile.id,
    dealertrack_source_file_id: dealertrack.sourceFile.id,
    accounting_month: month,
    rooftop_profile_id: "acura-v1",
    rooftop_profile_version: "1",
    result: emptyReconciliationResult(),
  });
  const detailRead = await repository.getReconciliationRunDetail(1, run.id);
  expect(detailRead).not.toBeNull();
  mutateReceipt(detailRead?.boa_source_file.preprocessing_metadata ?? null);
  await expectOriginalReceipt(repository, fileHash, identity);

  const replacementMetadata = preprocessingMetadata(month, identity, 8);
  const replaced = await repository.replaceSourceFileWithTransactions(
    1,
    created.sourceFile.id,
    profiledSourceFile("immutable-replaced.csv", fileHash, identity, replacementMetadata),
    [],
  );
  expect(replaced).not.toBeNull();
  mutateReceipt(replacementMetadata);
  await expectOriginalReceipt(repository, fileHash, identity);
  mutateReceipt(replaced?.sourceFile.preprocessing_metadata ?? null);
  await expectOriginalReceipt(repository, fileHash, identity);
}

async function expectOriginalReceipt(
  repository: TransactionRepository,
  fileHash: string,
  identity: SourceProcessingIdentity,
): Promise<void> {
  const stored = await repository.getReusableSourceFile(1, 1, "boa", fileHash, identity);
  expect(stored?.preprocessing_metadata?.removed_rows).toEqual([
    {
      source: "boa",
      source_row_number: 8,
      removal_reason: "zero_balance",
      key_values: { stock_number: "A100" },
    },
  ]);
}

function mutateReceipt(metadata: UploadPreprocessingMetadata | null): void {
  if (metadata) {
    metadata.removed_rows[0].key_values.stock_number = "MUTATED";
  }
}

async function withPostgresIdentityRepository(
  assertion: (repository: TransactionRepository, namespace: string) => Promise<void>,
): Promise<void> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for reconciliation persistence tests.");
  }

  await withDatabaseTestLock(databaseUrl, async () => {
    await migrate(databaseUrl);
    const pool = createPool(databaseUrl);
    const repository = new PostgresTransactionRepository(pool);
    const namespace = `postgres-${Date.now()}-${Math.random()}`;
    try {
      await assertion(repository, namespace);
    } finally {
      await pool.query("DELETE FROM source_files WHERE file_hash LIKE $1", [
        `task5-${namespace}-%`,
      ]);
      await pool.end();
    }
  });
}

function accountingMonth(value: string): AccountingMonth {
  const month = parseAccountingMonth(value);
  if (!month) {
    throw new Error(`Invalid accounting month fixture: ${value}`);
  }
  return month;
}

function profiledSourceFile(
  filename: string,
  fileHash: string,
  identity: SourceProcessingIdentity,
  metadata: UploadPreprocessingMetadata,
  sourceType: ProfiledNewSourceFile["source_type"] = "boa",
): ProfiledNewSourceFile {
  return {
    dealership_store_id: 1,
    source_type: sourceType,
    original_filename: filename,
    stored_filename: null,
    file_hash: fileHash,
    row_count: 1,
    validation_error_count: 0,
    ...identity,
    preprocessing_metadata: metadata,
  };
}

function preprocessingMetadata(
  month: AccountingMonth,
  identity: SourceProcessingIdentity,
  removedRowNumber: number,
  source: "boa" | "dealertrack" = "boa",
): UploadPreprocessingMetadata {
  return {
    detected_format: "csv",
    detection_confidence: "high",
    detection_reason: "csv fixture",
    parser_route: source === "boa" ? "boa_csv" : "dealertrack_csv",
    preprocessing_version: identity.preprocessor_version,
    summary: {
      source_kind: source,
      preprocessing_version: identity.preprocessor_version,
      parser_name: source === "boa" ? "boa-csv" : "dealertrack-csv",
      parser_version: identity.parser_version,
      parser_format: "csv",
      preprocessor_name: source === "boa" ? "boa-floorplan" : "dealertrack-floorplan",
      preprocessor_version: identity.preprocessor_version,
      period_evidence: {
        source,
        selectedMonth: month,
        explicitMonths: [month],
        observedDateRange: { min: `${month}-01`, max: `${month}-30` },
        filenameHint: month,
        status: "confirmed",
        safeEvidence: { fixture: true },
      },
      rows_scanned: 2,
      rows_accepted: 1,
      rows_removed_zero_balance: 1,
      rows_removed_straightline: 0,
      rows_removed_banner: 0,
      rows_skipped_unknown: 0,
      rows_requiring_manual_enrichment: 0,
      duplicate_vin6_count: 0,
      preprocessed_at: "2026-09-14T12:00:00.000Z",
    },
    diagnostics: [
      {
        kind: "zero_balance_row_removed",
        message: "Removed zero-balance fixture row.",
        source_row_number: removedRowNumber,
        stock_number: "A100",
      },
    ],
    removed_rows: [
      {
        source,
        source_row_number: removedRowNumber,
        removal_reason: "zero_balance",
        key_values: { stock_number: "A100" },
      },
    ],
    legacy_csv_path: false,
    unsupported_reason: null,
  };
}

function emptyReconciliationResult(): ReconciliationResponse {
  return {
    matched_count: 0,
    exception_count: 0,
    duplicate_count: 0,
    match_groups: [],
    exceptions: [],
    vin_presence_diagnostics: {
      extracted_vin_sets: { boa: [], dealertrack: [] },
      vin_presence_exceptions: {
        dealertrack_not_in_boa: [],
        boa_not_in_dealertrack: [],
      },
      transaction_unmatched_shared_vins: [],
    },
  };
}
