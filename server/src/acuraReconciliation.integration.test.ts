import { readFileSync } from "node:fs";
import { basename } from "node:path";

import request from "supertest";
import { describe, expect, test, vi } from "vitest";

import {
  MemoryAuthRepository,
  type AuthRole,
} from "./auth.js";
import {
  compareFpRecSemantics,
  type ExpectedFpRecSemantics,
} from "./acceptance/acuraEvidence.js";
import { createApp } from "./app.js";
import {
  REQUIRED_RECONCILIATION_ARTIFACT_TYPES,
} from "./config/storeWorkflowConfig.js";
import { migrate } from "./db/migrate.js";
import type {
  NewReconciliationArtifact,
  ReconciliationArtifactMetadata,
  SourceFile,
} from "./domain/types.js";
import type { FpRecWorkbook } from "./presenters/fpRec.js";
import type { MergedFloorplanWorkbook } from "./presenters/mergedFloorplan.js";
import {
  createPool,
  PostgresTransactionRepository,
} from "./repositories/postgresTransactionRepository.js";
import {
  ACURA_SANITIZED_FIXTURE_PATHS,
  loadAcuraSanitizedContract,
} from "./testFixtures/acura/index.js";
import { withDisposablePostgresDatabase } from "./testUtils/disposablePostgresDatabase.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const accountingMonth = "2026-04";
const sessionSecret = "task-10-integration-session-secret";

class ForcedBatchFailureRepository extends PostgresTransactionRepository {
  private readonly batchStarted: Promise<number>;
  private signalBatchStarted: ((runId: number) => void) | null = null;
  private readonly releaseBatch: Promise<void>;
  private releaseBatchNow: (() => void) | null = null;

  constructor(pool: ReturnType<typeof createPool>) {
    super(pool);
    this.batchStarted = new Promise((resolve) => {
      this.signalBatchStarted = resolve;
    });
    this.releaseBatch = new Promise((resolve) => {
      this.releaseBatchNow = resolve;
    });
  }

  waitForBatchStart(): Promise<number> {
    return this.batchStarted;
  }

  forceFailure(): void {
    this.releaseBatchNow?.();
  }

  override async createReconciliationArtifactBatch(
    dealershipId: number,
    artifacts: NewReconciliationArtifact[],
  ): Promise<ReconciliationArtifactMetadata[]> {
    const reconciliationRunId = artifacts[0]?.reconciliation_run_id;
    if (!reconciliationRunId) {
      throw new Error("Forced artifact failure requires a reconciliation run.");
    }
    this.signalBatchStarted?.(reconciliationRunId);
    await this.releaseBatch;

    const invalidBatch = artifacts.map((artifact, index) =>
      index === artifacts.length - 1
        ? {
            ...artifact,
            file_size: 1,
            content: null as unknown as Buffer,
          }
        : artifact,
    );
    return super.createReconciliationArtifactBatch(dealershipId, invalidBatch);
  }
}

describeIfDatabase("Acura reconciliation PostgreSQL vertical slice", () => {
  test("persists immutable provenance, complete terminal artifacts, atomic failures, and authorization boundaries", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for the Acura reconciliation integration test.");
    }

    const adminPool = createPool(databaseUrl);
    const disposableDatabaseNames: string[] = [];
    try {
      for (let execution = 0; execution < 2; execution += 1) {
        await withDisposablePostgresDatabase(
          databaseUrl,
          async (disposableDatabaseUrl, disposableDatabaseName) => {
            disposableDatabaseNames.push(disposableDatabaseName);
            await runAcuraVerticalSlice(disposableDatabaseUrl);
          },
        );
      }

      expect(new Set(disposableDatabaseNames).size).toBe(2);
      const remainingDatabases = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM pg_database WHERE datname = ANY($1::text[])",
        [disposableDatabaseNames],
      );
      expect(Number(remainingDatabases.rows[0]!.count)).toBe(0);
    } finally {
      await adminPool.end();
    }
  }, 120_000);
});

