import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import request from "supertest";
import { describe, expect, test } from "vitest";

import { createApp } from "./app.js";
import { MemoryAuthRepository } from "./auth.js";
import { MemoryTransactionRepository } from "./repositories/transactionRepository.js";
import { MAX_CSV_ROWS } from "./services/transactionNormalizer.js";

const FIXTURE_ROOT = new URL("../../", import.meta.url);
async function loadFixture(relativePath: string): Promise<Buffer> {
  return readFile(new URL(relativePath, FIXTURE_ROOT));
}

const BOA_CSV_HEADER =
  "Location,Manufacturer Name,Plant Name,Invoice Date,Invoice Number,Interest Start Date,Maturity Date,Description,Type,Model Number,Serial No/VIN,Stock/Lease No,Original Amount,Beginning Balance,Advances,Last Advance Date,Principal Payments,Principal Adjustments,Monthly Activity,Ending Balance,Current Curtailments,Past Due Curtailments,Current Maturities,Past Due Maturities,Total Principal Due,Interest Amount,Prior Period Interest Billed Current Month,Flat Charges Amount,Item Fee Amount,Total Interest / Charges / Fees Due,Inception to Date Interest,Average Daily Billing Balance";

const DEALERTRACK_CSV_HEADER = "Control,Description,2100,2110";

function boaUploadRow(
  stockNumber: string,
  vin: string,
  amount: string,
  reference = "382882",
): string {
  return [
    "storeA",
    "Mazda",
    "Auto - Mazda Plant",
    "9/26/2025",
    reference,
    "9/26/2025",
    "5/26/2027",
    "Vehicle",
    "Automobile",
    "M-MODEL",
    vin,
    stockNumber,
    `"${amount}"`,
    `"${amount}"`,
    "$0.00",
    "",
    "$0.00",
    "$0.00",
    "$0.00",
    `"${amount}"`,
    "$0.00",
    "$0.00",
    "$0.00",
    "$0.00",
    "$0.00",
    "$0.00",
    "$0.00",
    "$0.00",
    "$0.00",
    "$0.00",
    "$0.00",
    `"${amount}"`,
  ].join(",");
}

function dealertrackUploadRow(stockNumber: string, amount: string, vin?: string): string {
  const desc = vin ? `"BOA FLOORPLAN ${vin}"` : '"BOA FLOORPLAN"';
  return `${stockNumber},${desc},${amount},0`;
}

// Single-upload helpers that include the header so each call produces a
// well-formed CSV the source-specific preprocessor can ingest.
const boaUploadCsv = (stockNumber: string, vin: string, amount: string, reference = "382882") =>
  [BOA_CSV_HEADER, boaUploadRow(stockNumber, vin, amount, reference)].join("\n");

const dealertrackUploadCsv = (stockNumber: string, amount: string, vin?: string) =>
  [DEALERTRACK_CSV_HEADER, dealertrackUploadRow(stockNumber, amount, vin)].join("\n");

function boaUploadCsvMulti(
  rows: Array<{ stock: string; vin: string; amount: string; reference?: string }>,
): string {
  return [
    BOA_CSV_HEADER,
    ...rows.map((r) => boaUploadRow(r.stock, r.vin, r.amount, r.reference ?? "382882")),
  ].join("\n");
}

function dealertrackUploadCsvMulti(
  rows: Array<{ stock: string; amount: string; vin?: string }>,
): string {
  return [
    DEALERTRACK_CSV_HEADER,
    ...rows.map((r) => dealertrackUploadRow(r.stock, r.amount, r.vin)),
  ].join("\n");
}

function dealertrackUploadCsvMultiForAccount(
  rows: Array<{ stock: string; amount: string; vin?: string }>,
  accountColumn: string,
): string {
  return [
    `Control,Description,${accountColumn}`,
    ...rows.map((r) => {
      const desc = r.vin ? `"BOA FLOORPLAN ${r.vin}"` : '"BOA FLOORPLAN"';
      return `${r.stock},${desc},${r.amount}`;
    }),
  ].join("\n");
}

