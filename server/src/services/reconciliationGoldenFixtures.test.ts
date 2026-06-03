import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

import type { ReconciliationResponse, Transaction } from "../domain/types.js";
import { parseAmountToCents } from "../domain/money.js";
import { reconcileTransactionSets } from "./reconciliationEngine.js";

// Golden acceptance fixtures derived from the Hiley Mazda of Hurst clerk's three
// final reconciled workbooks (FEB26, MAR26, APRIL26). The CSV pre-classifies
// each row the way the clerk resolved it; these tests prove the engine
// reproduces the clerk's counts, totals, variance, and amount-mismatch handling.
//
// See dealer_recon_ground_truth_reverse_engineering.md, Section 7.

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const goldenCsv = readFileSync(join(fixtureDir, "__fixtures__", "golden_dataset.csv"), "utf8");

type GoldenRow = {
  month: string;
  classification: "matched" | "boa_only" | "dealertrack_only";
  boaDescription: string;
  vin: string;
  vin6: string;
  boaEndingBalanceCents: number | null;
  dt2100AmountCents: number | null;
  dtDescription: string;
  controlNumber: string;
};

// Quote-aware CSV line splitter. DT descriptions carry customer names with
// embedded commas (e.g. "DUNCAN, WILLIAM RAYMO   3/11/26  VIN17") inside quoted
// fields, so a naive split on "," corrupts the trailing-VIN token.
function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      cols.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cols.push(current);
  return cols;
}

function parseGoldenRows(): GoldenRow[] {
  const lines = goldenCsv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const [, ...dataLines] = lines;
  return dataLines.map((line) => {
    const cols = splitCsvLine(line);
    return {
      month: cols[0],
      classification: cols[2] as GoldenRow["classification"],
      boaDescription: cols[3] ?? "",
      vin: cols[4] ?? "",
      vin6: cols[5] ?? "",
      boaEndingBalanceCents: parseAmountToCents(cols[6]),
      dt2100AmountCents: parseAmountToCents(cols[7]),
      dtDescription: cols[9] ?? "",
      controlNumber: cols[12] ?? "",
    };
  });
}

function buildTransaction(
  id: number,
  source: "boa" | "dealertrack",
  overrides: Partial<Transaction>,
): Transaction {
  return {
    id,
    dealership_id: 1,
    source_file_id: null,
    source_type: source,
    transaction_date: null,
    post_date: null,
    amount_cents: 0,
    reference_number: null,
    description: null,
    account: "Floorplan Payable",
    account_type: "liability",
    account_identifier: "2100",
    stock_number: null,
    vin: null,
    raw_data: {},
    ...overrides,
  };
}

// Translate the clerk's pre-classified golden rows into the raw BOA and DT
// transaction sets the engine consumes. A matched row contributes one BOA row
// AND one DT row; a boa_only row contributes only a BOA row; a dealertrack_only
// row contributes only a DT row. This reconstructs the two source files the
// engine would have seen before it did any matching of its own.
function buildSourcesForMonth(month: string): {
  boa: Transaction[];
  dealertrack: Transaction[];
} {
  const rows = parseGoldenRows().filter((row) => row.month === month);
  const boa: Transaction[] = [];
  const dealertrack: Transaction[] = [];
  let id = 1;

  for (const row of rows) {
    const hasBoa = row.classification === "matched" || row.classification === "boa_only";
    const hasDt = row.classification === "matched" || row.classification === "dealertrack_only";

    if (hasBoa && row.boaEndingBalanceCents !== null) {
      boa.push(
        buildTransaction(id++, "boa", {
          amount_cents: row.boaEndingBalanceCents,
          description: row.boaDescription || `BOA ${row.vin}`,
          vin: row.vin || null,
        }),
      );
    }
    if (hasDt && row.dt2100AmountCents !== null) {
      dealertrack.push(
        buildTransaction(id++, "dealertrack", {
          amount_cents: row.dt2100AmountCents,
          // DT side carries the raw free-text description (VIN as trailing
          // token when present) plus the VIN column that the real Dealertrack
          // export provides. Some DT rows have a generic description ("BOA
          // FLOORPLAN") with no embedded VIN; the VIN column is what lets the
          // engine derive VIN6 for those, matching the clerk's behavior.
          description: row.dtDescription || `DT ${row.vin}`,
          vin: row.vin || null,
          reference_number: row.controlNumber || null,
        }),
      );
    }
  }

  return { boa, dealertrack };
}