async function runAcuraVerticalSlice(databaseUrl: string): Promise<void> {
  await migrate(databaseUrl);
  const pool = createPool(databaseUrl);
  const repository = new PostgresTransactionRepository(pool);
  const authRepository = new MemoryAuthRepository();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let failingRepository: ForcedBatchFailureRepository | null = null;

  try {
        const acuraStore = await repository.createDealershipStore(1, { name: "Hiley Acura" });
        const disabledStore = await repository.createDealershipStore(1, {
          name: "Hiley Cars Fort Worth",
        });
        const otherDealership = await pool.query<{ id: number }>(
          "INSERT INTO dealerships (name) VALUES ($1) RETURNING id",
          [`Task 10 dealership ${suffix}`],
        );
        const otherDealershipId = otherDealership.rows[0]!.id;
        const otherDealershipStore = await repository.createDealershipStore(
          otherDealershipId,
          { name: "Hiley Mazda of Hurst" },
        );

        await addAuthUser(pool, authRepository, {
          email: `task10-allowed-${suffix}@example.test`,
          password: "allowed-password",
          dealershipId: 1,
          role: "accounting_user",
          storeIds: [acuraStore.id, disabledStore.id],
        });
        await addAuthUser(pool, authRepository, {
          email: `task10-other-store-${suffix}@example.test`,
          password: "other-store-password",
          dealershipId: 1,
          role: "accounting_user",
          storeIds: [1],
        });
        await addAuthUser(pool, authRepository, {
          email: `task10-other-dealership-${suffix}@example.test`,
          password: "other-dealership-password",
          dealershipId: otherDealershipId,
          role: "platform_admin",
          storeIds: [],
        });
        const app = createApp(repository, [], 1, async () => undefined, {
          authRepository,
          sessionSecret,
          nodeEnv: "test",
          allowDevDealershipFallback: false,
        });
        const allowedAgent = request.agent(app);
        const otherStoreAgent = request.agent(app);
        const otherDealershipAgent = request.agent(app);
        await login(allowedAgent, `task10-allowed-${suffix}@example.test`, "allowed-password");
        await login(
          otherStoreAgent,
          `task10-other-store-${suffix}@example.test`,
          "other-store-password",
        );
        await login(
          otherDealershipAgent,
          `task10-other-dealership-${suffix}@example.test`,
          "other-dealership-password",
        );

        const boaBuffer = readFileSync(ACURA_SANITIZED_FIXTURE_PATHS.boaCsv);
        const dealertrackBuffer = readFileSync(ACURA_SANITIZED_FIXTURE_PATHS.dealertrackCsv);
        const contract = loadAcuraSanitizedContract();

        const boaUpload = await uploadFixture(
          allowedAgent,
          "boa",
          boaBuffer,
          basename(ACURA_SANITIZED_FIXTURE_PATHS.boaCsv),
          acuraStore.id,
          accountingMonth,
        );
        const dealertrackUpload = await uploadFixture(
          allowedAgent,
          "dealertrack",
          dealertrackBuffer,
          basename(ACURA_SANITIZED_FIXTURE_PATHS.dealertrackCsv),
          acuraStore.id,
          accountingMonth,
        );

        expect(boaUpload.status).toBe(200);
        expect(dealertrackUpload.status).toBe(200);
        expect(boaUpload.body).toMatchObject({
          reused_existing_file: false,
          transaction_count: contract.counts.boaAccepted,
          accounting_month: accountingMonth,
          rooftop_profile_id: "acura-v1",
          rooftop_profile_version: "1",
          parser_name: "boa-csv",
          parser_version: "1",
          preprocessor_name: "boa-floorplan",
          preprocessor_version: "preprocessing-v1",
        });
        expect(dealertrackUpload.body).toMatchObject({
          reused_existing_file: false,
          transaction_count: contract.counts.dealertrackAccepted,
          accounting_month: accountingMonth,
          rooftop_profile_id: "acura-v1",
          rooftop_profile_version: "1",
          parser_name: "dealertrack-csv",
          parser_version: "1",
          preprocessor_name: "dealertrack-floorplan",
          preprocessor_version: "preprocessing-v1",
        });

        const boaSourceFileId = boaUpload.body.source_file_id as number;
        const dealertrackSourceFileId = dealertrackUpload.body.source_file_id as number;
        const [boaSource, dealertrackSource, boaSourceSnapshot, dealertrackSourceSnapshot] =
          await Promise.all([
            repository.getSourceFile(boaSourceFileId),
            repository.getSourceFile(dealertrackSourceFileId),
            repository.getSourceFileUploadContent(1, boaSourceFileId),
            repository.getSourceFileUploadContent(1, dealertrackSourceFileId),
          ]);
        assertPersistedSource(boaSource, {
          sourceType: "boa",
          parserName: "boa-csv",
          preprocessorName: "boa-floorplan",
          acceptedRows: contract.counts.boaAccepted,
        });
        assertPersistedSource(dealertrackSource, {
          sourceType: "dealertrack",
          parserName: "dealertrack-csv",
          preprocessorName: "dealertrack-floorplan",
          acceptedRows: contract.counts.dealertrackAccepted,
        });
        expect(boaSource?.preprocessing_metadata?.removed_rows.map((row) => row.removal_reason))
          .toEqual(expect.arrayContaining([
            "Banner/header/subtotal row",
            "Zero balance — excluded from reconciliation",
            "Straightline row — excluded from reconciliation",
          ]));
        expect(dealertrackSource?.preprocessing_metadata?.removed_rows.map((row) => row.removal_reason))
          .toContain("Zero balance — excluded from reconciliation");
        expect(boaSourceSnapshot).toMatchObject({
          source_file_id: boaSourceFileId,
          dealership_store_id: acuraStore.id,
          file_size: boaBuffer.byteLength,
        });
        expect(dealertrackSourceSnapshot).toMatchObject({
          source_file_id: dealertrackSourceFileId,
          dealership_store_id: acuraStore.id,
          file_size: dealertrackBuffer.byteLength,
        });
        expect(boaSourceSnapshot?.content.equals(boaBuffer)).toBe(true);
        expect(dealertrackSourceSnapshot?.content.equals(dealertrackBuffer)).toBe(true);

        const immutableReceipt = structuredClone(boaUpload.body.preprocessing);
        const firstDuplicate = await uploadFixture(
          allowedAgent,
          "boa",
          boaBuffer,
          basename(ACURA_SANITIZED_FIXTURE_PATHS.boaCsv),
          acuraStore.id,
          accountingMonth,
        );
        expect(firstDuplicate.status).toBe(200);
        expect(firstDuplicate.body).toMatchObject({
          source_file_id: boaSourceFileId,
          reused_existing_file: true,
          preprocessing: immutableReceipt,
        });
        firstDuplicate.body.preprocessing.removed_rows.length = 0;
        const secondDuplicate = await uploadFixture(
          allowedAgent,
          "boa",
          boaBuffer,
          basename(ACURA_SANITIZED_FIXTURE_PATHS.boaCsv),
          acuraStore.id,
          accountingMonth,
        );
        expect(secondDuplicate.body.preprocessing).toEqual(immutableReceipt);
        expect(await countSourceRows(pool, acuraStore.id, "boa")).toBe(1);

        const noRunCount = await countRuns(pool, acuraStore.id);
        const mismatchedUpload = await uploadFixture(
          allowedAgent,
          "boa",
          boaBuffer,
          basename(ACURA_SANITIZED_FIXTURE_PATHS.boaCsv),
          acuraStore.id,
          "2026-03",
        );
        expect(mismatchedUpload.status).toBe(422);
        expect(mismatchedUpload.body.error).toMatchObject({ code: "SOURCE_PERIOD_MISMATCH" });
        expect(await countRuns(pool, acuraStore.id)).toBe(noRunCount);
        expect(await countSourceRows(pool, acuraStore.id, "boa")).toBe(1);

        const periodRejectedRun = await allowedAgent.post("/reconcile").send({
          boa_source_file_id: boaSourceFileId,
          dealertrack_source_file_id: dealertrackSourceFileId,
          dealership_store_id: acuraStore.id,
          accounting_month: "2026-03",
        });
        expect(periodRejectedRun.status).toBe(422);
        expect(periodRejectedRun.body.error).toMatchObject({
          code: "RECONCILIATION_SOURCE_IDENTITY_MISMATCH",
        });
        expect(await countRuns(pool, acuraStore.id)).toBe(noRunCount);

        const profileRejectedRun = await allowedAgent.post("/reconcile").send({
          boa_source_file_id: boaSourceFileId,
          dealertrack_source_file_id: dealertrackSourceFileId,
          dealership_store_id: disabledStore.id,
          accounting_month: accountingMonth,
        });
        expect(profileRejectedRun.status).toBe(422);
        expect(profileRejectedRun.body.error).toMatchObject({
          code: "ROOFTOP_PROFILE_UNSUPPORTED",
          details: { rooftop_profile_id: "fw-v0" },
        });
        expect(await countRuns(pool, acuraStore.id)).toBe(noRunCount);
        expect(await countRuns(pool, disabledStore.id)).toBe(0);

        const firstRun = await reconcile(
          allowedAgent,
          boaSourceFileId,
          dealertrackSourceFileId,
          acuraStore.id,
        );
        const secondRun = await reconcile(
          allowedAgent,
          boaSourceFileId,
          dealertrackSourceFileId,
          acuraStore.id,
        );
        expect(firstRun.status).toBe(200);
        expect(secondRun.status).toBe(200);
        expect(firstRun.body).toMatchObject({
          accounting_month: accountingMonth,
          rooftop_profile_id: "acura-v1",
          rooftop_profile_version: "1",
          matched_count: contract.counts.matched,
          duplicate_count: contract.counts.duplicateCandidates,
        });
        expect(secondRun.body.reconciliation_run_id).not.toBe(
          firstRun.body.reconciliation_run_id,
        );

        const firstRunId = firstRun.body.reconciliation_run_id as number;
        const secondRunId = secondRun.body.reconciliation_run_id as number;
        const [firstDetail, secondDetail] = await Promise.all([
          allowedAgent.get(`/reconciliation-runs/${firstRunId}`),
          allowedAgent.get(`/reconciliation-runs/${secondRunId}`),
        ]);
        for (const detail of [firstDetail, secondDetail]) {
          expect(detail.status).toBe(200);
          expect(detail.body).toMatchObject({
            dealership_store_id: acuraStore.id,
            boa_source_file_id: boaSourceFileId,
            dealertrack_source_file_id: dealertrackSourceFileId,
            status: "completed",
            accounting_month: accountingMonth,
            rooftop_profile_id: "acura-v1",
            rooftop_profile_version: "1",
          });
        }

        const snapshotResponse = await allowedAgent.get(
          `/reconciliation-runs/${firstRunId}/snapshot`,
        );
        expect(snapshotResponse.status).toBe(200);
        expect(snapshotResponse.body.inputs).toEqual([
          expect.objectContaining({
            side: "boa",
            source_file_id: boaSourceFileId,
            parser_version: "1",
            parser_metadata: expect.objectContaining({
              parser_name: "boa-csv",
              preprocessor_name: "boa-floorplan",
              accounting_month: accountingMonth,
              rooftop_profile_id: "acura-v1",
              preprocessing_metadata: immutableReceipt,
            }),
            transactions: expect.any(Array),
          }),
          expect.objectContaining({
            side: "dealertrack",
            source_file_id: dealertrackSourceFileId,
            parser_version: "1",
            parser_metadata: expect.objectContaining({
              parser_name: "dealertrack-csv",
              preprocessor_name: "dealertrack-floorplan",
              accounting_month: accountingMonth,
              rooftop_profile_id: "acura-v1",
              preprocessing_metadata: dealertrackUpload.body.preprocessing,
            }),
            transactions: expect.any(Array),
          }),
        ]);
        for (const input of snapshotResponse.body.inputs as Array<{
          transactions: Array<{ raw_data: Record<string, unknown> }>;
        }>) {
          expect(input.transactions.length).toBeGreaterThan(0);
          for (const transaction of input.transactions) {
            expect(transaction.raw_data).toMatchObject({
              __lineage: {
                raw_row_snapshot: expect.any(Object),
                retained_reason: expect.any(String),
                transformations: expect.any(Array),
              },
            });
          }
        }

        const replayResponse = await allowedAgent.get(`/reconciliation-runs/${firstRunId}/replay`);
        expect(replayResponse.status).toBe(200);
        expect(replayResponse.body).toMatchObject({
          reconciliation_run_id: firstRunId,
          results_changed: false,
          parser_version_difference: expect.arrayContaining([
            {
              side: "boa",
              original: snapshotResponse.body.inputs[0].parser_version,
              current: "1",
              differs: false,
            },
            {
              side: "dealertrack",
              original: snapshotResponse.body.inputs[1].parser_version,
              current: "1",
              differs: false,
            },
          ]),
        });

        const artifactsResponse = await allowedAgent.get(
          `/reconciliation-runs/${firstRunId}/artifacts`,
        );
        expect(artifactsResponse.status).toBe(200);
        expect(artifactsResponse.body.map((artifact: { artifact_type: string }) => artifact.artifact_type))
          .toEqual(REQUIRED_RECONCILIATION_ARTIFACT_TYPES);
        for (const artifact of artifactsResponse.body as Array<{
          id: number;
          artifact_type: string;
          file_size: number;
        }>) {
          expect(artifact.file_size).toBeGreaterThan(0);
          const download = await allowedAgent.get(`/artifacts/${artifact.id}/download`);
          expect(download.status).toBe(200);
          expect(responseByteLength(download)).toBeGreaterThan(0);
        }

        const artifactsByType = new Map(
          (artifactsResponse.body as Array<{ id: number; artifact_type: string }>).map(
            (artifact) => [artifact.artifact_type, artifact],
          ),
        );
        const regeneratedMergedJson = await allowedAgent
          .get(`/reconciliation-runs/${firstRunId}/merged-floorplan`)
          .query({ store_key: "acura", format: "json" });
        const regeneratedMergedHtml = await allowedAgent
          .get(`/reconciliation-runs/${firstRunId}/merged-floorplan`)
          .query({ store_key: "acura" });
        const storedMerged = await allowedAgent.get(
          `/artifacts/${artifactsByType.get("MERGED_FLOORPLAN")!.id}/download`,
        );
        expect(regeneratedMergedJson.status).toBe(200);
        const regeneratedMerged = regeneratedMergedJson.body as MergedFloorplanWorkbook;
        expect(regeneratedMerged).toMatchObject({
          headers: contract.mergedHeaders,
          boa_total_amount_cents: contract.totals.boaCents,
          dealertrack_total_amount_cents: contract.totals.dealertrackCents,
        });
        expect(regeneratedMerged.rows).toHaveLength(
          contract.counts.boaAccepted + contract.counts.dealertrackAccepted - contract.counts.matched,
        );
        expect(regeneratedMergedHtml.text).toBe(storedMerged.text);

        const regeneratedFpRecJson = await allowedAgent
          .get(`/reconciliation-runs/${firstRunId}/fp-rec`)
          .query({ store_key: "acura", format: "json" });
        const regeneratedFpRecHtml = await allowedAgent
          .get(`/reconciliation-runs/${firstRunId}/fp-rec`)
          .query({ store_key: "acura" });
        const storedFpRec = await allowedAgent.get(
          `/artifacts/${artifactsByType.get("FP_REC")!.id}/download`,
        );
        expect(regeneratedFpRecJson.status).toBe(200);
        const regeneratedFpRec = regeneratedFpRecJson.body as FpRecWorkbook;
        const expectedFpRec = expectedFpRecSemantics(regeneratedFpRec);
        expect(compareFpRecSemantics(
          regeneratedFpRec,
          expectedFpRec,
          storedFpRec.text,
        )).toEqual([]);
        expect(regeneratedFpRecHtml.text).toBe(storedFpRec.text);

        const forbiddenStoreUpload = await uploadFixture(
          otherStoreAgent,
          "boa",
          boaBuffer,
          basename(ACURA_SANITIZED_FIXTURE_PATHS.boaCsv),
          acuraStore.id,
          accountingMonth,
        );
        const forbiddenStoreRun = await otherStoreAgent.post("/reconcile").send({
          boa_source_file_id: boaSourceFileId,
          dealertrack_source_file_id: dealertrackSourceFileId,
          dealership_store_id: acuraStore.id,
          accounting_month: accountingMonth,
        });
        const forbiddenStoreDownload = await otherStoreAgent.get(
          `/artifacts/${artifactsByType.get("FP_REC")!.id}/download`,
        );
        expect(forbiddenStoreUpload.status).toBe(403);
        expect(forbiddenStoreUpload.body.error).toMatchObject({ code: "STORE_ACCESS_DENIED" });
        expect(forbiddenStoreRun.status).toBe(403);
        expect(forbiddenStoreRun.body.error).toMatchObject({ code: "STORE_ACCESS_DENIED" });
        expect(forbiddenStoreDownload.status).toBe(403);
        expect(forbiddenStoreDownload.body.error).toMatchObject({ code: "STORE_ACCESS_DENIED" });

        const crossDealershipUpload = await uploadFixture(
          otherDealershipAgent,
          "boa",
          boaBuffer,
          basename(ACURA_SANITIZED_FIXTURE_PATHS.boaCsv),
          acuraStore.id,
          accountingMonth,
        );
        const crossDealershipRun = await otherDealershipAgent.post("/reconcile").send({
          boa_source_file_id: boaSourceFileId,
          dealertrack_source_file_id: dealertrackSourceFileId,
          dealership_store_id: otherDealershipStore.id,
          accounting_month: accountingMonth,
        });
        const crossDealershipRunRead = await otherDealershipAgent.get(
          `/reconciliation-runs/${firstRunId}`,
        );
        const crossDealershipDownload = await otherDealershipAgent.get(
          `/artifacts/${artifactsByType.get("FP_REC")!.id}/download`,
        );
        expect(crossDealershipUpload.status).toBe(422);
        expect(crossDealershipUpload.body.error).toMatchObject({ code: "INVALID_STORE_ID" });
        expect(crossDealershipRun.status).toBe(403);
        expect(crossDealershipRun.body.error).toMatchObject({ code: "DEALERSHIP_MISMATCH" });
        expect(crossDealershipRunRead.status).toBe(403);
        expect(crossDealershipDownload.status).toBe(404);

        failingRepository = new ForcedBatchFailureRepository(pool);
        const failingApp = createApp(failingRepository, [], 1, async () => undefined, {
          authRepository,
          sessionSecret,
          nodeEnv: "test",
          allowDevDealershipFallback: false,
        });
        const failingAgent = request.agent(failingApp);
        await login(failingAgent, `task10-allowed-${suffix}@example.test`, "allowed-password");
        const failedResponsePromise = failingAgent.post("/reconcile").send({
          boa_source_file_id: boaSourceFileId,
          dealertrack_source_file_id: dealertrackSourceFileId,
          dealership_store_id: acuraStore.id,
          accounting_month: accountingMonth,
        }).then((response) => response);
        const failedRunId = await failingRepository.waitForBatchStart();

        const pendingArtifacts = await allowedAgent.get(
          `/reconciliation-runs/${failedRunId}/artifacts`,
        );
        expect(pendingArtifacts.status).toBe(409);
        expect(pendingArtifacts.body.error).toMatchObject({
          code: "RECONCILIATION_ARTIFACTS_UNAVAILABLE",
          details: { reconciliation_run_status: "artifact_pending" },
        });

        const expectedFailureStderr = vi
          .spyOn(console, "error")
          .mockImplementation(() => undefined);
        let failedResponse: Awaited<typeof failedResponsePromise>;
        try {
          failingRepository.forceFailure();
          failedResponse = await failedResponsePromise;
        } finally {
          expectedFailureStderr.mockRestore();
        }
        expect(failedResponse.status).toBe(500);
        expect(failedResponse.body.error).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
        const failedDetail = await allowedAgent.get(`/reconciliation-runs/${failedRunId}`);
        expect(failedDetail.status).toBe(200);
        expect(failedDetail.body).toMatchObject({ status: "artifact_failed" });
        await expect(repository.listReconciliationArtifacts(1, failedRunId)).resolves.toEqual([]);
        const failedArtifacts = await allowedAgent.get(
          `/reconciliation-runs/${failedRunId}/artifacts`,
        );
        expect(failedArtifacts.status).toBe(409);
        expect(failedArtifacts.body.error).toMatchObject({
          code: "RECONCILIATION_ARTIFACTS_UNAVAILABLE",
          details: { reconciliation_run_status: "artifact_failed" },
        });
  } finally {
    failingRepository?.forceFailure();
    await pool.end();
  }
}