describe("app", () => {
  test("POST /login authenticates a local user and GET /me returns the user", async () => {
    const authRepository = new MemoryAuthRepository();
    await authRepository.addUser({
      email: "controller@example.com",
      password: "correct-password",
      dealership_id: 2,
    });
    const app = createApp(new MemoryTransactionRepository(), [], 1, async () => undefined, {
      authRepository,
      sessionSecret: "test-session-secret-with-enough-length",
      allowDevDealershipFallback: false,
    });
    const agent = request.agent(app);

    const loginResponse = await agent
      .post("/login")
      .send({ email: "controller@example.com", password: "correct-password" });
    const meResponse = await agent.get("/me");

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user).toMatchObject({
      email: "controller@example.com",
      dealership_id: 2,
    });
    expect(loginResponse.headers["set-cookie"]?.[0]).toContain("dealer_recon_session=");
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user).toMatchObject({
      email: "controller@example.com",
      dealership_id: 2,
    });
  });

  test("POST /login rejects invalid credentials", async () => {
    const authRepository = new MemoryAuthRepository();
    await authRepository.addUser({
      email: "controller@example.com",
      password: "correct-password",
      dealership_id: 1,
    });
    const app = createApp(new MemoryTransactionRepository(), [], 1, async () => undefined, {
      authRepository,
      sessionSecret: "test-session-secret-with-enough-length",
      allowDevDealershipFallback: false,
    });

    const response = await request(app)
      .post("/login")
      .send({ email: "controller@example.com", password: "wrong-password" });

    expect(response.status).toBe(401);
  });

  test("protected routes require authentication when auth is configured", async () => {
    const authRepository = new MemoryAuthRepository();
    const app = createApp(new MemoryTransactionRepository(), [], 1, async () => undefined, {
      authRepository,
      sessionSecret: "test-session-secret-with-enough-length",
      allowDevDealershipFallback: false,
    });

    const response = await request(app).get("/source-files");

    expect(response.status).toBe(401);
  });

  test("accounting users are scoped to assigned stores", async () => {
    const authRepository = new MemoryAuthRepository();
    await authRepository.addUser({
      email: "accounting@example.com",
      password: "correct-password",
      dealership_id: 1,
      role: "accounting_user",
      store_ids: [1],
    });
    const app = createApp(new MemoryTransactionRepository(), [], 1, async () => undefined, {
      authRepository,
      sessionSecret: "test-session-secret-with-enough-length",
      allowDevDealershipFallback: false,
    });
    const agent = request.agent(app);
    await agent.post("/login").send({ email: "accounting@example.com", password: "correct-password" });

    const storesResponse = await agent.get("/stores");
    const forbiddenFilesResponse = await agent.get("/source-files").query({ store_id: 2 });
    const forbiddenUploadResponse = await agent
      .post("/upload")
      .field("source_type", "boa")
      .field("store_id", "2")
      .attach("file", Buffer.from(boaUploadCsv("M30101", "1HGCM82633A004352", "$301.00", "30101")), "boa.csv");

    expect(storesResponse.status).toBe(200);
    expect(storesResponse.body).toEqual([
      expect.objectContaining({ id: 1, name: "Hiley Mazda of Hurst" }),
    ]);
    expect(forbiddenFilesResponse.status).toBe(403);
    expect(forbiddenUploadResponse.status).toBe(403);
  });

  test("read-only auditors cannot modify review workflow state", async () => {
    const authRepository = new MemoryAuthRepository();
    await authRepository.addUser({
      email: "accounting@example.com",
      password: "correct-password",
      dealership_id: 1,
      role: "accounting_user",
      store_ids: [1],
    });
    await authRepository.addUser({
      email: "auditor@example.com",
      password: "correct-password",
      dealership_id: 1,
      role: "read_only_auditor",
      store_ids: [1],
    });
    const app = createApp(new MemoryTransactionRepository(), [], 1, async () => undefined, {
      authRepository,
      sessionSecret: "test-session-secret-with-enough-length",
      allowDevDealershipFallback: false,
    });
    const accountingAgent = request.agent(app);
    await accountingAgent.post("/login").send({
      email: "accounting@example.com",
      password: "correct-password",
    });
    const boaUpload = await accountingAgent
      .post("/upload")
      .field("source_type", "boa")
      .field("store_id", "1")
      .attach(
        "file",
        Buffer.from([
          boaUploadCsv("M30101", "1HGCM82633A004352", "$301.00", "30101"),
          boaUploadCsv("M30202", "2HGCM82633A004352", "$302.00", "30202"),
        ].join("\n")),
        "boa.csv",
      );
    const dealertrackUpload = await accountingAgent
      .post("/upload")
      .field("source_type", "dealertrack")
      .field("store_id", "1")
      .attach("file", Buffer.from(dealertrackUploadCsv("M30101", "-301")), "dealertrack.csv");
    const reconciliation = await accountingAgent.post("/reconcile").send({
      boa_source_file_id: boaUpload.body.source_file_id,
      dealertrack_source_file_id: dealertrackUpload.body.source_file_id,
      dealership_store_id: 1,
    });
    const detail = await accountingAgent.get(`/reconciliation-runs/${reconciliation.body.reconciliation_run_id}`);
    const exceptionId = detail.body.exceptions[0].exception_id;

    const auditorAgent = request.agent(app);
    await auditorAgent.post("/login").send({ email: "auditor@example.com", password: "correct-password" });
    const patchResponse = await auditorAgent
      .patch(`/reconciliation-runs/${reconciliation.body.reconciliation_run_id}/exceptions/${exceptionId}`)
      .send({ review_status: "resolved" });

    expect(patchResponse.status).toBe(403);
  });

  test("login and replay actions are written to audit events", async () => {
    const authRepository = new MemoryAuthRepository();
    await authRepository.addUser({
      email: "admin@example.com",
      password: "correct-password",
      dealership_id: 1,
      role: "platform_admin",
    });
    const app = createApp(new MemoryTransactionRepository(), [], 1, async () => undefined, {
      authRepository,
      sessionSecret: "test-session-secret-with-enough-length",
      allowDevDealershipFallback: false,
    });
    const agent = request.agent(app);
    await agent.post("/login").send({ email: "admin@example.com", password: "correct-password" });
    const reconciliation = await createReconciliationWithAgent(agent);

    await agent.get(`/reconciliation-runs/${reconciliation.reconciliation_run_id}/replay`);
    const auditResponse = await agent.get("/audit-events");

    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action_type: "login", entity_type: "user" }),
        expect.objectContaining({
          action_type: "reconciliation_replay",
          entity_type: "reconciliation_run",
          entity_id: String(reconciliation.reconciliation_run_id),
        }),
      ]),
    );
  });

  test("authenticated requests scope dealership from the user", async () => {
    const repository = new MemoryTransactionRepository();
    const authRepository = new MemoryAuthRepository();
    await authRepository.addUser({
      email: "controller@example.com",
      password: "correct-password",
      dealership_id: 2,
    });
    const app = createApp(repository, [], 1, async () => undefined, {
      authRepository,
      sessionSecret: "test-session-secret-with-enough-length",
      allowDevDealershipFallback: false,
    });
    const agent = request.agent(app);
    await agent.post("/login").send({
      email: "controller@example.com",
      password: "correct-password",
    });

    const upload = await agent
      .post("/upload")
      .field("source_type", "bank")
      .attach(
        "file",
        Buffer.from(
          [
            "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
            "2026-04-30,2026-05-01,100.00,DEP-1001,Daily deposit,1000,STK123,1HGCM82633A004352",
          ].join("\n"),
        ),
        "bank.csv",
      );

    expect(upload.status).toBe(200);
    await expect(repository.getSourceFile(upload.body.source_file_id)).resolves.toMatchObject({
      dealership_id: 2,
    });
  });

  test("POST /logout clears the session", async () => {
    const authRepository = new MemoryAuthRepository();
    await authRepository.addUser({
      email: "controller@example.com",
      password: "correct-password",
      dealership_id: 1,
    });
    const app = createApp(new MemoryTransactionRepository(), [], 1, async () => undefined, {
      authRepository,
      sessionSecret: "test-session-secret-with-enough-length",
      allowDevDealershipFallback: false,
    });
    const agent = request.agent(app);
    await agent.post("/login").send({
      email: "controller@example.com",
      password: "correct-password",
    });

    const logoutResponse = await agent.post("/logout");
    const meResponse = await agent.get("/me");

    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers["set-cookie"]?.[0]).toContain("dealer_recon_session=;");
    expect(meResponse.status).toBe(401);
  });

  test("GET /health returns ok", async () => {
    const app = createApp(new MemoryTransactionRepository());

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  test("GET /ready returns ready when dependencies are available", async () => {
    const app = createApp(new MemoryTransactionRepository(), [], 1, async () => undefined);

    const response = await request(app).get("/ready").set("X-Request-ID", "test-request-id");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready" });
    expect(response.header["x-request-id"]).toBe("test-request-id");
  });

  test("GET /ready returns 503 when dependencies are unavailable", async () => {
    const app = createApp(new MemoryTransactionRepository(), [], 1, async () => {
      throw new Error("database unavailable");
    });

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body.error.message).toBe("Service not ready.");
    expect(response.header["x-request-id"]).toEqual(expect.any(String));
  });

  test("POST /upload accepts CSV upload", async () => {
    const app = createApp(new MemoryTransactionRepository());

    const response = await request(app)
      .post("/upload")
      .field("source_type", "bank")
      .attach(
        "file",
        Buffer.from(
          [
            "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
            "2026-04-30,2026-05-01,1234.56,DEP-1001,Daily deposit,1000,STK123,1HGCM82633A004352",
          ].join("\n"),
        ),
        "bank_transactions.csv",
      );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      source_type: "bank",
      filename: "bank_transactions.csv",
      transaction_count: 1,
      validation_errors: [],
    });
    expect(response.body.source_file_id).toEqual(expect.any(Number));
  });

  test("POST /upload returns preprocessing diagnostics summary for BOA HTML XLS uploads", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const buffer = await loadFixture("sample-data/synthetic/boa_billing_statement_sample.xls.html");

    const response = await request(app)
      .post("/upload")
      .field("source_type", "boa")
      .attach("file", buffer, "boa_billing_statement_sample.xls");

    expect(response.status).toBe(200);
    const preprocessing = response.body.preprocessing;
    expect(preprocessing).toBeTruthy();
    expect(preprocessing).toMatchObject({
      detected_format: expect.any(String),
      detection_confidence: expect.any(String),
      detection_reason: expect.any(String),
      parser_route: expect.any(String),
      preprocessing_version: expect.any(String),
      legacy_csv_path: false,
      unsupported_reason: null,
      diagnostics: expect.any(Array),
      summary: expect.objectContaining({
        source_kind: "boa",
        rows_scanned: expect.any(Number),
        rows_accepted: expect.any(Number),
        rows_removed_zero_balance: expect.any(Number),
        rows_removed_straightline: expect.any(Number),
        rows_removed_banner: expect.any(Number),
        rows_skipped_unknown: expect.any(Number),
        rows_requiring_manual_enrichment: expect.any(Number),
        duplicate_vin6_count: expect.any(Number),
        preprocessed_at: expect.any(String),
      }),
    });

    const diagnosticKinds = new Set(
      (preprocessing.diagnostics as Array<{ kind: string }>).map((diagnostic) => diagnostic.kind),
    );
    // The synthetic BOA fixture has a zero-balance row that must be flagged.
    expect(diagnosticKinds.has("zero_balance_row_removed")).toBe(true);

    for (const diagnostic of preprocessing.diagnostics as Array<{
      kind: string;
      message: string;
      source_row_number: number | null;
    }>) {
      expect(typeof diagnostic.kind).toBe("string");
      expect(typeof diagnostic.message).toBe("string");
      expect(
        diagnostic.source_row_number === null || typeof diagnostic.source_row_number === "number",
      ).toBe(true);
    }
  });

  test("POST /upload returns preprocessing diagnostics summary for Dealertrack SpreadsheetML uploads", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const buffer = await loadFixture("sample-data/synthetic/dealertrack_floorplan_sample.xml");

    const response = await request(app)
      .post("/upload")
      .field("source_type", "dealertrack")
      .attach("file", buffer, "dealertrack_floorplan_sample.xml");

    expect(response.status).toBe(200);
    expect(response.body.preprocessing).toMatchObject({
      legacy_csv_path: false,
      unsupported_reason: null,
      summary: expect.objectContaining({ source_kind: "dealertrack" }),
    });
  });

  test("POST /upload routes BOA CSV uploads through source-specific preprocessing (not legacy)", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const response = await request(app)
      .post("/upload")
      .field("source_type", "boa")
      .attach(
        "file",
        Buffer.from(boaUploadCsv("M30101", "1HGCM82633A004352", "$301.00", "30101")),
        "boa.csv",
      );

    expect(response.status).toBe(200);
    expect(response.body.preprocessing).toMatchObject({
      legacy_csv_path: false,
      parser_route: "boa_csv",
      preprocessing_version: expect.any(String),
      summary: expect.objectContaining({ source_kind: "boa" }),
      diagnostics: expect.any(Array),
    });
  });

  test("POST /upload routes Dealertrack CSV uploads through source-specific preprocessing (not legacy)", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const response = await request(app)
      .post("/upload")
      .field("source_type", "dealertrack")
      .attach(
        "file",
        Buffer.from(dealertrackUploadCsv("M30101", "-301", "1HGCM82633A004352")),
        "dealertrack.csv",
      );

    expect(response.status).toBe(200);
    expect(response.body.preprocessing).toMatchObject({
      legacy_csv_path: false,
      parser_route: "dealertrack_csv",
      preprocessing_version: expect.any(String),
      summary: expect.objectContaining({ source_kind: "dealertrack" }),
      diagnostics: expect.any(Array),
    });
  });

  test("POST /upload returns 422 with preprocessing metadata for true .xlsx OOXML uploads", async () => {
    const app = createApp(new MemoryTransactionRepository());
    // OOXML zip signature ("PK\x03\x04"). The detector only sniffs the
    // leading bytes; the rest of the buffer can be opaque since the native
    // xlsx parser is not implemented yet.
    const xlsxBuffer = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("synthetic-ooxml-stub"),
    ]);

    // Use the .xls extension because the upload filter only permits the
    // CSV/XLS/XML/HTML extension set; real OOXML workbooks frequently
    // arrive renamed as .xls.
    const response = await request(app)
      .post("/upload")
      .field("source_type", "boa")
      .attach("file", xlsxBuffer, "boa.xls");

    expect(response.status).toBe(422);
    expect(typeof response.body.error.message).toBe("string");
    expect(response.body.error.message.length).toBeGreaterThan(0);
    expect(response.body.error.details.preprocessing).toMatchObject({
      detected_format: "xlsx_ooxml",
      detection_confidence: expect.any(String),
      detection_reason: expect.any(String),
      parser_route: "xlsx_native",
      legacy_csv_path: false,
      unsupported_reason: expect.any(String),
      diagnostics: expect.any(Array),
      summary: null,
    });
    expect(response.body.error.details.preprocessing.unsupported_reason).toBe(response.body.error.message);
  });

  test("POST /upload returns 422 with preprocessing metadata for mismatched source/file route", async () => {
    // Dealertrack SpreadsheetML XML uploaded under source_type=boa; the
    // router resolves to `unsupported` because xml_spreadsheet only routes
    // for source_type=dealertrack.
    const app = createApp(new MemoryTransactionRepository());
    const buffer = await loadFixture("sample-data/synthetic/dealertrack_floorplan_sample.xml");

    const response = await request(app)
      .post("/upload")
      .field("source_type", "boa")
      .attach("file", buffer, "dealertrack.xml");

    expect(response.status).toBe(422);
    expect(response.body.error.details.preprocessing).toMatchObject({
      detected_format: "xml_spreadsheet",
      detection_confidence: expect.any(String),
      detection_reason: expect.any(String),
      parser_route: "unsupported",
      legacy_csv_path: false,
      unsupported_reason: expect.any(String),
      diagnostics: expect.any(Array),
      summary: null,
    });
    expect(response.body.error.details.preprocessing.unsupported_reason).toBe(response.body.error.message);
  });

  test("POST /upload returns 422 with preprocessing metadata for unknown/malformed parser route", async () => {
    // A binary blob with no known signature and no recognizable leading
    // text; the detector classifies it as `unknown` and the router falls
    // through to `unsupported`.
    const app = createApp(new MemoryTransactionRepository());
    const opaqueBytes = Buffer.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
      0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d,
      0x1e, 0x1f,
    ]);

    const response = await request(app)
      .post("/upload")
      .field("source_type", "boa")
      .attach("file", opaqueBytes, "boa.xls");

    expect(response.status).toBe(422);
    expect(response.body.error.details.preprocessing).toMatchObject({
      detected_format: "unknown",
      parser_route: "unsupported",
      legacy_csv_path: false,
      unsupported_reason: expect.any(String),
      diagnostics: expect.any(Array),
      summary: null,
    });
    expect(response.body.error.details.preprocessing.unsupported_reason).toBe(response.body.error.message);
  });

  test("POST /upload rejects invalid source_type", async () => {
    const app = createApp(new MemoryTransactionRepository());

    const response = await request(app)
      .post("/upload")
      .field("source_type", "crm")
      .attach("file", Buffer.from("transaction_date,amount\n2026-04-30,10.00\n"), "x.csv");

    expect(response.status).toBe(422);
  });

  test("POST /upload requires file", async () => {
    const app = createApp(new MemoryTransactionRepository());

    const response = await request(app).post("/upload").field("source_type", "bank");

    expect(response.status).toBe(422);
  });

  test("POST /upload reuses duplicate file contents for the same source type", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const csv = [
      "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
      "2026-04-30,2026-05-01,100.00,DEP-1001,Daily deposit,1000,STK123,1HGCM82633A004352",
    ].join("\n");

    const firstUpload = await uploadCsv(app, "bank", csv, "bank.csv");
    const response = await request(app)
      .post("/upload")
      .field("source_type", "bank")
      .attach("file", Buffer.from(csv), "bank-copy.csv");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      source_file_id: firstUpload.source_file_id,
      source_type: "bank",
      filename: "bank.csv",
      transaction_count: 1,
      validation_errors: [],
      reused_existing_file: true,
      existing_file: {
        source_file_id: firstUpload.source_file_id,
        filename: "bank.csv",
        source_type: "bank",
        created_at: expect.any(String),
      },
    });
  });

  test("POST /upload reprocesses unhealthy duplicate Dealertrack source files", async () => {
    const repository = new MemoryTransactionRepository();
    const app = createApp(repository);
    const dealertrackFixture = await loadFixture(
      "server/src/services/__fixtures__/DT HURST APRIL (1).csv",
    );
    const fileHash = createHash("sha256").update(dealertrackFixture).digest("hex");
    const badImport = await repository.createSourceFileWithTransactions(
      1,
      {
        source_type: "dealertrack",
        dealership_store_id: 1,
        original_filename: "DT HURST APRIL (1).csv",
        stored_filename: null,
        file_hash: fileHash,
        row_count: 0,
        validation_error_count: 201,
      },
      [],
    );

    const uploadResponse = await request(app)
      .post("/upload")
      .field("source_type", "dealertrack")
      .field("store_id", "1")
      .attach("file", dealertrackFixture, "DT HURST APRIL (1).csv");

    expect(uploadResponse.status).toBe(200);
    expect(uploadResponse.body).toMatchObject({
      source_file_id: badImport.sourceFile.id,
      reused_existing_file: false,
      transaction_count: expect.any(Number),
      stored_row_count: expect.any(Number),
      stored_validation_error_count: 0,
      source_file_health: expect.objectContaining({
        status: "reprocessed",
        healthy: true,
        reasons: [],
      }),
    });
    expect(uploadResponse.body.transaction_count).toBeGreaterThan(0);
    expect(uploadResponse.body.stored_row_count).toBeGreaterThan(0);

    const repairedTransactions = await repository.listBySourceFile(1, badImport.sourceFile.id);
    expect(repairedTransactions.length).toBeGreaterThan(0);

    const boaUpload = await uploadCsv(
      app,
      "boa",
      boaUploadCsv("M21324", "JM1BPAAL7T1869826", "$25,895.00", "M21324"),
      "boa-april-match.csv",
      1,
    );
    const reconciliation = await request(app)
      .post("/reconcile")
      .send({
        boa_source_file_id: boaUpload.source_file_id,
        dealertrack_source_file_id: badImport.sourceFile.id,
        dealership_store_id: 1,
      });

    expect(reconciliation.status).toBe(200);
    const snapshot = await repository.getReconciliationRunSnapshot(
      1,
      reconciliation.body.reconciliation_run_id,
    );
    const dealertrackInput = snapshot?.inputs.find((input) => input.side === "dealertrack");
    expect(dealertrackInput?.transactions.length).toBeGreaterThan(0);
  });

  test("uploads are scoped by dealership and attach dealership_id", async () => {
    const repository = new MemoryTransactionRepository();
    const firstDealershipApp = createApp(repository, [], 1);
    const secondDealershipApp = createApp(repository, [], 2);
    const csv = [
      "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
      "2026-04-30,2026-05-01,100.00,DEP-1001,Daily deposit,1000,STK123,1HGCM82633A004352",
    ].join("\n");

    const firstUpload = await uploadCsv(firstDealershipApp, "bank", csv, "bank.csv");
    const secondUpload = await uploadCsv(secondDealershipApp, "bank", csv, "bank.csv");

    await expect(repository.getSourceFile(firstUpload.source_file_id)).resolves.toMatchObject({
      dealership_id: 1,
    });
    await expect(repository.getSourceFile(secondUpload.source_file_id)).resolves.toMatchObject({
      dealership_id: 2,
    });

    const firstList = await request(firstDealershipApp).get("/source-files");
    const secondList = await request(secondDealershipApp).get("/source-files");

    expect(firstList.status).toBe(200);
    expect(firstList.body).toEqual([
      expect.objectContaining({
        source_file_id: firstUpload.source_file_id,
        dealership_id: 1,
      }),
    ]);
    expect(secondList.status).toBe(200);
    expect(secondList.body).toEqual([
      expect.objectContaining({
        source_file_id: secondUpload.source_file_id,
        dealership_id: 2,
      }),
    ]);
  });

  test("POST /upload rejects non-CSV files", async () => {
    const app = createApp(new MemoryTransactionRepository());

    const response = await request(app)
      .post("/upload")
      .field("source_type", "bank")
      .attach("file", Buffer.from("not,csv"), "bank.txt");

    expect(response.status).toBe(422);
  });

  test("POST /upload rejects files over the CSV row limit", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const csv = [
      "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
      ...Array.from(
        { length: MAX_CSV_ROWS },
        (_, index) =>
          `2026-04-30,2026-05-01,100.00,DEP-${index},Daily deposit,1000,STK${index},1HGCM82633A004352`,
      ),
    ].join("\n");

    const response = await request(app)
      .post("/upload")
      .field("source_type", "bank")
      .attach("file", Buffer.from(csv), "large.csv");

    expect(response.status).toBe(413);
  });

  test("GET /source-files lists uploaded source files", async () => {
    const app = createApp(new MemoryTransactionRepository());
    await uploadCsv(
      app,
      "bank",
      [
        "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
        "2026-04-30,2026-05-01,100.00,DEP-1001,Daily deposit,1000,STK123,1HGCM82633A004352",
      ].join("\n"),
      "bank.csv",
    );
    await uploadCsv(
      app,
      "dealertrack",
      dealertrackUploadCsv("M12345", "-100"),
      "dealertrack.csv",
    );

    const response = await request(app).get("/source-files");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_file_id: expect.any(Number),
          source_type: "bank",
          filename: "bank.csv",
          row_count: 1,
          validation_error_count: 0,
          created_at: expect.any(String),
        }),
        expect.objectContaining({
          source_type: "dealertrack",
          filename: "dealertrack.csv",
        }),
      ]),
    );
  });

  test("GET /source-files supports source_type filter", async () => {
    const app = createApp(new MemoryTransactionRepository());
    await uploadCsv(
      app,
      "boa",
      boaUploadCsv("M12121", "1HGCM82633A004352", "$121.00", "12121"),
      "boa.csv",
    );
    await uploadCsv(
      app,
      "dealertrack",
      dealertrackUploadCsv("M12121", "-121"),
      "dealertrack.csv",
    );

    const response = await request(app).get("/source-files").query({ source_type: "boa" });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      source_type: "boa",
      filename: "boa.csv",
    });
  });

  test("stores can be created and source files/runs filter by store", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const storesResponse = await request(app).get("/stores");
    expect(storesResponse.status).toBe(200);
    expect(storesResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Hiley Mazda of Hurst" }),
        expect.objectContaining({ name: "Hiley Mazda of Arlington" }),
      ]),
    );

    const createStoreResponse = await request(app)
      .post("/stores")
      .send({ name: "Hiley Mazda of Test" });
    expect(createStoreResponse.status).toBe(201);
    const storeId = createStoreResponse.body.id as number;

    await createReconciliationWithRows(app, {
      boaCsv: boaUploadCsvMulti([
        { stock: "M50101", vin: "1HGCM82633A004352", amount: "$501.00", reference: "50101" },
      ]),
      dealertrackCsv: dealertrackUploadCsvMulti([{ stock: "M50101", amount: "-501" }]),
      boaFilename: "boa-test-store.csv",
      dealertrackFilename: "dealertrack-test-store.csv",
      storeId,
    });

    const filesResponse = await request(app).get("/source-files").query({ store_id: storeId });
    expect(filesResponse.status).toBe(200);
    expect(filesResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dealership_store_id: storeId,
          store_name: "Hiley Mazda of Test",
        }),
      ]),
    );

    const runsResponse = await request(app).get("/reconciliation-runs").query({ store_id: storeId });
    expect(runsResponse.status).toBe(200);
    expect(runsResponse.body).toEqual([
      expect.objectContaining({
        dealership_store_id: storeId,
        store_name: "Hiley Mazda of Test",
      }),
    ]);
  });

  test("scheduled jobs can auto-run reconciliation when expected files arrive", async () => {
    const app = createApp(new MemoryTransactionRepository());

    const jobResponse = await request(app).post("/automation/scheduled-jobs").send({
      dealership_store_id: 1,
      cadence: "daily",
      expected_source_types: ["boa", "dealertrack"],
      enabled: true,
      auto_run_on_pair: true,
    });
    expect(jobResponse.status).toBe(201);

    await uploadCsv(app, "boa", boaUploadCsv("M30101", "1HGCM82633A004352", "$301.00", "30101"), "auto-boa.csv", 1);
    const dealertrackUpload = await uploadCsv(
      app,
      "dealertrack",
      dealertrackUploadCsv("M30101", "-301", "1HGCM82633A004352"),
      "auto-dealertrack.csv",
      1,
    );

    expect(dealertrackUpload.automated_reconciliation_run_id).toEqual(expect.any(Number));
    const runsResponse = await request(app).get("/reconciliation-runs").query({ store_id: 1 });
    expect(runsResponse.body).toEqual([
      expect.objectContaining({
        status: "completed_auto",
        matched_count: 1,
      }),
    ]);
    const ingestionResponse = await request(app).get("/automation/ingestion-events").query({ store_id: 1 });
    expect(ingestionResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "uploaded" }),
        expect.objectContaining({ state: "normalized" }),
        expect.objectContaining({ state: "reconciled" }),
      ]),
    );
    const eventsResponse = await request(app).get("/automation/events").query({ store_id: 1 });
    expect(eventsResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "reconciliation_completed" }),
      ]),
    );
  });

  test("scheduled due jobs run and missing expected files generate alerts", async () => {
    const app = createApp(new MemoryTransactionRepository());
    await uploadCsv(app, "boa", boaUploadCsv("M30101", "1HGCM82633A004352", "$301.00", "30101"), "due-boa.csv", 1);
    await uploadCsv(app, "dealertrack", dealertrackUploadCsv("M30101", "-301", "1HGCM82633A004352"), "due-dt.csv", 1);
    await request(app).post("/automation/scheduled-jobs").send({
      dealership_store_id: 1,
      cadence: "weekly",
      expected_source_types: ["boa", "dealertrack"],
      enabled: true,
      auto_run_on_pair: false,
      next_run_at: "2026-05-01T00:00:00.000Z",
    });
    await request(app).post("/automation/scheduled-jobs").send({
      dealership_store_id: 2,
      cadence: "weekly",
      expected_source_types: ["boa", "dealertrack"],
      enabled: true,
      auto_run_on_pair: false,
      next_run_at: "2026-05-01T00:00:00.000Z",
    });

    const runResponse = await request(app)
      .post("/automation/run-due-jobs")
      .send({ now: "2026-05-14T00:00:00.000Z" });

    expect(runResponse.status).toBe(200);
    expect(runResponse.body.runs).toEqual([
      expect.objectContaining({ status: "completed_auto" }),
    ]);
    const eventsResponse = await request(app).get("/automation/events");
    expect(eventsResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "missing_expected_file" }),
      ]),
    );
  });

  test("duplicate uploads reuse the existing source file and create a warning event", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const csv = boaUploadCsv("M30101", "1HGCM82633A004352", "$301.00", "30101");
    const firstUpload = await uploadCsv(app, "boa", csv, "duplicate-boa.csv", 1);

    const duplicateResponse = await request(app)
      .post("/upload")
      .field("source_type", "boa")
      .field("store_id", "1")
      .attach("file", Buffer.from(csv), "duplicate-boa-again.csv");

    expect(duplicateResponse.status).toBe(200);
    expect(duplicateResponse.body).toEqual(
      expect.objectContaining({
        source_file_id: firstUpload.source_file_id,
        source_type: "boa",
        filename: "duplicate-boa.csv",
        transaction_count: 1,
        validation_errors: [],
        reused_existing_file: true,
        existing_file: expect.objectContaining({
          source_file_id: firstUpload.source_file_id,
          filename: "duplicate-boa.csv",
          store_name: "Hiley Mazda of Hurst",
          source_type: "boa",
          created_at: expect.any(String),
        }),
      }),
    );
    const ingestionResponse = await request(app).get("/automation/ingestion-events").query({ store_id: 1 });
    expect(ingestionResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "uploaded", message: "Existing upload reused." }),
      ]),
    );
    const eventsResponse = await request(app).get("/automation/events").query({ store_id: 1 });
    expect(eventsResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "duplicate_upload_warning" }),
      ]),
    );
  });

  test("automation status and metrics expose stale store and auto/manual rates", async () => {
    const app = createApp(new MemoryTransactionRepository());
    await createReconciliation(app);

    const statusResponse = await request(app).get("/automation/status");
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dealership_store_id: 2,
          stale_reconciliation: true,
        }),
      ]),
    );
    const metricsResponse = await request(app).get("/automation/metrics");
    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.body).toMatchObject({
      auto_vs_manual_reconciliation_rates: {
        automated_count: 0,
        manual_count: 1,
      },
    });
    expect(metricsResponse.body.stale_stores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dealership_store_id: 2 }),
      ]),
    );
  });

  test("POST /reconcile requires selected source file IDs", async () => {
    const app = createApp(new MemoryTransactionRepository());

    const response = await request(app).post("/reconcile").send({});

    expect(response.status).toBe(422);
    expect(response.body.error.message).toBe("boa_source_file_id is required.");
  });

  test("GET /reconciliation-runs lists persisted runs", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);

    const response = await request(app).get("/reconciliation-runs");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        reconciliation_run_id: reconciliation.reconciliation_run_id,
        boa_filename: "boa-run.csv",
        dealertrack_filename: "dealertrack-run.csv",
        matched_count: 1,
        exception_count: 2,
        duplicate_count: 0,
        status: "completed",
        created_at: expect.any(String),
      }),
    ]);
  });

  test("GET /reconciliation-runs/:id returns run details", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);

    const response = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reconciliation_run_id: reconciliation.reconciliation_run_id,
      matched_count: 1,
      exception_count: 2,
      boa_source_file: {
        source_type: "boa",
        filename: "boa-run.csv",
      },
      dealertrack_source_file: {
        source_type: "dealertrack",
        filename: "dealertrack-run.csv",
      },
    });
    expect(response.body.match_groups).toHaveLength(1);
    expect(response.body.match_groups[0]).toMatchObject({
      match_group_id: expect.any(Number),
      // Source-specific BOA CSV preprocessing now extracts the raw VIN from
      // the Serial No/VIN column directly, so the engine promotes this match
      // from Tier 2 (derived_vin_abs_amount) to Tier 1 (vin_abs_amount).
      match_type: "vin_abs_amount",
      confidence: 1,
      reason: "vin_abs_amount",
      transactions: [
        expect.objectContaining({
          side: "left",
          source_type: "boa",
          transaction: expect.objectContaining({ stock_number: "M30101" }),
        }),
        expect.objectContaining({
          side: "right",
          source_type: "dealertrack",
          transaction: expect.objectContaining({ stock_number: "M30101" }),
        }),
      ],
    });
    expect(response.body.exceptions).toHaveLength(2);
    expect(response.body.exceptions[0]).toEqual(
      expect.objectContaining({
        exception_id: expect.any(Number),
        exception_type: expect.any(String),
        status: "unresolved",
        note: "",
        reason: expect.any(String),
        transaction: expect.objectContaining({
          id: expect.any(Number),
          amount: expect.any(String),
        }),
      }),
    );
  });

  test("GET /reconciliation-runs/:id/snapshot returns immutable normalized inputs", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);

    const response = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}/snapshot`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reconciliation_run_id: reconciliation.reconciliation_run_id,
      engine_version: expect.any(String),
      inputs: [
        expect.objectContaining({
          side: "boa",
          source_type: "boa",
          parser_version: expect.any(String),
          parser_metadata: expect.objectContaining({ normalizer: "normalizeTransactionsFromCsv" }),
        }),
        expect.objectContaining({
          side: "dealertrack",
          source_type: "dealertrack",
          parser_version: expect.any(String),
          parser_metadata: expect.objectContaining({ normalizer: "normalizeTransactionsFromCsv" }),
        }),
      ],
    });
    expect(response.body.inputs[0].transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_type: "boa",
          stock_number: "M30101",
          amount_cents: 30100,
        }),
      ]),
    );
  });

  test("GET /reconciliation-runs/:id/replay uses persisted snapshots and reports unchanged results", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);

    const response = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}/replay`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reconciliation_run_id: reconciliation.reconciliation_run_id,
      results_changed: false,
      original: { matched_count: 1, exception_count: 2 },
      replayed: { matched_count: 1, exception_count: 2 },
      matched_count_delta: 0,
      exception_count_delta: 0,
      newly_matched: [],
      newly_unmatched: [],
      engine_version_difference: expect.objectContaining({ differs: false }),
    });
    expect(response.body.parser_version_difference).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ side: "boa", differs: false }),
        expect.objectContaining({ side: "dealertrack", differs: false }),
      ]),
    );
  });

  test("snapshot records are returned as immutable copies", async () => {
    const repository = new MemoryTransactionRepository();
    const app = createApp(repository);
    const reconciliation = await createReconciliation(app);
    const firstSnapshot = await repository.getReconciliationRunSnapshot(
      1,
      reconciliation.reconciliation_run_id,
    );
    expect(firstSnapshot).not.toBeNull();
    firstSnapshot!.inputs[0].transactions[0].stock_number = "MUTATED";
    firstSnapshot!.inputs[0].parser_metadata.mutated = true;

    const secondSnapshot = await repository.getReconciliationRunSnapshot(
      1,
      reconciliation.reconciliation_run_id,
    );

    expect(secondSnapshot?.inputs[0].transactions[0].stock_number).toBe("M30101");
    expect(secondSnapshot?.inputs[0].parser_metadata).not.toHaveProperty("mutated");
  });

  test("GET /reconciliation-runs/:id returns 404 for missing run", async () => {
    const app = createApp(new MemoryTransactionRepository());

    const response = await request(app).get("/reconciliation-runs/999999");

    expect(response.status).toBe(404);
  });

  test("GET /reconciliation-runs/:id filters exceptions", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);

    const response = await request(app)
      .get(`/reconciliation-runs/${reconciliation.reconciliation_run_id}`)
      .query({
        source_type: "boa",
        exception_type: "missing_in_dealertrack",
        search: "M30202",
      });

    expect(response.status).toBe(200);
    expect(response.body.exception_count).toBe(2);
    expect(response.body.exceptions).toEqual([
      expect.objectContaining({
        exception_type: "missing_in_dealertrack",
        source_type: "boa",
        transaction: expect.objectContaining({
          stock_number: "M30202",
        }),
      }),
    ]);
  });

  test("PATCH /reconciliation-runs/:id/exceptions/:exception_id updates exception review state", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);
    const detailResponse = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}`,
    );
    const exceptionId = detailResponse.body.exceptions[0].exception_id as number;

    const updateResponse = await request(app)
      .patch(`/reconciliation-runs/${reconciliation.reconciliation_run_id}/exceptions/${exceptionId}`)
      .send({
        review_status: "investigating",
        assigned_to: "Maria",
        review_notes: "Checking payoff timing.",
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toMatchObject({
      exception_id: exceptionId,
      status: "unresolved",
      review_status: "investigating",
      assigned_to: "Maria",
      review_notes: "Checking payoff timing.",
      note: "Checking payoff timing.",
    });

    const resolvedResponse = await request(app)
      .patch(`/reconciliation-runs/${reconciliation.reconciliation_run_id}/exceptions/${exceptionId}`)
      .send({ review_status: "resolved", reviewed_by: "Maria" });
    expect(resolvedResponse.body).toMatchObject({
      status: "resolved",
      review_status: "resolved",
      reviewed_by: "Maria",
      reviewed_at: expect.any(String),
    });

    const refreshedResponse = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}`,
    );
    expect(refreshedResponse.body.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exception_id: exceptionId,
          status: "resolved",
          review_status: "resolved",
          assigned_to: "Maria",
          review_notes: "Checking payoff timing.",
          reviewed_by: "Maria",
        }),
      ]),
    );
  });

  test("GET /reconciliation-runs/:id filters exceptions by review status", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);
    const detailResponse = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}`,
    );
    const [resolvedException, unresolvedException] = detailResponse.body.exceptions as Array<{
      exception_id: number;
    }>;

    await request(app)
      .patch(
        `/reconciliation-runs/${reconciliation.reconciliation_run_id}/exceptions/${resolvedException.exception_id}`,
      )
      .send({ status: "resolved" })
      .expect(200);

    const response = await request(app)
      .get(`/reconciliation-runs/${reconciliation.reconciliation_run_id}`)
      .query({ status: "unresolved" });

    expect(response.status).toBe(200);
    expect(response.body.exceptions).toEqual([
      expect.objectContaining({
        exception_id: unresolvedException.exception_id,
        status: "unresolved",
      }),
    ]);
  });

  test("GET /reconciliation-runs/:id filters exceptions by workflow review fields", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);
    const detailResponse = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}`,
    );
    const [investigatingException, otherException] = detailResponse.body.exceptions as Array<{
      exception_id: number;
    }>;

    await request(app)
      .patch(
        `/reconciliation-runs/${reconciliation.reconciliation_run_id}/exceptions/${investigatingException.exception_id}`,
      )
      .send({ review_status: "investigating", assigned_to: "Tara" })
      .expect(200);

    const response = await request(app)
      .get(`/reconciliation-runs/${reconciliation.reconciliation_run_id}`)
      .query({ review_status: "investigating", assigned_to: "tar" });

    expect(response.status).toBe(200);
    expect(response.body.exceptions).toEqual([
      expect.objectContaining({
        exception_id: investigatingException.exception_id,
        review_status: "investigating",
        assigned_to: "Tara",
      }),
    ]);
    expect(response.body.exceptions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exception_id: otherException.exception_id }),
      ]),
    );
  });

  test("GET /reconciliation-runs/:id/analytics compares current run with previous run", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const previous = await createReconciliation(app);
    const current = await createReconciliationWithRows(app, {
      boaCsv: boaUploadCsvMulti([
        { stock: "M30101", vin: "1HGCM82633A004352", amount: "$301.00", reference: "30109" },
        { stock: "M30202", vin: "2HGCM82633A004352", amount: "$302.00", reference: "30209" },
      ]),
      dealertrackCsv: dealertrackUploadCsvMulti([
        { stock: "M30101", amount: "-301", vin: "1HGCM82633A004352" },
        { stock: "M40404", amount: "-404" },
      ]),
      boaFilename: "boa-current-trend.csv",
      dealertrackFilename: "dealertrack-current-trend.csv",
    });

    const response = await request(app).get(
      `/reconciliation-runs/${current.reconciliation_run_id}/analytics`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      current_run_id: current.reconciliation_run_id,
      previous_run_id: previous.reconciliation_run_id,
      run_comparison_summary: {
        current: {
          total_matched_transactions: 1,
          total_exception_count: 2,
          unresolved_count: 2,
        },
        newly_created_count: 1,
        recurring_count: 1,
      },
    });
    expect(response.body.newly_created_exception_ids).toHaveLength(1);
    expect(response.body.recurring_exception_ids).toHaveLength(1);
    expect(response.body.category_summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exception_category: "missing_in_boa",
          current_count: 1,
        }),
      ]),
    );
  });

  test("GET /dealer-groups/analytics aggregates store-level trends", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const storesResponse = await request(app).get("/stores");
    const hurstStoreId = (storesResponse.body as Array<{ id: number; name: string }>).find(
      (store) => store.name === "Hiley Mazda of Hurst",
    )!.id;
    await createReconciliation(app);

    const response = await request(app).get("/dealer-groups/analytics");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dealer_group_name: "Hiley Mazda Group",
          stores: expect.arrayContaining([
            expect.objectContaining({
              dealership_store_id: hurstStoreId,
              store_name: "Hiley Mazda of Hurst",
              run_count: 1,
              unresolved_count: 2,
              recurring_exception_count: 0,
            }),
          ]),
        }),
      ]),
    );
  });

  test("GET /reconciliation-runs/:id/exceptions.csv exports filtered exceptions", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);

    const response = await request(app)
      .get(`/reconciliation-runs/${reconciliation.reconciliation_run_id}/exceptions.csv`)
      .query({ exception_type: "missing_in_boa" });

    expect(response.status).toBe(200);
    expect(response.header["content-type"]).toContain("text/csv");
    expect(response.header["content-disposition"]).toContain(
      `reconciliation-run-${reconciliation.reconciliation_run_id}-exceptions.csv`,
    );
    expect(response.text.split("\n")[0]).toBe(
      [
        "reconciliation_run_id",
        "exception_id",
        "placement",
        "status",
        "note",
        "review_status",
        "assigned_to",
        "review_notes",
        "reviewed_at",
        "reviewed_by",
        "source_type",
        "transaction_id",
        "transaction_date",
        "post_date",
        "amount",
        "amount_cents",
        "reference_number",
        "stock_number",
        "vin",
        "description",
        "research_prompt",
        "created_at",
      ].join(","),
    );
    expect(response.text).toContain(
      "On schedule-not on statement,unresolved,,unreviewed,,,,,dealertrack",
    );
    expect(response.text).toContain("M30303");
    expect(response.text).not.toContain("M30202");
  });

  test("GET /reconciliation-runs/:id/merged-floorplan resolves Hurst config from the run store", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);

    const response = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}/merged-floorplan`,
    );

    expect(response.status).toBe(200);
    expect(response.header["content-type"]).toContain("application/vnd.ms-excel");
    expect(response.header["content-disposition"]).toContain("hurst-merged-floorplan");
    expect(response.text).toContain("<th>HURST</th>");
    expect(response.text).toContain("<th>2100</th>");
    expect(response.text).toContain("BOA total");
    expect(response.text).toContain("2100 total");
    expect(response.text).toContain("603.00");
    expect(response.text).toContain("(604.00)");
    expect(response.text).toContain("1HGCM82633A004352");
    expect(response.text).toContain("2HGCM82633A004352");
    expect(response.text).toContain("M30303");
  });

  test("GET /reconciliation-runs/:id/merged-floorplan can use an explicit Acura override", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);

    const response = await request(app)
      .get(`/reconciliation-runs/${reconciliation.reconciliation_run_id}/merged-floorplan`)
      .query({ store_key: "acura", format: "json" });

    expect(response.status).toBe(200);
    expect(response.body.headers).toEqual([
      "ACURA",
      "Serial No/VIN",
      "VIN6",
      "Ending Balance",
      "324",
      "VIN6",
      "Description",
      "Control",
    ]);
    expect(response.body.store_config).toMatchObject({
      storeKey: "acura",
      mergedSheetLabel: "ACURA",
      dealertrackAccountLabel: "324",
      outputFilenamePrefix: "acura",
    });
    expect(response.body.rows.map((row: { classification: string }) => row.classification)).toEqual([
      "matched",
      "boa_only",
      "dealertrack_only",
    ]);
    expect(response.body.boa_total_amount_cents).toBe(60300);
    expect(response.body.dealertrack_total_amount_cents).toBe(-60400);
  });

  test("GET /reconciliation-runs/:id/merged-floorplan resolves Acura config and 324 preprocessing from the run store", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const storeResponse = await request(app)
      .post("/stores")
      .send({ name: "Hiley Acura" });
    expect(storeResponse.status).toBe(201);
    const acuraStoreId = storeResponse.body.id as number;

    const reconciliation = await createReconciliationWithRows(app, {
      boaCsv: boaUploadCsvMulti([
        { stock: "M30101", vin: "1HGCM82633A004352", amount: "$301.00", reference: "30101" },
        { stock: "M30202", vin: "2HGCM82633A004352", amount: "$302.00", reference: "30202" },
      ]),
      dealertrackCsv: dealertrackUploadCsvMultiForAccount(
        [
          { stock: "M30101", amount: "-301", vin: "1HGCM82633A004352" },
          { stock: "M30303", amount: "-303" },
        ],
        "324",
      ),
      boaFilename: "acura-boa.csv",
      dealertrackFilename: "acura-dt.csv",
      storeId: acuraStoreId,
    });

    const response = await request(app)
      .get(`/reconciliation-runs/${reconciliation.reconciliation_run_id}/merged-floorplan`)
      .query({ format: "json" });
    const detailResponse = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.headers).toEqual([
      "ACURA",
      "Serial No/VIN",
      "VIN6",
      "Ending Balance",
      "324",
      "VIN6",
      "Description",
      "Control",
    ]);
    expect(response.body.store_config).toMatchObject({
      storeKey: "acura",
      mergedSheetLabel: "ACURA",
      dealertrackAccountLabel: "324",
    });
    expect(response.body.rows.map((row: { classification: string }) => row.classification)).toEqual([
      "matched",
      "boa_only",
      "dealertrack_only",
    ]);
    expect(detailResponse.status).toBe(200);
    const dealertrackTransactions = [
      ...detailResponse.body.match_groups.flatMap(
        (group: { transactions: Array<{ source_type: string; transaction: { account: string; account_identifier: string } }> }) =>
          group.transactions,
      ),
      ...detailResponse.body.exceptions,
    ].filter((entry: { source_type: string }) => entry.source_type === "dealertrack");
    expect(
      dealertrackTransactions.every(
        (entry: { transaction: { account: string; account_identifier: string } }) =>
          entry.transaction.account === "324" &&
          entry.transaction.account_identifier === "floorplan",
      ),
    ).toBe(true);
  });

  test("GET /reconciliation-runs/:id/merged-floorplan validates unconfigured stores and bad overrides", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const storeResponse = await request(app)
      .post("/stores")
      .send({ name: "Hiley Mazda of Test" });
    expect(storeResponse.status).toBe(201);
    const testStoreId = storeResponse.body.id as number;
    const reconciliation = await createReconciliationWithRows(app, {
      boaCsv: boaUploadCsv("M50101", "1HGCM82633A004352", "$501.00", "50101"),
      dealertrackCsv: dealertrackUploadCsv("M50101", "-501", "1HGCM82633A004352"),
      boaFilename: "boa-unconfigured-store.csv",
      dealertrackFilename: "dt-unconfigured-store.csv",
      storeId: testStoreId,
    });

    const unconfiguredStore = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}/merged-floorplan`,
    );
    const badOverride = await request(app)
      .get(`/reconciliation-runs/${reconciliation.reconciliation_run_id}/merged-floorplan`)
      .query({ store_key: "lexus" });
    const explicitOverride = await request(app)
      .get(`/reconciliation-runs/${reconciliation.reconciliation_run_id}/merged-floorplan`)
      .query({ store_key: "hurst", format: "json" });

    expect(unconfiguredStore.status).toBe(422);
    expect(unconfiguredStore.body.error).toMatchObject({
      code: "STORE_WORKFLOW_CONFIG_NOT_FOUND",
      message: "No store workflow config is configured for this reconciliation run.",
    });
    expect(unconfiguredStore.body.error.details).toMatchObject({
      dealership_store_id: testStoreId,
      store_name: "Hiley Mazda of Test",
      supported_store_keys: ["hurst", "acura", "fw"],
    });
    expect(badOverride.status).toBe(422);
    expect(badOverride.body.error).toMatchObject({
      code: "INVALID_STORE_KEY",
      message: "store_key must be one of: hurst, acura, fw.",
    });
    expect(explicitOverride.status).toBe(200);
    expect(explicitOverride.body.headers[0]).toBe("HURST");
  });

  test("merged floorplan export keeps Dealertrack account_identifier grouped as floorplan", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);

    const exportResponse = await request(app)
      .get(`/reconciliation-runs/${reconciliation.reconciliation_run_id}/merged-floorplan`)
      .query({ store_key: "hurst", format: "json" });
    const detailResponse = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}`,
    );
    const accountResponse = await request(app).get("/accounts/summary");

    expect(exportResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    const dealertrackTransactions = [
      ...detailResponse.body.match_groups.flatMap(
        (group: { transactions: Array<{ source_type: string; transaction: { account_identifier: string } }> }) =>
          group.transactions,
      ),
      ...detailResponse.body.exceptions,
    ].filter((entry: { source_type: string }) => entry.source_type === "dealertrack");
    expect(
      dealertrackTransactions.every(
        (entry: { transaction: { account_identifier: string } }) =>
          entry.transaction.account_identifier === "floorplan",
      ),
    ).toBe(true);
    expect(accountResponse.status).toBe(200);
    expect(accountResponse.body.map((account: { account_identifier: string }) => account.account_identifier)).toEqual([
      "floorplan",
    ]);
  });

  test("GET /reconciliation-runs/:id/exceptions.csv excludes weak amount-only duplicate candidates", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const boaUpload = await uploadCsv(
      app,
      "boa",
      boaUploadCsv("M21055", "1HGCM82633A004352", "$31,051.00", "116411"),
      "boa-weak-duplicates.csv",
    );
    const dealertrackUpload = await uploadCsv(
      app,
      "dealertrack",
      [
        'M21055,"BOA FLOORPLAN CX-30 1HGCM82633A004352",-31051,0',
        'M21286,"BOA FLOORPLAN CX-30 3MVDMBXL6TM128759",-31051,0',
      ].join("\n"),
      "dealertrack-weak-duplicates.csv",
    );

    const reconciliation = await request(app).post("/reconcile").send({
      boa_source_file_id: boaUpload.source_file_id,
      dealertrack_source_file_id: dealertrackUpload.source_file_id,
    });

    expect(reconciliation.status).toBe(200);
    expect(reconciliation.body.duplicate_count).toBe(0);

    const response = await request(app).get(
      `/reconciliation-runs/${reconciliation.body.reconciliation_run_id}/exceptions.csv`,
    );

    expect(response.status).toBe(200);
    expect(response.text).not.toContain("duplicate_transaction");
  });

  test("GET /reconciliation-runs/:id/exceptions.csv includes Dealertrack VIN from Hiley export", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const boaUpload = await uploadCsv(
      app,
      "boa",
      boaUploadCsv("M99999", "1HGCM82633A004352", "$1.00", "99999"),
      "boa-hiley-regression.csv",
    );
    const dealertrackUpload = await uploadCsv(
      app,
      "dealertrack",
      [
        "Control,Description,2100,2110",
        "BOA,BANK OF AMERICA,0,-250000",
        "M20552,JM3KFBCM9S0716259,-34050,0",
      ].join("\n"),
      "dealertrack-hiley-regression.csv",
    );
    const reconciliation = await request(app).post("/reconcile").send({
      boa_source_file_id: boaUpload.source_file_id,
      dealertrack_source_file_id: dealertrackUpload.source_file_id,
    });

    const response = await request(app)
      .get(`/reconciliation-runs/${reconciliation.body.reconciliation_run_id}/exceptions.csv`)
      .query({ exception_type: "missing_in_boa" });

    expect(reconciliation.status).toBe(200);
    expect(response.status).toBe(200);
    expect(response.text).toContain("M20552");
    expect(response.text).toContain("JM3KFBCM9S0716259");
    expect(response.text).not.toContain("BANK OF AMERICA");
  });

  test("GET /accounts/summary aggregates integer cents and unresolved exceptions", async () => {
    const app = createApp(new MemoryTransactionRepository());
    await createReconciliation(app);

    const response = await request(app).get("/accounts/summary");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        account_identifier: "floorplan",
        account_type: "floorplan",
        net_difference_amount_cents: -100,
        net_difference_amount: "-1.00",
        unresolved_exception_count: 2,
        source_totals: [
          expect.objectContaining({
            source_type: "boa",
            amount_cents: 60300,
            transaction_count: 2,
          }),
          expect.objectContaining({
            source_type: "dealertrack",
            amount_cents: -60400,
            transaction_count: 2,
          }),
        ],
      }),
    ]);
  });

  test("GET /accounts/:account_identifier returns account detail from persisted records", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);

    const response = await request(app).get("/accounts/floorplan");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      account_identifier: "floorplan",
      transactions_by_source_type: {
        boa: expect.arrayContaining([
          expect.objectContaining({
            account_identifier: "floorplan",
            amount_cents: 30100,
          }),
        ]),
        dealertrack: expect.arrayContaining([
          expect.objectContaining({
            account_identifier: "floorplan",
            account: "2100",
            amount_cents: -30100,
          }),
        ]),
      },
      related_reconciliation_runs: [
        expect.objectContaining({
          reconciliation_run_id: reconciliation.reconciliation_run_id,
        }),
      ],
      unresolved_exceptions: expect.arrayContaining([
        expect.objectContaining({
          status: "unresolved",
          transaction: expect.objectContaining({ account_identifier: "floorplan" }),
        }),
      ]),
    });
  });

  test("account unresolved exception counts change when reviews are resolved", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);
    const detailResponse = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}`,
    );
    const exceptionId = detailResponse.body.exceptions[0].exception_id as number;

    await request(app)
      .patch(`/reconciliation-runs/${reconciliation.reconciliation_run_id}/exceptions/${exceptionId}`)
      .send({ status: "resolved" })
      .expect(200);

    const summaryResponse = await request(app).get("/accounts/summary");
    const detail = await request(app).get("/accounts/floorplan");

    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body[0].unresolved_exception_count).toBe(1);
    expect(detail.status).toBe(200);
    expect(detail.body.unresolved_exceptions).toHaveLength(1);
  });

  test("account endpoints respect dealership scoping", async () => {
    const repository = new MemoryTransactionRepository();
    const firstDealershipApp = createApp(repository, [], 1);
    const secondDealershipApp = createApp(repository, [], 2);

    await uploadCsv(
      firstDealershipApp,
      "bank",
      [
        "transaction_date,amount,description,account",
        "2026-04-30,1.23,Store deposit,1000",
      ].join("\n"),
      "bank-first.csv",
    );
    await uploadCsv(
      secondDealershipApp,
      "bank",
      [
        "transaction_date,amount,description,account",
        "2026-04-30,4.56,Store deposit,2000",
      ].join("\n"),
      "bank-second.csv",
    );

    const firstSummary = await request(firstDealershipApp).get("/accounts/summary");
    const secondSummary = await request(secondDealershipApp).get("/accounts/summary");
    const crossDetail = await request(secondDealershipApp).get("/accounts/1000");

    expect(firstSummary.body).toEqual([
      expect.objectContaining({ account_identifier: "1000", net_difference_amount_cents: 123 }),
    ]);
    expect(secondSummary.body).toEqual([
      expect.objectContaining({ account_identifier: "2000", net_difference_amount_cents: 456 }),
    ]);
    expect(crossDetail.status).toBe(404);
  });

  test("GET /reports/month-end filters account totals by reporting period", async () => {
    const app = createApp(new MemoryTransactionRepository());
    await uploadCsv(
      app,
      "bank",
      [
        "transaction_date,amount,description,account",
        "2026-04-30,1.23,April deposit,1000",
        "2026-05-01,4.56,May deposit,1000",
      ].join("\n"),
      "bank-period.csv",
    );

    const response = await request(app).get("/reports/month-end").query({
      start_date: "2026-04-01",
      end_date: "2026-04-30",
      format: "json",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reporting_period: {
        start_date: "2026-04-01",
        end_date: "2026-04-30",
      },
      generated_at: expect.any(String),
      account_summaries: [
        expect.objectContaining({
          account_identifier: "1000",
          account_type: "bank",
          net_difference_amount_cents: 123,
          source_totals: [
            expect.objectContaining({
              source_type: "bank",
              amount_cents: 123,
              transaction_count: 1,
            }),
          ],
        }),
      ],
      reconciliation_runs_included: [],
    });
  });

  test("GET /reports/month-end reports cent totals and exception status counts", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const boaUpload = await uploadCsv(
      app,
      "boa",
      boaUploadCsvMulti([
        { stock: "M30101", vin: "1HGCM82633A004352", amount: "$100.00", reference: "30101" },
        { stock: "M30202", vin: "2HGCM82633A004352", amount: "$200.00", reference: "30202" },
        { stock: "M30404", vin: "4HGCM82633A004352", amount: "$300.00", reference: "30404" },
      ]),
      "boa-report.csv",
    );
    const dealertrackUpload = await uploadCsv(
      app,
      "dealertrack",
      dealertrackUploadCsv("M30101", "-100", "1HGCM82633A004352"),
      "dealertrack-report.csv",
    );
    const reconciliationResponse = await request(app).post("/reconcile").send({
      boa_source_file_id: boaUpload.source_file_id,
      dealertrack_source_file_id: dealertrackUpload.source_file_id,
    });
    expect(reconciliationResponse.status).toBe(200);
    const reconciliation = reconciliationResponse.body as { reconciliation_run_id: number };
    const detailResponse = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}`,
    );
    const [resolvedException, ignoredException] = detailResponse.body.exceptions as Array<{
      exception_id: number;
    }>;
    await request(app)
      .patch(
        `/reconciliation-runs/${reconciliation.reconciliation_run_id}/exceptions/${resolvedException.exception_id}`,
      )
      .send({ status: "resolved" })
      .expect(200);
    await request(app)
      .patch(
        `/reconciliation-runs/${reconciliation.reconciliation_run_id}/exceptions/${ignoredException.exception_id}`,
      )
      .send({ status: "ignored" })
      .expect(200);

    const response = await request(app).get("/reports/month-end").query({
      start_date: "2025-09-01",
      end_date: "2025-09-30",
    });

    expect(response.status).toBe(200);
    expect(response.body.account_summaries).toEqual([
      expect.objectContaining({
        account_identifier: "floorplan",
        account_type: "floorplan",
        net_difference_amount_cents: 60000,
        unresolved_exception_count: 0,
        resolved_exception_count: 1,
        ignored_exception_count: 1,
        source_totals: [
          expect.objectContaining({
            source_type: "boa",
            amount_cents: 60000,
          }),
        ],
      }),
    ]);
    expect(response.body.reconciliation_runs_included).toEqual([
      expect.objectContaining({
        reconciliation_run_id: reconciliation.reconciliation_run_id,
      }),
    ]);
  });

  test("GET /reports/month-end exports CSV", async () => {
    const app = createApp(new MemoryTransactionRepository());
    await createReconciliation(app);

    const response = await request(app).get("/reports/month-end").query({
      start_date: "2025-09-01",
      end_date: "2025-09-30",
      format: "csv",
    });

    expect(response.status).toBe(200);
    expect(response.header["content-type"]).toContain("text/csv");
    expect(response.header["content-disposition"]).toContain(
      "month-end-2025-09-01-to-2025-09-30.csv",
    );
    expect(response.text.split("\n")[0]).toBe(
      [
        "account_identifier",
        "account_type",
        "boa_total",
        "dealertrack_total",
        "net_difference",
        "unresolved_exception_count",
        "resolved_exception_count",
        "ignored_exception_count",
      ].join(","),
    );
    expect(response.text).toContain("floorplan,floorplan,603.00,0.00,603.00,1,0,0");
  });

  test("GET /reports/month-end rejects invalid query parameters", async () => {
    const app = createApp(new MemoryTransactionRepository());

    const response = await request(app).get("/reports/month-end").query({
      start_date: "2026-05-01",
      end_date: "2026-04-30",
      format: "pdf",
    });

    expect(response.status).toBe(422);
  });

  test("POST /reconcile only compares selected source files", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const boaUpload = await uploadCsv(
      app,
      "boa",
      boaUploadCsv("M11111", "1HGCM82633A004352", "$100.00", "111111"),
      "boa-one.csv",
    );
    const dealertrackUpload = await uploadCsv(
      app,
      "dealertrack",
      dealertrackUploadCsv("M11111", "-100", "1HGCM82633A004352"),
      "dealertrack-one.csv",
    );
    await uploadCsv(
      app,
      "dealertrack",
      dealertrackUploadCsv("M99999", "-999"),
      "dealertrack-extra.csv",
    );

    const response = await request(app).post("/reconcile").send({
      boa_source_file_id: boaUpload.source_file_id,
      dealertrack_source_file_id: dealertrackUpload.source_file_id,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reconciliation_run_id: expect.any(Number),
      matched_count: 1,
      exception_count: 0,
      duplicate_count: 0,
    });
  });

  test("POST /reconcile rejects cross-dealership source files", async () => {
    const repository = new MemoryTransactionRepository();
    const firstDealershipApp = createApp(repository, [], 1);
    const secondDealershipApp = createApp(repository, [], 2);
    const boaUpload = await uploadCsv(
      firstDealershipApp,
      "boa",
      boaUploadCsv("M11111", "1HGCM82633A004352", "$100.00", "111111"),
      "boa-one.csv",
    );
    const dealertrackUpload = await uploadCsv(
      secondDealershipApp,
      "dealertrack",
      dealertrackUploadCsv("M11111", "-100"),
      "dealertrack-one.csv",
    );

    const response = await request(firstDealershipApp).post("/reconcile").send({
      boa_source_file_id: boaUpload.source_file_id,
      dealertrack_source_file_id: dealertrackUpload.source_file_id,
    });

    expect(response.status).toBe(403);
  });

  test("reconciliation reads reject cross-dealership runs and exceptions", async () => {
    const repository = new MemoryTransactionRepository();
    const firstDealershipApp = createApp(repository, [], 1);
    const secondDealershipApp = createApp(repository, [], 2);
    const reconciliation = await createReconciliation(firstDealershipApp);
    const detail = await request(firstDealershipApp).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}`,
    );
    const exceptionId = detail.body.exceptions[0].exception_id as number;

    const runResponse = await request(secondDealershipApp).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}`,
    );
    const exportResponse = await request(secondDealershipApp).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}/exceptions.csv`,
    );
    const patchResponse = await request(secondDealershipApp)
      .patch(`/reconciliation-runs/${reconciliation.reconciliation_run_id}/exceptions/${exceptionId}`)
      .send({ status: "ignored" });

    expect(runResponse.status).toBe(403);
    expect(exportResponse.status).toBe(403);
    expect(patchResponse.status).toBe(403);
  });

  test("POST /reconcile repeated uploads do not pollute later reconciliation", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const boaCsv = boaUploadCsv("M22222", "2HGCM82633A004352", "$222.00", "222222");
    const dealertrackCsv = dealertrackUploadCsv("M22222", "-222", "2HGCM82633A004352");

    await uploadCsv(app, "boa", boaCsv, "boa-first.csv");
    await uploadCsv(app, "dealertrack", dealertrackCsv, "dealertrack-first.csv");
    const secondBoaUpload = await uploadCsv(
      app,
      "boa",
      boaUploadCsv("M22222", "2HGCM82633A004352", "$222.00", "222223"),
      "boa-second.csv",
    );
    const secondDealertrackUpload = await uploadCsv(
      app,
      "dealertrack",
      [
        "Control,Description,2100,2110",
        'M22222,"BOA FLOORPLAN SECOND 2HGCM82633A004352",-222,0',
      ].join("\n"),
      "dealertrack-second.csv",
    );

    const response = await request(app).post("/reconcile").send({
      boa_source_file_id: secondBoaUpload.source_file_id,
      dealertrack_source_file_id: secondDealertrackUpload.source_file_id,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reconciliation_run_id: expect.any(Number),
      matched_count: 1,
      exception_count: 0,
      duplicate_count: 0,
    });
  });

  test("POST /reconcile rejects mismatched source file source types", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const bankUpload = await uploadCsv(
      app,
      "bank",
      [
        "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
        "2026-04-30,2026-05-01,100.00,DEP-1001,Daily deposit,1000,STK123,1HGCM82633A004352",
      ].join("\n"),
      "bank.csv",
    );
    const dealertrackUpload = await uploadCsv(
      app,
      "dealertrack",
      dealertrackUploadCsv("M12345", "-100"),
      "dealertrack.csv",
    );

    const response = await request(app).post("/reconcile").send({
      boa_source_file_id: bankUpload.source_file_id,
      dealertrack_source_file_id: dealertrackUpload.source_file_id,
    });

    expect(response.status).toBe(400);
  });

  test("PATCH on a BOA-side exception routes review_notes into boa_notes", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);
    const detail = await request(app).get(`/reconciliation-runs/${reconciliation.reconciliation_run_id}`);
    const boaException = detail.body.exceptions.find(
      (exception: { source_type: string }) => exception.source_type === "boa",
    );
    expect(boaException).toBeDefined();

    const updateResponse = await request(app)
      .patch(`/reconciliation-runs/${reconciliation.reconciliation_run_id}/exceptions/${boaException.exception_id}`)
      .send({ review_notes: "Statement only — chasing title" });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toMatchObject({
      review_notes: "Statement only — chasing title",
      boa_notes: "Statement only — chasing title",
      gl_notes: "",
    });
  });

  test("PATCH supports explicit boa_notes and gl_notes overrides", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const reconciliation = await createReconciliation(app);
    const detail = await request(app).get(`/reconciliation-runs/${reconciliation.reconciliation_run_id}`);
    const exceptionId = detail.body.exceptions[0].exception_id;

    const updateResponse = await request(app)
      .patch(`/reconciliation-runs/${reconciliation.reconciliation_run_id}/exceptions/${exceptionId}`)
      .send({ boa_notes: "explicit boa", gl_notes: "explicit gl" });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toMatchObject({
      boa_notes: "explicit boa",
      gl_notes: "explicit gl",
    });
  });

  test("hurst-fp-rec returns a compact accounting worksheet export model", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const first = await createReconciliationWithRows(app, {
      boaCsv: boaUploadCsvMulti([
        { stock: "M30101", vin: "1HGCM82633A004352", amount: "$301.00", reference: "30101" },
        { stock: "M30202", vin: "2HGCM82633A004352", amount: "$302.00", reference: "30202" },
      ]),
      dealertrackCsv: dealertrackUploadCsvMulti([
        { stock: "M30101", amount: "-301", vin: "1HGCM82633A004352" },
        { stock: "M99999", amount: "-999" },
      ]),
      boaFilename: "boa-first.csv",
      dealertrackFilename: "dt-first.csv",
      storeId: 1,
    });
    const firstDetail = await request(app).get(
      `/reconciliation-runs/${first.reconciliation_run_id}`,
    );
    const firstBoaException = firstDetail.body.exceptions.find(
      (exception: { source_type: string; transaction: { stock_number: string | null } }) =>
        exception.source_type === "boa" && exception.transaction.stock_number === "M30202",
    );
    expect(firstBoaException).toBeDefined();
    await request(app)
      .patch(
        `/reconciliation-runs/${first.reconciliation_run_id}/exceptions/${firstBoaException.exception_id}`,
      )
      .send({ review_notes: "carry me forward" });

    const second = await createReconciliationWithRows(app, {
      boaCsv: boaUploadCsvMulti([
        { stock: "M30101", vin: "1HGCM82633A004352", amount: "$301.00", reference: "30101" },
        { stock: "M30202", vin: "2HGCM82633A004352", amount: "$302.00", reference: "30202" },
        { stock: "M40404", vin: "4HGCM82633A004352", amount: "$404.00", reference: "40404" },
      ]),
      dealertrackCsv: dealertrackUploadCsvMulti([
        { stock: "M30101", amount: "-301", vin: "1HGCM82633A004352" },
        { stock: "M99999", amount: "-999" },
        { stock: "M77777", amount: "-777" },
      ]),
      boaFilename: "boa-second.csv",
      dealertrackFilename: "dt-second.csv",
      storeId: 1,
    });

    const workbookResponse = await request(app)
      .get(`/reconciliation-runs/${second.reconciliation_run_id}/hurst-fp-rec`)
      .query({ format: "json" });

    expect(workbookResponse.status).toBe(200);
    expect(workbookResponse.body.store_name).toBe("Hiley Mazda of Hurst");
    expect(workbookResponse.body.schedule_not_on_statement).toBeDefined();
    expect(workbookResponse.body.statement_not_on_gl).toBeDefined();
    expect(workbookResponse.body.net_adjustments_amount_cents).toEqual(expect.any(Number));
    expect(workbookResponse.body.variance_amount_cents).toEqual(expect.any(Number));
    expect(workbookResponse.body).not.toHaveProperty("reconciliation_run_id");
    expect(workbookResponse.body).not.toHaveProperty("generated_at");
    expect(workbookResponse.body).not.toHaveProperty("boa_filename");
    expect(workbookResponse.body).not.toHaveProperty("dealertrack_filename");
    expect(workbookResponse.body).not.toHaveProperty("needs_review");
    expect(workbookResponse.body).not.toHaveProperty("sign_off");
    const row =
      workbookResponse.body.statement_not_on_gl.rows[0] ??
      workbookResponse.body.schedule_not_on_statement.rows[0];
    expect(row).toEqual(
      expect.objectContaining({
        unit_reference: expect.any(String),
        amount_cents: expect.any(Number),
        gl_floored_note: expect.any(String),
        boa_floored_note: expect.any(String),
      }),
    );
    expect(row).not.toHaveProperty("vin");
    expect(row).not.toHaveProperty("review_status");
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
    .field("source_type", sourceType)
  if (storeId) {
    uploadRequest.field("store_id", String(storeId));
  }
  const response = await uploadRequest.attach("file", Buffer.from(csv), filename);

  expect(response.status).toBe(200);
  return response.body as { source_file_id: number; automated_reconciliation_run_id?: number | null };
}

