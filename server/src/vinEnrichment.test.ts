import request from "supertest";
import { describe, expect, test } from "vitest";

import { createApp } from "./app.js";
import { MemoryAuthRepository } from "./auth.js";
import { MemoryTransactionRepository } from "./repositories/transactionRepository.js";
import type { TransactionRepository } from "./repositories/transactionRepository.js";
import type { NewTransaction, SourceType, Transaction } from "./domain/types.js";
import {
  LINEAGE_RAW_DATA_KEY,
  type RawDataLineage,
} from "./services/preprocessing/types.js";

const VALID_VIN = "1HGCM82633A004352";
const OTHER_VIN = "2HGCM82633A004353";

type SeedOptions = {
  sourceType?: SourceType;
  vin?: string | null;
  storeId?: number;
};

async function seedTransaction(
  repository: TransactionRepository,
  dealershipId: number,
  options: SeedOptions = {},
): Promise<Transaction> {
  const sourceType: SourceType = options.sourceType ?? "dealertrack";
  const storeId = options.storeId ?? 1;
  const sourceFile = await repository.createSourceFileWithTransactions(
    dealershipId,
    {
      source_type: sourceType,
      dealership_store_id: storeId,
      original_filename: "seed.csv",
      stored_filename: null,
      file_hash: `hash-${sourceType}-${Math.random()}`,
      row_count: 1,
      validation_error_count: 0,
    },
    [
      {
        source_file_id: null,
        source_type: sourceType,
        transaction_date: null,
        post_date: null,
        amount_cents: -1_000_00,
        reference_number: null,
        description: "FLOORPLAN ADV",
        account: null,
        stock_number: "M10001",
        vin: options.vin ?? null,
        raw_data: {
          Control: "M10001",
          Description: "FLOORPLAN ADV",
          [LINEAGE_RAW_DATA_KEY]: {
            source_kind: sourceType === "dealertrack" ? "dealertrack" : "boa",
            preprocessing_version: "preprocessing-v1",
            source_row_number: 5,
            raw_row_snapshot: { Control: "M10001", Description: "FLOORPLAN ADV" },
            transformations: [{ stage: "raw_parsed" }],
            retained_reason: "non_zero_amount",
            vin_provenance: {
              source: "untrusted",
              vin: null,
              vin6: null,
              trusted: false,
              note: "No VIN parsed.",
            },
            maturity_date: null,
          } satisfies RawDataLineage,
        },
      } as NewTransaction,
    ],
  );
  return sourceFile.transactions[0];
}

function createTestApp() {
  const repository = new MemoryTransactionRepository();
  const app = createApp(repository, [], 1, async () => undefined, {
    allowDevDealershipFallback: true,
  });
  return { app, repository };
}