function assertPersistedSource(
  source: SourceFile | null,
  expected: {
    sourceType: "boa" | "dealertrack";
    parserName: "boa-csv" | "dealertrack-csv";
    preprocessorName: "boa-floorplan" | "dealertrack-floorplan";
    acceptedRows: number;
  },
): void {
  expect(source).toMatchObject({
    source_type: expected.sourceType,
    accounting_month: accountingMonth,
    rooftop_profile_id: "acura-v1",
    rooftop_profile_version: "1",
    parser_name: expected.parserName,
    parser_version: "1",
    preprocessor_name: expected.preprocessorName,
    preprocessor_version: "preprocessing-v1",
    row_count: expected.acceptedRows,
    preprocessing_metadata: {
      detected_format: "csv",
      parser_route: expected.sourceType === "boa" ? "boa_csv" : "dealertrack_csv",
      preprocessing_version: "preprocessing-v1",
      summary: {
        source_kind: expected.sourceType,
        parser_name: expected.parserName,
        parser_version: "1",
        preprocessor_name: expected.preprocessorName,
        preprocessor_version: "preprocessing-v1",
        rows_accepted: expected.acceptedRows,
        period_evidence: {
          selectedMonth: accountingMonth,
        },
      },
      diagnostics: expect.any(Array),
      removed_rows: expect.any(Array),
      legacy_csv_path: false,
      unsupported_reason: null,
    },
  });
  expect(source?.preprocessing_metadata?.diagnostics.length).toBeGreaterThan(0);
  expect(source?.preprocessing_metadata?.removed_rows.length).toBeGreaterThan(0);
}