async function createReconciliation(app: ReturnType<typeof createApp>) {
  return createReconciliationWithRows(app, {
    boaCsv: boaUploadCsvMulti([
      { stock: "M30101", vin: "1HGCM82633A004352", amount: "$301.00", reference: "30101" },
      { stock: "M30202", vin: "2HGCM82633A004352", amount: "$302.00", reference: "30202" },
    ]),
    // Embed BOA VIN in the Dealertrack description so the engine can
    // auto-match by derived full VIN + amount. Without the VIN, stock alone is
    // not a trusted match key and the rows stay in Hiley placement sections.
    dealertrackCsv: dealertrackUploadCsvMulti([
      { stock: "M30101", amount: "-301", vin: "1HGCM82633A004352" },
      { stock: "M30303", amount: "-303" },
    ]),
    boaFilename: "boa-run.csv",
    dealertrackFilename: "dealertrack-run.csv",
    storeId: undefined,
  });
}

async function createReconciliationWithAgent(agent: ReturnType<typeof request.agent>) {
  const boaUpload = await agent
    .post("/upload")
    .field("source_type", "boa")
    .field("store_id", "1")
    .attach(
      "file",
      Buffer.from(
        boaUploadCsvMulti([
          { stock: "M30101", vin: "1HGCM82633A004352", amount: "$301.00", reference: "30101" },
          { stock: "M30202", vin: "2HGCM82633A004352", amount: "$302.00", reference: "30202" },
        ]),
      ),
      "boa-run.csv",
    );
  const dealertrackUpload = await agent
    .post("/upload")
    .field("source_type", "dealertrack")
    .field("store_id", "1")
    .attach(
      "file",
      Buffer.from(
        dealertrackUploadCsvMulti([
          { stock: "M30101", amount: "-301", vin: "1HGCM82633A004352" },
          { stock: "M30303", amount: "-303" },
        ]),
      ),
      "dealertrack-run.csv",
    );
  const response = await agent.post("/reconcile").send({
    boa_source_file_id: boaUpload.body.source_file_id,
    dealertrack_source_file_id: dealertrackUpload.body.source_file_id,
    dealership_store_id: 1,
  });
  expect(response.status).toBe(200);
  return response.body as { reconciliation_run_id: number };
}

