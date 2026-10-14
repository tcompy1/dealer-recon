import request from "supertest";
import { describe, expect, test, vi } from "vitest";

import { createApp } from "./app.js";
import { MemoryAuthRepository } from "./auth.js";
import { parseAccountingMonth } from "./domain/accountingMonth.js";
import { MemoryTransactionRepository } from "./repositories/transactionRepository.js";
import type { TransactionRepository } from "./repositories/transactionRepository.js";
import type {
  NewTransaction,
  ProfiledNewSourceFile,
  SourceType,
  Transaction,
} from "./domain/types.js";
import {
  LINEAGE_RAW_DATA_KEY,
  type RawDataLineage,
  type UploadPreprocessingMetadata,
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
        expected_revision: 0, confirmed: true,
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

  test("accepts BOA transactions", async () => {
    const { app, repository } = createTestApp();
    const transaction = await seedTransaction(repository, 1, { sourceType: "boa" });

    const response = await request(app)
      .post(`/transactions/${transaction.id}/vin-enrichment`)
      .send({
        expected_revision: 0, confirmed: true,
        vin: VALID_VIN,
        source: "manual_enrichment",
        reason: "test",
      });

    expect(response.status).toBe(200);
    expect(response.body.transaction.vin).toBe(VALID_VIN);
  });

  test("rejects invalid VIN", async () => {
    const { app, repository } = createTestApp();
    const transaction = await seedTransaction(repository, 1);

    const response = await request(app)
      .post(`/transactions/${transaction.id}/vin-enrichment`)
      .send({
        expected_revision: 0, confirmed: true,
        vin: "NOT-A-VIN",
        source: "manual_enrichment",
        reason: "test",
      });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/VIN/);
  });

  test("accepts blank optional reason", async () => {
    const { app, repository } = createTestApp();
    const transaction = await seedTransaction(repository, 1);

    const response = await request(app)
      .post(`/transactions/${transaction.id}/vin-enrichment`)
      .send({
        expected_revision: 0, confirmed: true,
        vin: VALID_VIN,
        source: "manual_enrichment",
        reason: "   ",
      });

    expect(response.status).toBe(200);
  });

  test("returns 409 when VIN is unchanged", async () => {
    const { app, repository } = createTestApp();
    const transaction = await seedTransaction(repository, 1, { vin: VALID_VIN });

    const response = await request(app)
      .post(`/transactions/${transaction.id}/vin-enrichment`)
      .send({
        expected_revision: 0, confirmed: true,
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
        expected_revision: 0, confirmed: true,
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
        expected_revision: 0, confirmed: true,
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
      profiledReconciliationSourceFile("boa", "boa.csv", "boa-hash"),
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
      profiledReconciliationSourceFile("dealertrack", "dt.csv", "dt-hash"),
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
      accounting_month: "2026-04",
    });
    expect(firstRun.status).toBe(200);
    const firstMatched = firstRun.body.matched_count as number;
    const originalDetail=await repository.getReconciliationRunDetail(1,firstRun.body.reconciliation_run_id);
    const originalArtifact=await repository.findReconciliationArtifact(1,firstRun.body.reconciliation_run_id,"MERGED_FLOORPLAN");

    // Enrich the VIN.
    const enrichResponse = await request(app)
      .post(`/transactions/${dtTransaction.id}/vin-enrichment`)
      .send({
        expected_revision: 0, confirmed: true,
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
      accounting_month: "2026-04",
    });
    expect(secondRun.status).toBe(200);
    const secondMatched = secondRun.body.matched_count as number;

    expect(secondMatched).toBeGreaterThan(firstMatched);
    expect(await repository.getReconciliationRunDetail(1,firstRun.body.reconciliation_run_id)).toEqual(originalDetail);
    expect(await repository.findReconciliationArtifact(1,firstRun.body.reconciliation_run_id,"MERGED_FLOORPLAN")).toEqual(originalArtifact);
    const oldException=originalDetail!.exceptions.find(e=>e.source_type==="dealertrack")!;
    const reviewed=await repository.updateReconciliationExceptionReview(1,firstRun.body.reconciliation_run_id,oldException.exception_id,{review_notes:"Synthetic follow-up"});
    expect(reviewed?.transaction.vin).toBeNull();
    const prior=await repository.listPriorUnresolvedExceptions(1,{dealershipStoreId:1,excludeRunId:secondRun.body.reconciliation_run_id});
    expect(prior.find(e=>e.exception_id===oldException.exception_id)?.vin).toBeNull();
    const missingSnapshot=vi.spyOn(repository,"getReconciliationRunSnapshot").mockResolvedValue(null);
    const metadata=await repository.getReconciliationRunMetadata(1,firstRun.body.reconciliation_run_id);
    const unavailableProfile=vi.spyOn(repository,"getReconciliationRunMetadata").mockResolvedValue({...metadata!,rooftop_profile_id:"fw-v0",rooftop_profile_version:"0"});
    const binary=await request(app).get(`/reconciliation-runs/${firstRun.body.reconciliation_run_id}/merged-floorplan`);
    expect(binary.status).toBe(200);
    const storedFp=await request(app).get(`/reconciliation-runs/${firstRun.body.reconciliation_run_id}/fp-rec`);
    expect(storedFp.status).toBe(200);
    unavailableProfile.mockRestore();
    const regenerated=await request(app).get(`/reconciliation-runs/${firstRun.body.reconciliation_run_id}/merged-floorplan?format=json`);
    expect(regenerated.status).toBe(409);
    expect(regenerated.body.error.code).toBe("HISTORICAL_IDENTITY_UNAVAILABLE");
    missingSnapshot.mockRestore();
  });
});