async function addAuthUser(
  pool: ReturnType<typeof createPool>,
  authRepository: MemoryAuthRepository,
  input: {
    email: string;
    password: string;
    dealershipId: number;
    role: AuthRole;
    storeIds: number[];
  },
): Promise<number> {
  const created = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, role, dealership_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.email, "disabled:task-10", input.role, input.dealershipId],
  );
  const userId = created.rows[0]!.id;
  await authRepository.addUser({
    id: userId,
    email: input.email,
    password: input.password,
    dealership_id: input.dealershipId,
    role: input.role,
    store_ids: input.storeIds,
  });
  return userId;
}

async function login(
  agent: ReturnType<typeof request.agent>,
  email: string,
  password: string,
): Promise<void> {
  const response = await agent.post("/login").send({ email, password });
  expect(response.status).toBe(200);
}

function uploadFixture(
  agent: ReturnType<typeof request.agent>,
  sourceType: "boa" | "dealertrack",
  content: Buffer,
  filename: string,
  storeId: number,
  month: string,
) {
  return agent
    .post("/upload")
    .field("source_type", sourceType)
    .field("store_id", String(storeId))
    .field("accounting_month", month)
    .attach("file", content, filename);
}

function reconcile(
  agent: ReturnType<typeof request.agent>,
  boaSourceFileId: number,
  dealertrackSourceFileId: number,
  storeId: number,
) {
  return agent.post("/reconcile").send({
    boa_source_file_id: boaSourceFileId,
    dealertrack_source_file_id: dealertrackSourceFileId,
    dealership_store_id: storeId,
    accounting_month: accountingMonth,
  });
}

