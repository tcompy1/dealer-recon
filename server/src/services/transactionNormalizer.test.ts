import { describe, expect, test, vi } from "vitest";

import { normalizeTransactionsFromCsv } from "./transactionNormalizer.js";

describe("normalizeTransactionsFromCsv", () => {
  test("parses normalized bank CSV rows", () => {
    const result = normalizeTransactionsFromCsv(
      [
        "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
        "2026-04-30,2026-05-01,1234.56,DEP-1001,Daily deposit,1000,STK123,1HGCM82633A004352",
      ].join("\n"),
      "bank",
    );

    expect(result.validationErrors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      source_type: "bank",
      transaction_date: "2026-04-30",
      post_date: "2026-05-01",
      amount_cents: 123456,
      reference_number: "DEP-1001",
      stock_number: "STK123",
      vin: "1HGCM82633A004352",
    });
  });

  test("rejects amounts with more than two decimal places instead of rounding", () => {
    const result = normalizeTransactionsFromCsv(
      [
        "transaction_date,post_date,amount,reference_number,description,account,stock_number,vin",
        "2026-04-30,2026-05-01,1234.567,DEP-1001,Daily deposit,1000,STK123,1HGCM82633A004352",
      ].join("\n"),
      "bank",
    );

    expect(result.transactions).toHaveLength(0);
    expect(result.validationErrors).toEqual([
      expect.objectContaining({
        field: "amount",
        message: "Amount is required and must be a valid number.",
      }),
    ]);
  });

  test("parses BOA real floorplan row shape and skips report metadata", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = normalizeTransactionsFromCsv(
      [
        "Report generated,5/1/2026,,,,,,,,,,",
        ',,,9/26/2025,382882,,M20657,,7MMVABAM8SN382882,,"$31,525.00",',
      ].join("\n"),
      "boa",
    );

    expect(result.validationErrors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      source_type: "boa",
      transaction_date: "2025-09-26",
      amount_cents: 3152500,
      reference_number: "382882",
      stock_number: "M20657",
      vin: "7MMVABAM8SN382882",
    });
    expect(result.transactions[0].raw_data.column_10).toBe("$31,525.00");
    expect(stderr.mock.calls[0][0]).toContain("rows_scanned=2");
    expect(stderr.mock.calls[0][0]).toContain("rows_accepted=1");
    expect(stderr.mock.calls[0][0]).toContain("rows_skipped=1");
    stderr.mockRestore();
  });

  test("BOA filter rejects headers, totals, empty rows, and rows without currency", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = normalizeTransactionsFromCsv(
      [
        "Report generated,5/1/2026,,,,,,,,,,",
        "Customer Name,Account,Floorplan Report,,,,,,,,",
        'Subtotal,,,,M20657,,,,,,"$31,525.00",',
        ",,,,,,,,,,,",
        "Notes,row,without,numbers,,,,,,,",
        ',,,9/26/2025,382882,,M20657,,7MMVABAM8SN382882,,"$31,525.00",',
        'Total,,,,,,,,,,"$31,525.00",',
        ',,,10/01/2025,708021,,M20450,,,, "$0.00",',
        ',,,10/01/2025,708021,,,,7MMVABAM8SN382882,, "$0.00",',
        ',,,10/02/2025,,,,,,, "$0.00",',
      ].join("\n"),
      "boa",
    );

    expect(result.validationErrors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions.map((transaction) => transaction.reference_number)).toEqual([
      "382882",
    ]);
    expect(stderr.mock.calls[0][0]).toContain("rows_scanned=10");
    expect(stderr.mock.calls[0][0]).toContain("rows_accepted=1");
    expect(stderr.mock.calls[0][0]).toContain("rows_skipped=9");
    stderr.mockRestore();
  });

  test("parses Dealertrack positional rows without headers", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = normalizeTransactionsFromCsv(
      ['M20450,"BOA FLOORPLAN",-32558,0', 'M00000,"ZERO ROW",0,0', 'BAD,"BOA FLOORPLAN",-111,0'].join(
        "\n",
      ),
      "dealertrack",
    );

    expect(result.validationErrors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      source_type: "dealertrack",
      transaction_date: null,
      amount_cents: -3255800,
      stock_number: "M20450",
      description: "BOA FLOORPLAN",
    });
    expect(result.transactions[0].raw_data.column_3).toBe("0");
    stderr.mockRestore();
  });
});
