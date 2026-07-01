import request from "supertest";
import { describe, expect, test, vi } from "vitest";

import { createApp } from "../app.js";
import type { ReconciliationResponse, TransactionSummary } from "../domain/types.js";
import { migrate } from "../db/migrate.js";
import { withDatabaseTestLock } from "../testUtils/databaseTestLock.js";
import {
  createPool,
  PostgresTransactionRepository,
} from "./postgresTransactionRepository.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

const boaUploadCsv = (stockNumber: string, vin: string, amount: string, reference: string) =>
  `,,,9/26/2025,${reference},,${stockNumber},,${vin},,"${amount}",`;

const _dealertrackUploadCsv = (stockNumber: string, amount: string) =>
  `${stockNumber},"BOA FLOORPLAN",${amount},0`;

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