function expectedFpRecSemantics(
  fpRec: FpRecWorkbook,
): ExpectedFpRecSemantics {
  const contract = loadAcuraSanitizedContract();
  return {
    sheetName: "APR26",
    visibleColumnCount: 4,
    printArea: "A:D",
    summary: {
      outstandingStatementCents: contract.totals.boaCents,
      totalGlCents: contract.totals.dealertrackCents,
      differenceCents: contract.totals.differenceCents,
      netAdjustmentsCents: contract.totals.netAdjustmentsCents,
      varianceCents: contract.totals.varianceCents,
    },
    scheduleOnly: fpRec.schedule_not_on_statement.rows.map((row) => ({
      unitReference: row.unit_reference,
      amountCents: row.amount_cents,
    })),
    statementOnly: fpRec.statement_not_on_gl.rows.map((row) => ({
      unitReference: row.unit_reference,
      amountCents: row.amount_cents,
    })),
    formulas: {
      totalGl: "account_range",
      difference: contract.fpRec.differenceFormula,
      scheduleSubtotal: "section_range",
      statementSubtotal: "section_range",
      netAdjustments: contract.fpRec.netAdjustmentsFormula,
      variance: contract.fpRec.varianceFormula,
    },
    workpaper: {
      labelOrder: [
        "Floorplan Reconciliation-Hiley Acura",
        contract.fpRec.statementLabel,
        "GL Balances",
        "324",
        contract.fpRec.glLabel,
        "Difference",
        "On schedule-not on statement",
        "On statement-not on GL",
        "Net adjustments",
        "Variance",
      ],
      scheduleHeaders: ["On schedule-not on statement", "", "GL FLOORED", "BOA FLOORED"],
      statementHeaders: ["On statement-not on GL", "", "BOA FLOORED", "GL FLOORED"],
    },
  };
}

async function countRuns(
  pool: ReturnType<typeof createPool>,
  storeId: number,
): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM reconciliation_runs
     WHERE dealership_store_id = $1`,
    [storeId],
  );
  return Number(result.rows[0]!.count);
}

async function countSourceRows(
  pool: ReturnType<typeof createPool>,
  storeId: number,
  sourceType: "boa" | "dealertrack",
): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM source_files
     WHERE dealership_store_id = $1 AND source_type = $2`,
    [storeId, sourceType],
  );
  return Number(result.rows[0]!.count);
}

function responseByteLength(response: { body: unknown; text?: string }): number {
  return Buffer.isBuffer(response.body)
    ? response.body.byteLength
    : Buffer.byteLength(response.text ?? "", "utf8");
}