function profiledReconciliationSourceFile(
  sourceType: "boa" | "dealertrack",
  filename: string,
  fileHash: string,
): ProfiledNewSourceFile {
  const accountingMonth = parseAccountingMonth("2026-04");
  if (!accountingMonth) {
    throw new Error("Invalid reconciliation test accounting month.");
  }
  const parserName = sourceType === "boa" ? "boa-csv" : "dealertrack-csv";
  const preprocessorName = sourceType === "boa" ? "boa-floorplan" : "dealertrack-floorplan";
  const preprocessingMetadata: UploadPreprocessingMetadata = {
    detected_format: "csv",
    detection_confidence: "high",
    detection_reason: "test fixture",
    parser_route: sourceType === "boa" ? "boa_csv" : "dealertrack_csv",
    preprocessing_version: "preprocessing-v1",
    summary: null,
    diagnostics: [],
    removed_rows: [],
    legacy_csv_path: false,
    unsupported_reason: null,
  };
  return {
    source_type: sourceType,
    dealership_store_id: 1,
    original_filename: filename,
    stored_filename: null,
    file_hash: fileHash,
    row_count: 1,
    validation_error_count: 0,
    accounting_month: accountingMonth,
    rooftop_profile_id: "hurst-v1",
    rooftop_profile_version: "1",
    parser_name: parserName,
    parser_version: "1",
    preprocessor_name: preprocessorName,
    preprocessor_version: "preprocessing-v1",
    preprocessing_metadata: preprocessingMetadata,
  };
}