describe("POST /transactions/:transactionId/vin-enrichment", () => {
  test("applies VIN enrichment on a Dealertrack transaction", async () => {
    const { app, repository } = createTestApp();
    const transaction = await seedTransaction(repository, 1);

    const response = await request(app)
      .post(`/transactions/${transaction.id}/vin-enrichment`)
      .send({
        vin: VALID_VIN,
        source: "manual_enrichment",
        reason: "DMS lookup confirmed VIN by stock number",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      enrichment_applied: true,
      vin6: VALID_VIN.slice(-6),
      source: "manual_enrichment",
      requires_rerun: true,
    });
    expect(response.body.audit_event_id).toEqual(expect.any(Number));
    expect(response.body.transaction.vin).toBe(VALID_VIN);

    const stored = await repository.getTransactionById(1, transaction.id);
    expect(stored?.vin).toBe(VALID_VIN);
    const lineage = stored?.raw_data?.[LINEAGE_RAW_DATA_KEY] as RawDataLineage;
    expect(lineage.vin_provenance?.source).toBe("manual_enrichment");
    expect(lineage.vin_provenance?.trusted).toBe(true);
    expect(
      lineage.transformations.some((entry) => entry.stage === "vin_enriched"),
    ).toBe(true);
    expect(lineage.source_row_number).toBe(5);

    const auditEvents = await repository.listAuditEvents(1);
    const vinEvent = auditEvents.find(
      (event) => event.action_type === "vin_enrichment_applied",
    );
    expect(vinEvent).toBeDefined();
    expect(vinEvent?.entity_type).toBe("transaction");
    expect(vinEvent?.entity_id).toBe(String(transaction.id));
    expect(vinEvent?.previous_state).toMatchObject({ vin: null });
    expect(vinEvent?.new_state).toMatchObject({
      vin: VALID_VIN,
      vin6: VALID_VIN.slice(-6),
      source: "manual_enrichment",
      dealership_store_id: 1,
    });
  });

  test("rejects BOA transactions", async () => {
    const { app, repository } = createTestApp();
    const transaction = await seedTransaction(repository, 1, { sourceType: "boa" });

    const response = await request(app)
      .post(`/transactions/${transaction.id}/vin-enrichment`)
      .send({
        vin: VALID_VIN,
        source: "manual_enrichment",
        reason: "test",
      });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/Dealertrack/);
  });

  test("rejects invalid VIN", async () => {
    const { app, repository } = createTestApp();
    const transaction = await seedTransaction(repository, 1);

    const response = await request(app)
      .post(`/transactions/${transaction.id}/vin-enrichment`)
      .send({
        vin: "NOT-A-VIN",
        source: "manual_enrichment",
        reason: "test",
      });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/VIN/);
  });

  test("rejects missing reason", async () => {
    const { app, repository } = createTestApp();
    const transaction = await seedTransaction(repository, 1);

    const response = await request(app)
      .post(`/transactions/${transaction.id}/vin-enrichment`)
      .send({
        vin: VALID_VIN,
        source: "manual_enrichment",
        reason: "   ",
      });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/reason/);
  });

  test("returns 409 when VIN is unchanged", async () => {
    const { app, repository } = createTestApp();
    const transaction = await seedTransaction(repository, 1, { vin: VALID_VIN });

    const response = await request(app)
      .post(`/transactions/${transaction.id}/vin-enrichment`)
      .send({
        vin: VALID_VIN,
        source: "manual_enrichment",
        reason: "no-op test",
      });

    expect(response.status).toBe(409);
  });

  test("blocks unauthorized store access", async () => {
    const repository = new MemoryTransactionRepository();
    const authRepository = new MemoryAuthRepository();
    await authRepository.addUser({
      email: "clerk@example.com",
      password: "p@ssword12",
      dealership_id: 1,
      role: "accounting_user",
      store_ids: [2],
    });
    const app = createApp(repository, [], 1, async () => undefined, {
      authRepository,
      sessionSecret: "test-session-secret-with-enough-length",
      allowDevDealershipFallback: false,
    });
    const transaction = await seedTransaction(repository, 1, { storeId: 1 });

    const agent = request.agent(app);
    const loginResponse = await agent
      .post("/login")
      .send({ email: "clerk@example.com", password: "p@ssword12" });
    expect(loginResponse.status).toBe(200);

    const response = await agent
      .post(`/transactions/${transaction.id}/vin-enrichment`)
      .send({
        vin: VALID_VIN,
        source: "manual_enrichment",
        reason: "DMS lookup",
      });

    expect(response.status).toBe(403);
  });

  test("preserves prior lineage and records previous lineage summary in audit event", async () => {
    const { app, repository } = createTestApp();
    const transaction = await seedTransaction(repository, 1);

    const response = await request(app)
      .post(`/transactions/${transaction.id}/vin-enrichment`)
      .send({
        vin: OTHER_VIN,
        source: "dms_assisted_reconstruction",
        reason: "Reynolds DMS confirmed",
        dms_reference: "RY-123",
      });

    expect(response.status).toBe(200);
    const stored = await repository.getTransactionById(1, transaction.id);
    const lineage = stored?.raw_data?.[LINEAGE_RAW_DATA_KEY] as RawDataLineage;
    expect(lineage.source_row_number).toBe(5);
    expect(lineage.raw_row_snapshot).toMatchObject({ Control: "M10001" });
    expect(lineage.transformations.length).toBeGreaterThanOrEqual(2);

    const auditEvents = await repository.listAuditEvents(1);
    const vinEvent = auditEvents.find(
      (event) => event.action_type === "vin_enrichment_applied",
    );
    expect(vinEvent?.previous_state).toMatchObject({
      vin: null,
      lineage_summary: {
        source_kind: "dealertrack",
        source_row_number: 5,
      },
    });
    expect(vinEvent?.new_state).toMatchObject({
      dms_reference: "RY-123",
      reason: "Reynolds DMS confirmed",
    });
  });

  test("enriched VIN6 participates in matching after explicit re-run", async () => {
    const { app, repository } = createTestApp();

    // Seed a Dealertrack transaction with no VIN, plus a BOA transaction
    // bearing the same amount and VIN6. Before enrichment, they will not
    // match. After enrichment + re-run, they should match.
    const sourceFileBoa = await repository.createSourceFileWithTransactions(
      1,
      {
        source_type: "boa",
        dealership_store_id: 1,
        original_filename: "boa.csv",
        stored_filename: null,
        file_hash: "boa-hash",
        row_count: 1,
        validation_error_count: 0,
      },
      [
        {
          source_file_id: null,
          source_type: "boa",
          transaction_date: null,
          post_date: null,
          amount_cents: 50_000,
          reference_number: "BOA-1",
          description: "Floorplan",
          account: null,
          stock_number: "STK-1",
          vin: VALID_VIN,
          raw_data: {},
        } as NewTransaction,
      ],
      {
        filename: "boa.csv",
        content_type: "text/csv",
        content: Buffer.from("boa raw"),
      },
    );

    const sourceFileDt = await repository.createSourceFileWithTransactions(
      1,
      {
        source_type: "dealertrack",
        dealership_store_id: 1,
        original_filename: "dt.csv",
        stored_filename: null,
        file_hash: "dt-hash",
        row_count: 1,
        validation_error_count: 0,
      },
      [
        {
          source_file_id: null,
          source_type: "dealertrack",
          transaction_date: null,
          post_date: null,
          amount_cents: -50_000,
          reference_number: "DT-1",
          description: "Advance no VIN",
          account: null,
          stock_number: "STK-1",
          vin: null,
          raw_data: {
            [LINEAGE_RAW_DATA_KEY]: {
              source_kind: "dealertrack",
              preprocessing_version: "preprocessing-v1",
              source_row_number: 2,
              raw_row_snapshot: { Control: "STK-1" },
              transformations: [],
              retained_reason: "non_zero_amount",
              vin_provenance: {
                source: "untrusted",
                vin: null,
                vin6: null,
                trusted: false,
                note: "No VIN parsed.",
              },
              maturity_date: null,
            } satisfies RawDataLineage,
          },
        } as NewTransaction,
      ],
      {
        filename: "dt.csv",
        content_type: "text/csv",
        content: Buffer.from("dealertrack raw"),
      },
    );

    const dtTransaction = sourceFileDt.transactions[0];

    // First reconciliation should not pair these (no VIN on Dealertrack side).
    const firstRun = await request(app).post("/reconcile").send({
      boa_source_file_id: sourceFileBoa.sourceFile.id,
      dealertrack_source_file_id: sourceFileDt.sourceFile.id,
    });
    expect(firstRun.status).toBe(200);
    const firstMatched = firstRun.body.matched_count as number;

    // Enrich the VIN.
    const enrichResponse = await request(app)
      .post(`/transactions/${dtTransaction.id}/vin-enrichment`)
      .send({
        vin: VALID_VIN,
        source: "manual_enrichment",
        reason: "DMS lookup",
      });
    expect(enrichResponse.status).toBe(200);
    expect(enrichResponse.body.requires_rerun).toBe(true);

    // Explicit re-run.
    const secondRun = await request(app).post("/reconcile").send({
      boa_source_file_id: sourceFileBoa.sourceFile.id,
      dealertrack_source_file_id: sourceFileDt.sourceFile.id,
    });
    expect(secondRun.status).toBe(200);
    const secondMatched = secondRun.body.matched_count as number;

    expect(secondMatched).toBeGreaterThan(firstMatched);
  });
});