async function createReconciliationWithRows(
  app: ReturnType<typeof createApp>,
  {
    boaCsv,
    dealertrackCsv,
    boaFilename,
    dealertrackFilename,
    storeId,
  }: {
    boaCsv: string;
    dealertrackCsv: string;
    boaFilename: string;
    dealertrackFilename: string;
    storeId?: number;
  },
) {
  const boaUpload = await uploadCsv(app, "boa", boaCsv, boaFilename, storeId);
  const dealertrackUpload = await uploadCsv(
    app,
    "dealertrack",
    dealertrackCsv,
    dealertrackFilename,
    storeId,
  );

  const response = await request(app).post("/reconcile").send({
    boa_source_file_id: boaUpload.source_file_id,
    dealertrack_source_file_id: dealertrackUpload.source_file_id,
    ...(storeId ? { dealership_store_id: storeId } : {}),
  });

  expect(response.status).toBe(200);
  expect(response.body.vin_presence_diagnostics).toMatchObject({
    extracted_vin_sets: {
      boa: expect.any(Array),
      dealertrack: expect.any(Array),
    },
    vin_presence_exceptions: {
      dealertrack_not_in_boa: expect.any(Array),
      boa_not_in_dealertrack: expect.any(Array),
    },
    transaction_unmatched_shared_vins: expect.any(Array),
  });
  return response.body as { reconciliation_run_id: number };
}