describe("shared confirmed correction contract", () => {
  test.each(["boa", "dealertrack"] as const)("%s allows valid identity replacement without narrative and exposes reviewed revision", async sourceType => {
    const {app,repository}=createTestApp();
    const t=await seedTransaction(repository,1,{sourceType,vin:OTHER_VIN});
    const read=await request(app).get(`/transactions/${t.id}/vin-verification`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({id:t.id,vin:OTHER_VIN,vin_enrichment_revision:0});
    const response=await request(app).post(`/transactions/${t.id}/vin-enrichment`).send({vin:VALID_VIN,expected_revision:read.body.vin_enrichment_revision,confirmed:true});
    expect(response.status).toBe(200);
    expect(response.body.transaction).toMatchObject({vin:VALID_VIN,vin_revision:1});
    const events=await repository.listAuditEvents(1);
    expect(events).toHaveLength(1);
    expect(events[0].new_state).toMatchObject({source:null,reason:null,dms_reference:null,vin_revision:1});
    expect((await repository.getTransactionById(1,t.id))?.raw_data.Control).toBe("M10001");
  });
  test("overlapping writes and delayed stale same-target writes create only one audit", async()=>{
    const {app,repository}=createTestApp();const t=await seedTransaction(repository,1);
    const payload={vin:VALID_VIN,expected_revision:0,confirmed:true};
    const responses=await Promise.all([request(app).post(`/transactions/${t.id}/vin-enrichment`).send(payload),request(app).post(`/transactions/${t.id}/vin-enrichment`).send({...payload,vin:OTHER_VIN})]);
    expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    const current=await repository.getTransactionById(1,t.id);
    const delayed=await request(app).post(`/transactions/${t.id}/vin-enrichment`).send({...payload,vin:current?.vin});
    expect(delayed.status).toBe(409);expect(delayed.body.error.code).toBe("VIN_ENRICHMENT_REVISION_CONFLICT");
    expect(await repository.listAuditEvents(1)).toHaveLength(1);
  });
  test("legacy unversioned and unconfirmed writes cannot mutate",async()=>{
    const {app,repository}=createTestApp();const t=await seedTransaction(repository,1);
    const legacy=await request(app).post(`/transactions/${t.id}/vin-enrichment`).send({vin:VALID_VIN,source:"manual_enrichment",reason:"legacy"});
    expect(legacy.status).toBe(428);expect(legacy.body.error.code).toBe("VIN_ENRICHMENT_REVISION_REQUIRED");
    const unconfirmed=await request(app).post(`/transactions/${t.id}/vin-enrichment`).send({vin:VALID_VIN,expected_revision:0});
    expect(unconfirmed.status).toBe(400);expect(unconfirmed.body.error.code).toBe("VIN_CONFIRMATION_REQUIRED");
    expect((await repository.getTransactionById(1,t.id))?.vin).toBeNull();expect(await repository.listAuditEvents(1)).toHaveLength(0);
  });
});

test("source list omits correction audit narratives",async()=>{
 const {app,repository}=createTestApp();const transaction=await seedTransaction(repository,1);
 expect((await request(app).post(`/transactions/${transaction.id}/vin-enrichment`).send({vin:VALID_VIN,expected_revision:0,confirmed:true,reason:"private synthetic research narrative"})).status).toBe(200);
 const list=await request(app).get(`/source-files/${transaction.source_file_id}/transactions`);expect(list.status).toBe(200);
 expect(list.body[0].vin_provenance).toEqual({source:"manual_enrichment",vin:VALID_VIN,vin6:VALID_VIN.slice(-6),trusted:true});
 expect(JSON.stringify(list.body)).not.toContain("private synthetic research narrative");
});

describe.each(["boa","dealertrack"] as const)("%s denied correction boundaries",sourceType=>{
 test.each(["anonymous","wrong-store","wrong-dealership","read-only"] as const)("%s cannot mutate and scoped GET is enforced",async denial=>{
  const repository=new MemoryTransactionRepository(),authRepository=new MemoryAuthRepository();
  const t=await seedTransaction(repository,1,{sourceType,storeId:1});
  const app=createApp(repository,[],1,async()=>{}, {authRepository,sessionSecret:"test-session-secret-with-enough-length",allowDevDealershipFallback:false});const agent=request.agent(app);
  if(denial!=="anonymous"){
   await authRepository.addUser({email:"scope@example.com",password:"p@ssword12",dealership_id:denial==="wrong-dealership"?2:1,role:denial==="read-only"?"read_only_auditor":"accounting_user",store_ids:denial==="wrong-store"?[2]:[1]});
   expect((await agent.post("/login").send({email:"scope@example.com",password:"p@ssword12"})).status).toBe(200);
  }
  const before=await repository.getTransactionById(1,t.id),audits=(await repository.listAuditEvents(1)).length;
  const expected=denial==="anonymous"?401:denial==="wrong-dealership"?404:403;
  expect((await agent.get(`/transactions/${t.id}/vin-verification`)).status).toBe(denial==="read-only"?200:expected);
  expect((await agent.post(`/transactions/${t.id}/vin-enrichment`).send({vin:VALID_VIN,expected_revision:0,confirmed:true})).status).toBe(expected);
  expect(await repository.getTransactionById(1,t.id)).toEqual(before);expect((await repository.listAuditEvents(1)).length).toBe(audits);
 });
});
