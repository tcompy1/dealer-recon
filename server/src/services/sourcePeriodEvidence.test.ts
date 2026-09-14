import { describe, expect, test } from "vitest";

import {
  type AccountingMonth,
  parseAccountingMonth,
} from "../domain/accountingMonth.js";
import type { ParsedTable } from "./parsers/types.js";
import {
  deriveBoaPeriodEvidence,
  deriveDealertrackPeriodEvidence,
} from "./sourcePeriodEvidence.js";

const APRIL_2026 = accountingMonth("2026-04");

function accountingMonth(value: string): AccountingMonth {
  const parsed = parseAccountingMonth(value);
  if (!parsed) {
    throw new Error(`Invalid accounting month in test: ${value}`);
  }
  return parsed;
}

function table(header: string[] | null, rows: string[][]): ParsedTable {
  return { header, rows, warnings: [] };
}

describe("deriveBoaPeriodEvidence", () => {
  test("confirms the selected month from a matching BOA banner", () => {
    const result = deriveBoaPeriodEvidence(
      table(null, [
        ["Dealer Billing Statement for: April 2026"],
        ["Serial No/VIN", "Stock/Lease No", "Original Amount", "Ending Balance"],
        ["SYNTHETC000000001", "M50001", "100.00", "100.00"],
      ]),
      "boa-april-2026.csv",
      APRIL_2026,
    );

    expect(result).toMatchObject({
      ok: true,
      evidence: {
        source: "boa",
        selectedMonth: "2026-04",
        explicitMonths: ["2026-04"],
        status: "confirmed",
      },
      warnings: [],
    });
  });

  test("rejects a BOA banner from a different month", () => {
    const result = deriveBoaPeriodEvidence(
      table(null, [
        ["Dealer Billing Statement for: March 2026"],
        ["Serial No/VIN", "Stock/Lease No", "Original Amount", "Ending Balance"],
      ]),
      null,
      APRIL_2026,
    );

    expect(result).toMatchObject({
      ok: false,
      code: "SOURCE_PERIOD_MISMATCH",
      evidence: {
        explicitMonths: ["2026-03"],
        status: "contradictory",
      },
    });
  });

  test("rejects two conflicting BOA banner months", () => {
    const result = deriveBoaPeriodEvidence(
      table(null, [
        ["Statement period March 2026"],
        ["Dealer Billing Statement for: April 2026"],
        ["Serial No/VIN", "Stock/Lease No", "Original Amount", "Ending Balance"],
      ]),
      null,
      APRIL_2026,
    );

    expect(result).toMatchObject({
      ok: false,
      code: "SOURCE_PERIOD_CONTRADICTORY",
      evidence: {
        explicitMonths: ["2026-03", "2026-04"],
        status: "contradictory",
      },
    });
  });

  test("lets the BOA banner override a mismatching filename hint with a safe warning", () => {
    const result = deriveBoaPeriodEvidence(
      table(null, [
        ["Synthetic Acura BOA April 2026"],
        ["Serial No/VIN", "Stock/Lease No", "Original Amount", "Ending Balance"],
      ]),
      "boa-march.csv",
      APRIL_2026,
    );

    expect(result).toMatchObject({
      ok: true,
      evidence: {
        explicitMonths: ["2026-04"],
        filenameHint: "2026-03",
        status: "confirmed",
      },
    });
    if (!result.ok) return;
    expect(result.warnings).toEqual([
      "Filename month hint 2026-03 does not match BOA banner month 2026-04; the banner is authoritative.",
    ]);
  });

  test("does not fabricate confirmation when no BOA banner month is usable", () => {
    const result = deriveBoaPeriodEvidence(
      table(["Serial No/VIN", "Ending Balance"], [["SYNTHETC000000001", "100.00"]]),
      "boa-april-2026.csv",
      APRIL_2026,
    );

    expect(result).toMatchObject({
      ok: true,
      evidence: {
        explicitMonths: [],
        status: "compatible_incomplete",
      },
    });
    if (!result.ok) return;
    expect(result.warnings).toEqual([
      "BOA statement banner did not contain a usable accounting month; the filename is only a hint.",
    ]);
  });
});

describe("deriveDealertrackPeriodEvidence", () => {
  test("treats dates through the selected month as compatible but incomplete", () => {
    const result = deriveDealertrackPeriodEvidence(
      table(
        ["Control", "Description", "324", "Posting Date"],
        [
          ["M50001", "Synthetic row", "-100.00", "2026-03-31"],
          ["M50002", "Synthetic row", "-200.00", "04/30/2026"],
        ],
      ),
      "dealertrack-april-2026.csv",
      APRIL_2026,
    );

    expect(result).toMatchObject({
      ok: true,
      evidence: {
        source: "dealertrack",
        selectedMonth: "2026-04",
        explicitMonths: ["2026-03", "2026-04"],
        observedDateRange: { min: "2026-03-31", max: "2026-04-30" },
        status: "compatible_incomplete",
      },
    });
    if (!result.ok) return;
    expect(result.warnings).toEqual([
      "Dealertrack dates do not prove a complete accounting period; all observed dates are no later than 2026-04.",
    ]);
  });

  test("rejects a Dealertrack date later than the selected month", () => {
    const result = deriveDealertrackPeriodEvidence(
      table(
        ["Control", "Description", "324", "Posting Date"],
        [["M50001", "Synthetic row", "-100.00", "2026-05-01"]],
      ),
      null,
      APRIL_2026,
    );

    expect(result).toMatchObject({
      ok: false,
      code: "SOURCE_PERIOD_CONTRADICTORY",
      evidence: {
        observedDateRange: { min: "2026-05-01", max: "2026-05-01" },
        status: "contradictory",
      },
    });
  });

  test("does not fabricate confirmation when no Dealertrack date is usable", () => {
    const result = deriveDealertrackPeriodEvidence(
      table(["Control", "Description", "324"], [["M50001", "Synthetic row", "-100.00"]]),
      "dealertrack-april-2026.csv",
      APRIL_2026,
    );

    expect(result).toMatchObject({
      ok: true,
      evidence: {
        explicitMonths: [],
        observedDateRange: null,
        filenameHint: "2026-04",
        status: "compatible_incomplete",
      },
    });
    if (!result.ok) return;
    expect(result.warnings).toEqual([
      "Dealertrack export did not contain a usable date; the filename is only a hint.",
    ]);
  });
});
