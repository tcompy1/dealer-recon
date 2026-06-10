import { describe, expect, test } from "vitest";

import type { ParsedTable } from "../parsers/types.js";
import { preprocessBoa } from "./boaPreprocessor.js";
import { LINEAGE_RAW_DATA_KEY, type RawDataLineage } from "./types.js";

function table(header: string[] | null, rows: string[][]): ParsedTable {
  return { header, rows, warnings: [] };
}

const HEADER = [
  "Invoice Date",
  "Invoice Number",
  "VIN / Serial Number",
  "Stock / Lease Number",
  "Original Amount",
  "Beginning Balance",
  "Ending Balance",
  "Principal Payment",
  "Interest",
  "Fees",
  "Maturity Date",
];

describe("preprocessBoa", () => {
  test("treats Ending Balance as canonical even when Original Amount differs", () => {
    const parsed = table(HEADER, [
      [
        "03/01/2026",
        "INV-1001",
        "1FTFW1E80PFA11111",
        "M10001",
        "$30,000.00",
        "$30,000.00",
        "$25,000.00",
        "$5,000.00",
        "$120.00",
        "$0.00",
        "2027-03-01",
      ],
    ]);
    const result = preprocessBoa(parsed);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount_cents).toBe(2_500_000);
    const lineage = result.transactions[0].raw_data[LINEAGE_RAW_DATA_KEY] as RawDataLineage;
    expect(
      lineage.transformations.find((t) => t.stage === "amount_resolved")?.detail,
    ).toBe("ending_balance");
    expect(lineage.maturity_date).toBe("2027-03-01");
    expect(result.summary.current_month_maturity_count).toBe(0);
    expect(result.transactions[0].raw_data).not.toHaveProperty("Maturity Date");
  });

  test("prunes retained raw_data to the confirmed Hiley working columns", () => {
    const parsed = table(
      [
        "Location",
        "Manufacturer Name",
        "Plant Name",
        "Invoice Date",
        "Invoice Number",
        "Interest Start Date",
        "Type",
        "Model #",
        "VIN / Serial Number",
        "Stock/Lease #",
        "Original Amount",
        "Beginning Balance",
        "Advances",
        "Last Advance Date",
        "Principal Payments",
        "Principal Adjustments",
        "Maturity Date",
        "Ending Balance",
        "Interest",
        "Fees",
      ],
      [
        [
          "Hurst",
          "Mazda",
          "JP",
          "04/01/2026",
          "INV-2001",
          "04/02/2026",
          "Retail",
          "CX-5",
          "1FTFW1E80PFA11111",
          "M20001",
          "$30,000.00",
          "$28,000.00",
          "$100.00",
          "04/05/2026",
          "$500.00",
          "$0.00",
          "07/15/2026",
          "$27,500.00",
          "$25.00",
          "$5.00",
        ],
      ],
    );

    const result = preprocessBoa(parsed, { now: new Date("2026-06-09T12:00:00Z") });
    expect(result.transactions).toHaveLength(1);
    const rawData = result.transactions[0].raw_data;

    expect(rawData).toMatchObject({
      "VIN / Serial Number": "1FTFW1E80PFA11111",
      "Ending Balance": "$27,500.00",
    });
    expect(rawData).not.toHaveProperty("Location");
    expect(rawData).not.toHaveProperty("Manufacturer Name");
    expect(rawData).not.toHaveProperty("Plant Name");
    expect(rawData).not.toHaveProperty("Invoice Date");
    expect(rawData).not.toHaveProperty("Invoice Number");
    expect(rawData).not.toHaveProperty("Interest Start Date");
    expect(rawData).not.toHaveProperty("Type");
    expect(rawData).not.toHaveProperty("Model #");
    expect(rawData).not.toHaveProperty("Stock/Lease #");
    expect(rawData).not.toHaveProperty("Original Amount");
    expect(rawData).not.toHaveProperty("Beginning Balance");
    expect(rawData).not.toHaveProperty("Advances");
    expect(rawData).not.toHaveProperty("Last Advance Date");
    expect(rawData).not.toHaveProperty("Principal Payments");
    expect(rawData).not.toHaveProperty("Principal Adjustments");
    expect(rawData).not.toHaveProperty("Maturity Date");
    expect(rawData).not.toHaveProperty("Interest");
    expect(rawData).not.toHaveProperty("Fees");
  });

  test("flags current-calendar-month maturities for payoff review", () => {
    const parsed = table(
      [
        "Invoice Date",
        "VIN / Serial Number",
        "Stock / Lease Number",
        "Maturity Date",
        "Ending Balance",
      ],
      [
        ["04/01/2026", "1FTFW1E80PFA11111", "M20001", "06/15/2026", "$25,000.00"],
        ["04/02/2026", "1FTFW1E80PFA22222", "M20002", "07/15/2026", "$26,000.00"],
      ],
    );

    const result = preprocessBoa(parsed, { now: new Date("2026-06-09T12:00:00Z") });
    expect(result.summary.current_month_maturity_count).toBe(1);
    expect(
      result.diagnostics.some((d) => d.kind === "current_month_maturity_payoff_review"),
    ).toBe(true);

    const currentMaturity = result.transactions.find((transaction) => transaction.stock_number === "M20001");
    expect(currentMaturity?.raw_data).toHaveProperty("Maturity Date", "06/15/2026");
    const lineage = currentMaturity?.raw_data[LINEAGE_RAW_DATA_KEY] as RawDataLineage;
    expect(
      lineage.transformations.some((stage) => stage.stage === "maturity_payoff_review_flagged"),
    ).toBe(true);
  });

  test("drops zero-balance rows with a diagnostic", () => {
    const parsed = table(HEADER, [
      [
        "03/05/2026",
        "INV-1003",
        "2FAKEVN0000B0002Y",
        "M10002",
        "$30,000.00",
        "$30,000.00",
        "$0.00",
        "$30,000.00",
        "$0.00",
        "$0.00",
        "",
      ],
    ]);
    const result = preprocessBoa(parsed);
    expect(result.transactions).toHaveLength(0);
    expect(result.summary.rows_removed_zero_balance).toBe(1);
    expect(result.diagnostics.some((d) => d.kind === "zero_balance_row_removed")).toBe(true);
  });

  test("drops Straightline rows with a diagnostic", () => {
    const parsed = table(HEADER, [
      [
        "03/05/2026",
        "INV-1010",
        "1FAKEVN0000A0001X",
        "M10010",
        "$100.00",
        "$100.00",
        "$100.00",
        "$0.00",
        "$0.00",
        "$0.00",
        "",
      ],
      [
        "03/05/2026",
        "INV-STRAIGHT",
        "",
        "",
        "$0.00",
        "$0.00",
        "$0.00",
        "$0.00",
        "$0.00",
        "$0.00",
        "Straightline accrual",
      ],
    ]);
    const result = preprocessBoa(parsed);
    expect(result.transactions).toHaveLength(1);
    expect(result.summary.rows_removed_straightline).toBe(1);
    expect(result.diagnostics.some((d) => d.kind === "straightline_row_removed")).toBe(true);
  });

  test("removes banner rows when header is auto-located", () => {
    const parsed = table(null, [
      ["Bank of America Billing Statement"],
      ["Account: FAKE-0001  Period: 2026-03"],
      [],
      HEADER,
      [
        "03/02/2026",
        "INV-1002",
        "1FTFW1E80PFA11111",
        "M10001",
        "$25,000.00",
        "$25,000.00",
        "$25,000.00",
        "$0.00",
        "$120.00",
        "$0.00",
        "",
      ],
    ]);
    const result = preprocessBoa(parsed);
    expect(result.transactions).toHaveLength(1);
    expect(result.summary.rows_removed_banner).toBeGreaterThanOrEqual(2);
    expect(result.diagnostics.some((d) => d.kind === "banner_row_removed")).toBe(true);
    expect(result.diagnostics.some((d) => d.kind === "header_row_detected")).toBe(true);
  });

  test("sorts rows by ending balance ascending then vin6 ascending", () => {
    const parsed = table(HEADER, [
      [
        "03/01",
        "INV-A",
        "1FAKEVN0000A00AAA",
        "M001",
        "",
        "",
        "$30,000.00",
        "",
        "",
        "",
        "",
      ],
      [
        "03/02",
        "INV-B",
        "1FAKEVN0000A00BBB",
        "M002",
        "",
        "",
        "$10,000.00",
        "",
        "",
        "",
        "",
      ],
      [
        "03/03",
        "INV-C",
        "1FAKEVN0000A00ZZZ",
        "M003",
        "",
        "",
        "$10,000.00",
        "",
        "",
        "",
        "",
      ],
    ]);
    const result = preprocessBoa(parsed);
    expect(result.transactions.map((t) => t.amount_cents)).toEqual([
      1_000_000,
      1_000_000,
      3_000_000,
    ]);
    expect(result.transactions.map((t) => t.vin)).toEqual([
      "1FAKEVN0000A00BBB",
      "1FAKEVN0000A00ZZZ",
      "1FAKEVN0000A00AAA",
    ]);
    expect(result.summary.ending_balance_autosum_cents).toBe(5_000_000);
    expect(result.summary.ending_balance_autosum_amount).toBe("50000.00");
    expect(result.diagnostics.some((d) => d.kind === "ending_balance_autosum_applied")).toBe(true);
  });

  test("surfaces VIN-less rows as manual_enrichment_required", () => {
    const parsed = table(HEADER, [
      [
        "03/01/2026",
        "INV-NOVIN",
        "",
        "M999",
        "",
        "",
        "$5,000.00",
        "",
        "",
        "",
        "",
      ],
    ]);
    const result = preprocessBoa(parsed);
    expect(result.transactions).toHaveLength(1);
    expect(result.summary.rows_requiring_manual_enrichment).toBe(1);
    expect(result.diagnostics.some((d) => d.kind === "manual_enrichment_required")).toBe(true);
    const lineage = result.transactions[0].raw_data[LINEAGE_RAW_DATA_KEY] as RawDataLineage;
    expect(lineage.vin_provenance?.trusted).toBe(false);
  });

  test("flags duplicate VIN6 across retained rows", () => {
    const parsed = table(HEADER, [
      [
        "03/01",
        "INV-A",
        "1FAKEVN0000A0001X",
        "M001",
        "",
        "",
        "$10,000.00",
        "",
        "",
        "",
        "",
      ],
      [
        "03/02",
        "INV-B",
        "1FAKEVN0000A0001X",
        "M002",
        "",
        "",
        "$12,000.00",
        "",
        "",
        "",
        "",
      ],
    ]);
    const result = preprocessBoa(parsed);
    expect(result.summary.duplicate_vin6_count).toBe(1);
    expect(result.diagnostics.some((d) => d.kind === "duplicate_vin")).toBe(true);
  });

  test("preprocessing is deterministic across repeat invocations", () => {
    const parsed = table(HEADER, [
      [
        "03/01",
        "INV-A",
        "1FAKEVN0000A0001X",
        "M001",
        "",
        "",
        "$10,000.00",
        "",
        "",
        "",
        "",
      ],
      [
        "03/02",
        "INV-B",
        "1FAKEVN0000A0002Y",
        "M002",
        "",
        "",
        "$15,000.00",
        "",
        "",
        "",
        "",
      ],
    ]);
    const a = preprocessBoa(parsed);
    const b = preprocessBoa(parsed);
    expect(a.transactions.map((t) => ({ vin: t.vin, amount: t.amount_cents }))).toEqual(
      b.transactions.map((t) => ({ vin: t.vin, amount: t.amount_cents })),
    );
    expect(a.summary.rows_accepted).toBe(b.summary.rows_accepted);
  });
});
