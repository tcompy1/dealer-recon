import request from "supertest";
import { describe, expect, test } from "vitest";

import { createApp } from "./app.js";
import { MemoryAuthRepository } from "./auth.js";
import { MemoryTransactionRepository } from "./repositories/transactionRepository.js";
import { MAX_CSV_ROWS } from "./services/transactionNormalizer.js";

const boaUploadCsv = (stockNumber: string, vin: string, amount: string, reference = "382882") =>
  [`,,,9/26/2025,${reference},,${stockNumber},,${vin},,"${amount}",`].join("\n");

const dealertrackUploadCsv = (stockNumber: string, amount: string, vin?: string) =>
  vin
    ? `${stockNumber},"BOA FLOORPLAN ${vin}",${amount},0`
    : `${stockNumber},"BOA FLOORPLAN",${amount},0`;

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
    expect(response.body).toEqual({ status: "not_ready" });
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

  test("POST /upload rejects duplicate file contents for the same source type", async () => {
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

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      source_file_id: firstUpload.source_file_id,
      filename: "bank.csv",
    });
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
      boaRows: [boaUploadCsv("M50101", "1HGCM82633A004352", "$501.00", "50101")],
      dealertrackRows: [dealertrackUploadCsv("M50101", "-501")],
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

  test("duplicate uploads create ingestion failure and operational warning events", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const csv = boaUploadCsv("M30101", "1HGCM82633A004352", "$301.00", "30101");
    await uploadCsv(app, "boa", csv, "duplicate-boa.csv", 1);

    const duplicateResponse = await request(app)
      .post("/upload")
      .field("source_type", "boa")
      .field("store_id", "1")
      .attach("file", Buffer.from(csv), "duplicate-boa-again.csv");

    expect(duplicateResponse.status).toBe(409);
    const ingestionResponse = await request(app).get("/automation/ingestion-events").query({ store_id: 1 });
    expect(ingestionResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "failed", message: "Duplicate upload detected." }),
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
    expect(response.body.detail).toBe("boa_source_file_id is required.");
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
      match_type: "derived_vin_abs_amount",
      confidence: 0.98,
      reason: "derived_vin_abs_amount",
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
      boaRows: [
        boaUploadCsv("M30101", "1HGCM82633A004352", "$301.00", "30109"),
        boaUploadCsv("M30202", "2HGCM82633A004352", "$302.00", "30209"),
      ],
      dealertrackRows: [
        dealertrackUploadCsv("M30101", "-301", "1HGCM82633A004352"),
        dealertrackUploadCsv("M40404", "-404"),
      ],
      boaFilename: "boa-current-trend.csv",
      dealertrackFilename: "dealertrack-current-trend.csv",
    });

    const currentDetail = await request(app).get(
      `/reconciliation-runs/${current.reconciliation_run_id}`,
    );
    const assignedException = currentDetail.body.exceptions[0].exception_id as number;
    await request(app)
      .patch(`/reconciliation-runs/${current.reconciliation_run_id}/exceptions/${assignedException}`)
      .send({ review_status: "investigating", assigned_to: "Tara" })
      .expect(200);

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
          match_rate_percent: expect.any(Number),
        },
        newly_resolved_count: 1,
        newly_created_count: 1,
        recurring_count: 1,
      },
    });
    expect(response.body.newly_created_exception_ids).toHaveLength(1);
    expect(response.body.newly_resolved_exception_ids).toHaveLength(1);
    expect(response.body.recurring_exception_ids).toHaveLength(1);
    expect(response.body.category_delta_summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exception_category: "missing_in_boa",
          current_count: 1,
          previous_count: 1,
          delta: 0,
        }),
      ]),
    );
    expect(response.body.reviewer_workload_trends).toEqual([
      {
        reviewer: "Tara",
        current_count: 1,
        previous_count: 0,
        delta: 1,
      },
    ]);
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
              match_rate_percent: expect.any(Number),
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
        "exception_type",
        "exception_category",
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
        "reason",
        "created_at",
      ].join(","),
    );
    expect(response.text).toContain(
      "missing_in_boa,missing_in_boa,unresolved,,unreviewed,,,,,dealertrack",
    );
    expect(response.text).toContain("M30303");
    expect(response.text).not.toContain("M30202");
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
      [
        boaUploadCsv("M30101", "1HGCM82633A004352", "$100.00", "30101"),
        boaUploadCsv("M30202", "2HGCM82633A004352", "$200.00", "30202"),
        boaUploadCsv("M30404", "4HGCM82633A004352", "$300.00", "30404"),
      ].join("\n"),
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
      'M22222,"BOA FLOORPLAN SECOND 2HGCM82633A004352",-222,0',
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

  test("hurst-fp-rec carries forward unresolved items from a prior run for the same store", async () => {
    const app = createApp(new MemoryTransactionRepository());
    const first = await createReconciliationWithRows(app, {
      boaRows: [
        boaUploadCsv("M30101", "1HGCM82633A004352", "$301.00", "30101"),
        boaUploadCsv("M30202", "2HGCM82633A004352", "$302.00", "30202"),
      ],
      dealertrackRows: [
        dealertrackUploadCsv("M30101", "-301", "1HGCM82633A004352"),
        dealertrackUploadCsv("M99999", "-999"),
      ],
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
      boaRows: [
        boaUploadCsv("M30101", "1HGCM82633A004352", "$301.00", "30101"),
        boaUploadCsv("M30202", "2HGCM82633A004352", "$302.00", "30202"),
        boaUploadCsv("M40404", "4HGCM82633A004352", "$404.00", "40404"),
      ],
      dealertrackRows: [
        dealertrackUploadCsv("M30101", "-301", "1HGCM82633A004352"),
        dealertrackUploadCsv("M99999", "-999"),
        dealertrackUploadCsv("M77777", "-777"),
      ],
      boaFilename: "boa-second.csv",
      dealertrackFilename: "dt-second.csv",
      storeId: 1,
    });

    const workbookResponse = await request(app)
      .get(`/reconciliation-runs/${second.reconciliation_run_id}/hurst-fp-rec`)
      .query({ format: "json" });

    expect(workbookResponse.status).toBe(200);
    expect(workbookResponse.body.carried_forward_count).toBeGreaterThanOrEqual(1);
    const carriedRow =
      workbookResponse.body.statement_not_on_gl.rows.find(
        (row: { carried_forward: boolean }) => row.carried_forward,
      ) ??
      workbookResponse.body.schedule_not_on_statement.rows.find(
        (row: { carried_forward: boolean }) => row.carried_forward,
      );
    expect(carriedRow).toBeDefined();
    expect(carriedRow.previous_run_id).toBe(first.reconciliation_run_id);
    if (carriedRow.prior_boa_notes || carriedRow.prior_gl_notes) {
      expect(`${carriedRow.prior_boa_notes}${carriedRow.prior_gl_notes}`).toContain(
        "carry me forward",
      );
    }
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
    boaRows: [
      boaUploadCsv("M30101", "1HGCM82633A004352", "$301.00", "30101"),
      boaUploadCsv("M30202", "2HGCM82633A004352", "$302.00", "30202"),
    ],
    dealertrackRows: [
      // Embed BOA VIN in the Dealertrack description so the v2 engine can
      // auto-match by derived full VIN + amount (Tier 2). Without the VIN, the
      // pair would be demoted to Needs Review under v2 because stock alone is
      // not a trusted match key.
      dealertrackUploadCsv("M30101", "-301", "1HGCM82633A004352"),
      dealertrackUploadCsv("M30303", "-303"),
    ],
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
        [
          boaUploadCsv("M30101", "1HGCM82633A004352", "$301.00", "30101"),
          boaUploadCsv("M30202", "2HGCM82633A004352", "$302.00", "30202"),
        ].join("\n"),
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
        [
          dealertrackUploadCsv("M30101", "-301", "1HGCM82633A004352"),
          dealertrackUploadCsv("M30303", "-303"),
        ].join("\n"),
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
    boaRows,
    dealertrackRows,
    boaFilename,
    dealertrackFilename,
    storeId,
  }: {
    boaRows: string[];
    dealertrackRows: string[];
    boaFilename: string;
    dealertrackFilename: string;
    storeId?: number;
  },
) {
  const boaUpload = await uploadCsv(app, "boa", boaRows.join("\n"), boaFilename, storeId);
  const dealertrackUpload = await uploadCsv(
    app,
    "dealertrack",
    dealertrackRows.join("\n"),
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
