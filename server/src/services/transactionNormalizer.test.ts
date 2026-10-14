import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { normalizeTransactionsFromCsv } from "./transactionNormalizer.js";

function spyOnConsoleError() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

function withParserDebug<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.PARSER_DEBUG;
  if (value === undefined) {
    delete process.env.PARSER_DEBUG;
  } else {
    process.env.PARSER_DEBUG = value;
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env.PARSER_DEBUG;
    } else {
      process.env.PARSER_DEBUG = prev;
    }
  }
}

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
    withParserDebug("true", () => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = normalizeTransactionsFromCsv(
        [
          "Report generated,5/1/2026,,,,,,,,,,",
          ',,,9/26/2025,910091,,M70053,,1TESTCARXXA910091,,"$31,525.00",',
        ].join("\n"),
        "boa",
      );

      expect(result.validationErrors).toEqual([]);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]).toMatchObject({
        source_type: "boa",
        transaction_date: "2025-09-26",
        amount_cents: 3152500,
        reference_number: "910091",
        stock_number: "M70053",
        vin: "1TESTCARXXA910091",
      });
      expect(result.transactions[0].raw_data.column_10).toBe("$31,525.00");
      expect(stderr.mock.calls[0][0]).toContain("rows_scanned=2");
      expect(stderr.mock.calls[0][0]).toContain("rows_accepted=1");
      expect(stderr.mock.calls[0][0]).toContain("rows_skipped=1");
      stderr.mockRestore();
    });
  });

  test("parses BOA export headers for Serial No/VIN and balance amount", () => {
    withParserDebug("true", () => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = normalizeTransactionsFromCsv(
        [
          "Serial No/VIN,Stock/Lease No,Original Amount,Beginning Balance,Ending Balance",
          "1TESTCARXXA910008,M70105,34050,34050,34050",
        ].join("\n"),
        "boa",
      );

      expect(result.validationErrors).toEqual([]);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]).toMatchObject({
        source_type: "boa",
        amount_cents: 3405000,
        stock_number: "M70105",
        vin: "1TESTCARXXA910008",
      });
      expect(result.transactions[0].raw_data["Serial No/VIN"]).toBe("1TESTCARXXA910008");
      stderr.mockRestore();
    });
  });

  test("BOA filter rejects headers, totals, empty rows, and rows without currency", () => {
    withParserDebug("true", () => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = normalizeTransactionsFromCsv(
        [
          "Report generated,5/1/2026,,,,,,,,,,",
          "Customer Name,Account,Floorplan Report,,,,,,,,",
          'Subtotal,,,,M70053,,,,,,"$31,525.00",',
          ",,,,,,,,,,,",
          "Notes,row,without,numbers,,,,,,,",
          ',,,9/26/2025,910091,,M70053,,1TESTCARXXA910091,,"$31,525.00",',
          'Total,,,,,,,,,,"$31,525.00",',
          ',,,10/01/2025,910004,,M70080,,,, "$0.00",',
          ',,,10/01/2025,910004,,,,1TESTCARXXA910091,, "$0.00",',
          ',,,10/02/2025,,,,,,, "$0.00",',
        ].join("\n"),
        "boa",
      );

      expect(result.validationErrors).toEqual([]);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions.map((transaction) => transaction.reference_number)).toEqual([
        "910091",
      ]);
      expect(stderr.mock.calls[0][0]).toContain("rows_scanned=10");
      expect(stderr.mock.calls[0][0]).toContain("rows_accepted=1");
      expect(stderr.mock.calls[0][0]).toContain("rows_skipped=9");
      stderr.mockRestore();
    });
  });

  test("parses Dealertrack positional rows without headers", () => {
    withParserDebug("true", () => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = normalizeTransactionsFromCsv(
        ['M70080,"BOA FLOORPLAN",-32558,0', 'M00000,"ZERO ROW",0,0', 'BAD,"BOA FLOORPLAN",-111,0'].join(
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
        stock_number: "M70080",
        description: "BOA FLOORPLAN",
      });
      expect(result.transactions[0].raw_data.column_3).toBe("0");
      stderr.mockRestore();
    });
  });

  test("parses Dealertrack Hiley control export with VIN in Description", () => {
    withParserDebug("true", () => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = normalizeTransactionsFromCsv(
        [
          "Control,Description,2100,2110",
          "BOA,BANK OF AMERICA,0,-250000",
          "M70080,BOA FLOORPLAN,-32558,0",
          "M70105,1TESTCARXXA910008,-34050,0",
          "M70071,1TESTCARXXA910007,-32028,0",
        ].join("\n"),
        "dealertrack",
      );

      expect(result.validationErrors).toEqual([]);
      expect(result.transactions).toHaveLength(3);
      expect(result.transactions[0]).toMatchObject({
        amount_cents: -3255800,
        stock_number: "M70080",
        description: "BOA FLOORPLAN",
        vin: null,
      });
      expect(result.transactions[1]).toMatchObject({
        amount_cents: -3405000,
        stock_number: "M70105",
        description: "1TESTCARXXA910008",
        vin: "1TESTCARXXA910008",
      });
      expect(result.transactions[1].raw_data).toMatchObject({
        Control: "M70105",
        Description: "1TESTCARXXA910008",
        "2100": "-34050",
        "2110": "0",
      });
      expect(stderr.mock.calls[0][0]).toContain("rows_scanned=5");
      expect(stderr.mock.calls[0][0]).toContain("rows_accepted=3");
      expect(stderr.mock.calls[0][0]).toContain("rows_skipped=2");
      stderr.mockRestore();
    });
  });

  describe("parser debug gating", () => {
    let stderr: ReturnType<typeof spyOnConsoleError>;
    const previousNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
      stderr = spyOnConsoleError();
    });

    afterEach(() => {
      stderr.mockRestore();
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    });

    test("does not print parser debug or row samples by default", () => {
      withParserDebug(undefined, () => {
        normalizeTransactionsFromCsv(
          [
            "Control,Description,2100,2110",
            "M70105,1TESTCARXXA910008,-34050,0",
          ].join("\n"),
          "dealertrack",
        );
        expect(stderr).not.toHaveBeenCalled();
      });
    });

    test("does not print parser debug when PARSER_DEBUG is falsey", () => {
      for (const value of ["", "0", "false", "no", "off"]) {
        stderr.mockClear();
        withParserDebug(value, () => {
          normalizeTransactionsFromCsv(
            [
              "Control,Description,2100,2110",
              "M70105,1TESTCARXXA910008,-34050,0",
            ].join("\n"),
            "dealertrack",
          );
          expect(stderr).not.toHaveBeenCalled();
        });
      }
    });

    test("prints parser debug when PARSER_DEBUG is enabled", () => {
      withParserDebug("true", () => {
        normalizeTransactionsFromCsv(
          [
            "Control,Description,2100,2110",
            "M70105,1TESTCARXXA910008,-34050,0",
          ].join("\n"),
          "dealertrack",
        );
        expect(stderr).toHaveBeenCalled();
        expect(String(stderr.mock.calls[0][0])).toContain("Dealertrack parser debug");
      });
    });

    test("suppresses parser debug in production even if PARSER_DEBUG=true", () => {
      process.env.NODE_ENV = "production";
      withParserDebug("true", () => {
        normalizeTransactionsFromCsv(
          [
            "Control,Description,2100,2110",
            "M70105,1TESTCARXXA910008,-34050,0",
          ].join("\n"),
          "dealertrack",
        );
        expect(stderr).not.toHaveBeenCalled();
      });
    });
  });
});