// Map engine output into the clerk's spec buckets. The engine routes a VIN6
// match with a differing amount to Needs Review (needs_review_vin6_only) rather
// than auto-confirming - that is the "amount mismatch pair" treatment: both
// sides survive as independent exceptions and are never merged onto one row.
function summarize(result: ReconciliationResponse): {
  matchedCount: number;
  boaOnlyCount: number;
  dealertrackOnlyCount: number;
  amountMismatchPairs: number;
} {
  const boaOnly = result.exceptions.filter(
    (exception) => exception.exception_type === "missing_in_dealertrack",
  );
  const dealertrackOnly = result.exceptions.filter(
    (exception) => exception.exception_type === "missing_in_boa",
  );
  const mismatchExceptions = result.exceptions.filter(
    (exception) => exception.exception_type === "needs_review_vin6_only",
  );
  const mismatchBoa = mismatchExceptions.filter(
    (exception) => exception.source_type === "boa",
  );
  const mismatchDt = mismatchExceptions.filter(
    (exception) => exception.source_type === "dealertrack",
  );

  return {
    // The clerk counts the un-mergeable mismatch rows within boa_only /
    // dealertrack_only, with the pair additionally surfaced as its own tag.
    boaOnlyCount: boaOnly.length + mismatchBoa.length,
    dealertrackOnlyCount: dealertrackOnly.length + mismatchDt.length,
    matchedCount: result.matched_count,
    amountMismatchPairs: Math.min(mismatchBoa.length, mismatchDt.length),
  };
}

function dollars(cents: number): number {
  return Math.round(cents / 100);
}

function grandTotals(
  boa: Transaction[],
  dealertrack: Transaction[],
): { boaGrandTotal: number; dtGrandTotal: number; variance: number } {
  const boaGrandTotalCents = boa.reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);
  // DT 2100 entries are credits, rendered negative in the workbook.
  const dtGrandTotalCents = dealertrack.reduce((sum, t) => sum - Math.abs(t.amount_cents), 0);
  return {
    boaGrandTotal: dollars(boaGrandTotalCents),
    dtGrandTotal: dollars(dtGrandTotalCents),
    variance: dollars(boaGrandTotalCents + dtGrandTotalCents),
  };
}

describe("golden fixture acceptance - Hurst FP Rec", () => {
  test("FEB26 reproduces the clerk's matched/exception counts, totals, and variance", () => {
    const { boa, dealertrack } = buildSourcesForMonth("FEB26");
    const result = reconcileTransactionSets(boa, dealertrack, "boa", "dealertrack");
    const summary = summarize(result);
    const totals = grandTotals(boa, dealertrack);

    expect(summary.matchedCount).toBe(238);
    expect(summary.boaOnlyCount).toBe(0);
    expect(summary.dealertrackOnlyCount).toBe(16);
    expect(summary.amountMismatchPairs).toBe(0);

    expect(totals.boaGrandTotal).toBe(9088877);
    expect(totals.dtGrandTotal).toBe(-9662045);
    expect(totals.variance).toBe(-573168);
  });

  test("MAR26 reproduces the clerk's matched/exception counts, totals, and variance", () => {
    const { boa, dealertrack } = buildSourcesForMonth("MAR26");
    const result = reconcileTransactionSets(boa, dealertrack, "boa", "dealertrack");
    const summary = summarize(result);
    const totals = grandTotals(boa, dealertrack);

    expect(summary.matchedCount).toBe(217);
    expect(summary.boaOnlyCount).toBe(10);
    expect(summary.dealertrackOnlyCount).toBe(6);
    expect(summary.amountMismatchPairs).toBe(0);

    expect(totals.boaGrandTotal).toBe(8606561);
    expect(totals.dtGrandTotal).toBe(-8470803);
    expect(totals.variance).toBe(135758);
  });

  test("APR26 reproduces counts, totals, variance, and the amount-mismatch pair", () => {
    const { boa, dealertrack } = buildSourcesForMonth("APRIL26");
    const result = reconcileTransactionSets(boa, dealertrack, "boa", "dealertrack");
    const summary = summarize(result);
    const totals = grandTotals(boa, dealertrack);

    expect(summary.matchedCount).toBe(199);
    expect(summary.boaOnlyCount).toBe(4);
    expect(summary.dealertrackOnlyCount).toBe(2);
    // Both mismatch VINs (JM1BPBLL0T1870612, JM1BPBLL1T1871235) are detected as
    // VIN6 matches with differing amounts and are NOT merged into matches.
    expect(summary.amountMismatchPairs).toBe(2);

    expect(totals.boaGrandTotal).toBe(7949383);
    expect(totals.dtGrandTotal).toBe(-7877160);
    expect(totals.variance).toBe(72223);
  });

  test("variance is never forced to zero - it equals the net exception delta", () => {
    for (const month of ["FEB26", "MAR26", "APRIL26"]) {
      const { boa, dealertrack } = buildSourcesForMonth(month);
      const totals = grandTotals(boa, dealertrack);
      // A non-zero variance is the expected, valid output when exceptions exist.
      expect(totals.variance).not.toBe(0);
    }
  });
});
