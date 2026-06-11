import { describe, expect, test } from "vitest";

import type { ParsedTable } from "../parsers/types.js";
import { preprocessDealertrack } from "./dealertrackPreprocessor.js";
import { LINEAGE_RAW_DATA_KEY, type RawDataLineage } from "./types.js";

function table(header: string[] | null, rows: string[][]): ParsedTable {
  return { header, rows, warnings: [] };
}

describe("preprocessDealertrack", () => {
  test("uses 2100 column as canonical amount even when 9999 is non-zero", () => {
    const parsed = table(["Control", "Description", "2100", "9999"], [
      ["M10001", "FLOORPLAN ADV 1FAKEVN0000A0001X", "-25000.00", "999.99"],
    ]);
    const result = preprocessDealertrack(parsed);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount_cents).toBe(-2_500_000);
    expect(result.transactions[0].account).toBe("2100");
    expect(result.transactions[0].account_identifier).toBe("floorplan");
    const lineage = result.transactions[0].raw_data[LINEAGE_RAW_DATA_KEY] as RawDataLineage;
    expect(
      lineage.transformations.find((t) => t.stage === "amount_resolved")?.detail,
    ).toBe("2100");
  });

  test("uses configured account column while preserving logical floorplan account identifier", () => {
    const parsed = table(["Control", "Description", "324"], [
      ["A10001", "ACURA FLOORPLAN 19UDE4H21TA011251", "-34436.00"],
    ]);
    const result = preprocessDealertrack(parsed, { accountColumn: "324", accountLabel: "324" });

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      amount_cents: -3_443_600,
      account: "324",
      account_identifier: "floorplan",
      account_type: "floorplan",
      stock_number: "A10001",
    });
    expect(result.transactions[0].raw_data).toMatchObject({
      "324": "(34,436.00)",
    });
  });

  test("aggregates configured FW amount columns while excluding 2110", () => {
    const parsed = table(["Control", "Description", "2100", "2101", "2101S", "2110"], [
      ["R10001", "FW FLOORPLAN 4S4GUHD68T3706986", "-25000.00", "-30000.00", "-5000.00", "-2000000.00"],
    ]);
    const result = preprocessDealertrack(parsed, {
      amountColumns: ["2100", "2101", "2101S"],
      accountColumn: "2100",
      accountLabel: "2100",
      excludedAccountColumns: ["2110"],
    });

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      amount_cents: -6_000_000,
      account: "2100",
      account_identifier: "floorplan",
      account_type: "floorplan",
      stock_number: "R10001",
    });
    expect(result.transactions[0].raw_data).toMatchObject({
      Control: "R10001",
      "2100": "(60,000.00)",
      VIN6: "706986",
    });
    expect(result.transactions[0].raw_data).not.toHaveProperty("2101");
    expect(result.transactions[0].raw_data).not.toHaveProperty("2101S");
    expect(result.transactions[0].raw_data).not.toHaveProperty("2110");
    const lineage = result.transactions[0].raw_data[LINEAGE_RAW_DATA_KEY] as RawDataLineage;
    expect(
      lineage.transformations.find((t) => t.stage === "amount_resolved")?.detail,
    ).toBe("2100+2101+2101S");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "header_row_detected",
          details: expect.objectContaining({
            amount_columns: "2100,2101,2101s",
            has_amount_columns: true,
          }),
        }),
      ]),
    );
  });

  test("does not fall back to sibling account columns when 2100 is zero", () => {
    const parsed = table(["Control", "Description", "2100", "9999"], [
      ["M20000", "FLOORPLAN ADV 1FAKEVN0000A0002X", "0.00", "-12345.00"],
    ]);
    const result = preprocessDealertrack(parsed);
    expect(result.transactions).toHaveLength(0);
    expect(result.summary.rows_removed_zero_balance).toBe(1);
    expect(result.diagnostics.some((d) => d.kind === "ambiguous_amount_column")).toBe(false);
  });

  test("removes 2110 from the working output and keeps 2100 as accounting-formatted basis", () => {
    const parsed = table(["Control", "Description", "2100", "2110"], [
      ["M20001", "FLOORPLAN ADV 1FAKEVN0000A0002X", "-12345.00", "-999.00"],
    ]);
    const result = preprocessDealertrack(parsed);

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount_cents).toBe(-1_234_500);
    expect(result.transactions[0].raw_data).toMatchObject({
      Control: "M20001",
      "2100": "(12,345.00)",
      "DT total helper": "=D2 + E2",
      "VIN6 description variance/helper": "=C2 - F2",
      VIN6: "A0002X",
    });
    expect(result.transactions[0].raw_data).not.toHaveProperty("2110");
    const lineage = result.transactions[0].raw_data[LINEAGE_RAW_DATA_KEY] as RawDataLineage;
    expect(
      lineage.transformations.some((stage) => stage.stage === "working_columns_pruned"),
    ).toBe(true);
  });

  test("removes zero-amount rows with diagnostic", () => {
    const parsed = table(["Control", "Description", "2100"], [
      ["M30000", "FLOORPLAN ADV", "0.00"],
    ]);
    const result = preprocessDealertrack(parsed);
    expect(result.transactions).toHaveLength(0);
    expect(result.summary.rows_removed_zero_balance).toBe(1);
  });

  test("removes Straightline rows with diagnostic", () => {
    const parsed = table(["Control", "Description", "2100", "2110"], [
      ["M30001", "Straightline depreciation 1FAKEVN0000A0001X", "-25000.00", "0.00"],
      ["M30002", "FLOORPLAN ADV 1FAKEVN0000A0002X", "-26000.00", "0.00"],
    ]);
    const result = preprocessDealertrack(parsed);

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].stock_number).toBe("M30002");
    expect(result.summary.rows_removed_straightline).toBe(1);
    expect(result.diagnostics.some((d) => d.kind === "straightline_row_removed")).toBe(true);
  });

  test("treats whitespace-padded VINs as trusted when matching is anchored", () => {
    const parsed = table(["Control", "Description", "2100"], [
      ["M40000", "FLOORPLAN ADV   1FAKEVN0000A0003X   ", "-15000.00"],
    ]);
    const result = preprocessDealertrack(parsed);
    expect(result.transactions[0].vin).toBe("1FAKEVN0000A0003X");
  });

  test("dirty VIN (description-only) is recorded as enrichment candidate", () => {
    const parsed = table(["Control", "Description", "2100"], [
      ["M50000", "FLOORPLAN ADV BAD-VIN-INPUT", "-9000.00"],
    ]);
    const result = preprocessDealertrack(parsed);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].vin).toBeNull();
    expect(result.summary.rows_requiring_manual_enrichment).toBe(1);
    expect(result.diagnostics.some((d) => d.kind === "manual_enrichment_required")).toBe(true);
  });

  test("sorts retained rows by largest amount then VIN6 ascending", () => {
    const parsed = table(["Control", "Description", "2100"], [
      ["M001", "FLOORPLAN 1FAKEVN0000A00ZZZ", "-10000.00"],
      ["M002", "FLOORPLAN 1FAKEVN0000A00AAA", "-30000.00"],
      ["M003", "FLOORPLAN 1FAKEVN0000A00BBB", "-10000.00"],
    ]);
    const result = preprocessDealertrack(parsed);
    expect(result.transactions.map((t) => t.amount_cents)).toEqual([
      -3_000_000,
      -1_000_000,
      -1_000_000,
    ]);
    expect(result.transactions.map((t) => t.vin)).toEqual([
      "1FAKEVN0000A00AAA",
      "1FAKEVN0000A00BBB",
      "1FAKEVN0000A00ZZZ",
    ]);
  });

  test("missing VIN row preserves lineage with untrusted provenance", () => {
    const parsed = table(["Control", "Description", "2100"], [
      ["M60000", "FLOORPLAN UNKNOWN", "-7500.00"],
    ]);
    const result = preprocessDealertrack(parsed);
    const lineage = result.transactions[0].raw_data[LINEAGE_RAW_DATA_KEY] as RawDataLineage;
    expect(lineage.vin_provenance?.trusted).toBe(false);
    expect(lineage.vin_provenance?.source).toBe("untrusted");
  });

  test("falls back to positional column 3 when no header present", () => {
    const parsed = table(null, [
      ["M70000", "FLOORPLAN ADV 1FAKEVN0000A0004W", "-25000", "0"],
    ]);
    const result = preprocessDealertrack(parsed);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount_cents).toBe(-2_500_000);
  });

  test("duplicate VIN6 across rows is surfaced as diagnostic", () => {
    const parsed = table(["Control", "Description", "2100"], [
      ["M001", "FLOORPLAN 1FAKEVN0000A0001X", "-1000.00"],
      ["M002", "FLOORPLAN DUP 1FAKEVN0000A0001X", "-2000.00"],
    ]);
    const result = preprocessDealertrack(parsed);
    expect(result.summary.duplicate_vin6_count).toBe(1);
    expect(result.diagnostics.some((d) => d.kind === "duplicate_vin")).toBe(true);
  });

  test("deterministic across repeat invocations", () => {
    const parsed = table(["Control", "Description", "2100"], [
      ["M001", "FLOORPLAN 1FAKEVN0000A0001X", "-2000.00"],
      ["M002", "FLOORPLAN 1FAKEVN0000A0002Y", "-3000.00"],
    ]);
    const a = preprocessDealertrack(parsed);
    const b = preprocessDealertrack(parsed);
    expect(a.transactions.map((t) => t.amount_cents)).toEqual(
      b.transactions.map((t) => t.amount_cents),
    );
    expect(a.summary.rows_accepted).toBe(b.summary.rows_accepted);
  });
});
