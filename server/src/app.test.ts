import request from "supertest";
import { describe, expect, test } from "vitest";

import { createApp } from "./app.js";
import { MemoryTransactionRepository } from "./repositories/transactionRepository.js";
import { MAX_CSV_ROWS } from "./services/transactionNormalizer.js";

const boaUploadCsv = (stockNumber: string, vin: string, amount: string, reference = "382882") =>
  [`,,,9/26/2025,${reference},,${stockNumber},,${vin},,"${amount}",`].join("\n");

const dealertrackUploadCsv = (stockNumber: string, amount: string) =>
  `${stockNumber},"BOA FLOORPLAN",${amount},0`;

describe("app", () => {
  test("GET /health returns ok", async () => {
    const app = createApp(new MemoryTransactionRepository());

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
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
      match_type: "stock_number_amount",
      confidence: 0.92,
      reason: "stock_number_amount",
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
      .send({ status: "resolved", note: "Cleared by warranty credit." });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toMatchObject({
      exception_id: exceptionId,
      status: "resolved",
      note: "Cleared by warranty credit.",
    });

    const refreshedResponse = await request(app).get(
      `/reconciliation-runs/${reconciliation.reconciliation_run_id}`,
    );
    expect(refreshedResponse.body.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exception_id: exceptionId,
          status: "resolved",
          note: "Cleared by warranty credit.",
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
        "status",
        "note",
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
    expect(response.text).toContain("missing_in_boa,unresolved,,dealertrack");
    expect(response.text).toContain("M30303");
    expect(response.text).not.toContain("M30202");
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
      dealertrackUploadCsv("M11111", "-100"),
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
    const dealertrackCsv = dealertrackUploadCsv("M22222", "-222");

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
      'M22222,"BOA FLOORPLAN SECOND",-222,0',
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
});

async function uploadCsv(
  app: ReturnType<typeof createApp>,
  sourceType: string,
  csv: string,
  filename: string,
) {
  const response = await request(app)
    .post("/upload")
    .field("source_type", sourceType)
    .attach("file", Buffer.from(csv), filename);

  expect(response.status).toBe(200);
  return response.body as { source_file_id: number };
}

async function createReconciliation(app: ReturnType<typeof createApp>) {
  const boaUpload = await uploadCsv(
    app,
    "boa",
    [
      boaUploadCsv("M30101", "1HGCM82633A004352", "$301.00", "30101"),
      boaUploadCsv("M30202", "2HGCM82633A004352", "$302.00", "30202"),
    ].join("\n"),
    "boa-run.csv",
  );
  const dealertrackUpload = await uploadCsv(
    app,
    "dealertrack",
    [dealertrackUploadCsv("M30101", "-301"), dealertrackUploadCsv("M30303", "-303")].join("\n"),
    "dealertrack-run.csv",
  );

  const response = await request(app).post("/reconcile").send({
    boa_source_file_id: boaUpload.source_file_id,
    dealertrack_source_file_id: dealertrackUpload.source_file_id,
  });

  expect(response.status).toBe(200);
  return response.body as { reconciliation_run_id: number };
}
