import { describe, expect, test } from "vitest";

import {
  buildAcuraArtifactsFromEvidence,
  compareFpRecSemantics,
  compareMergedSemantics,
  type ExpectedFpRecSemantics,
  readExpectedFpRecSemantics,
  readExpectedMergedSemantics,
  resolveAprilAcuraEvidence,
} from "./acuraEvidence.js";
import { ROOFTOP_PROFILES } from "../config/storeWorkflowConfig.js";
import {
  buildFpRecWorkbookFromMergedFloorplan,
  toFpRecXlsHtml,
  type FpRecWorkbook,
} from "../presenters/fpRec.js";
import type { MergedFloorplanWorkbook } from "../presenters/mergedFloorplan.js";

const evidenceRoot = process.env.ACURA_EVIDENCE_DIR;

describe.runIf(Boolean(evidenceRoot))("approved Acura April evidence", () => {
  test("matches merged and FP REC business semantics", async () => {
    const paths = resolveAprilAcuraEvidence(evidenceRoot as string);
    const actual = await buildAcuraArtifactsFromEvidence(paths);
    const expectedMerged = readExpectedMergedSemantics(paths.mergedCsv);
    const expectedFpRec = await readExpectedFpRecSemantics(paths.goalWorkbook, "APR26");

    expect({
      matched: actual.merged.rows.filter((row) => row.classification === "matched").length,
      boaOnly: actual.merged.rows.filter((row) => row.classification === "boa_only").length,
      dealertrackOnly: actual.merged.rows.filter((row) => row.classification === "dealertrack_only").length,
      boaCents: actual.merged.boa_total_amount_cents,
      dealertrackCents: actual.merged.dealertrack_total_amount_cents,
      differenceCents: actual.fpRec.summary.difference_amount_cents,
      varianceCents: actual.fpRec.variance_amount_cents,
    }).toEqual({
      matched: 199,
      boaOnly: 0,
      dealertrackOnly: 9,
      boaCents: 1_005_665_140,
      dealertrackCents: -1_039_411_200,
      differenceCents: -33_746_060,
      varianceCents: 0,
    });
    expect(expectedMerged.totals).toEqual({
      boaCents: 1_005_665_140,
      dealertrackCents: -1_039_411_200,
    });
    expect(expectedFpRec.summary).toEqual({
      outstandingStatementCents: 1_005_665_140,
      totalGlCents: -1_039_411_200,
      differenceCents: -33_746_060,
      netAdjustmentsCents: -33_746_060,
      varianceCents: 0,
    });
    expect(compareMergedSemantics(actual.merged, expectedMerged)).toEqual([]);
    expect(compareFpRecSemantics(actual.fpRec, expectedFpRec)).toEqual([]);
  });
});

const SYNTHETIC_FP_REC_EXPECTED: ExpectedFpRecSemantics = {
  sheetName: "APR26",
  visibleColumnCount: 4,
  printArea: "A:D",
  summary: {
    outstandingStatementCents: 0,
    totalGlCents: 0,
    differenceCents: 0,
    netAdjustmentsCents: 0,
    varianceCents: 0,
  },
  scheduleOnly: [],
  statementOnly: [],
  formulas: {
    totalGl: "account_range",
    difference: "statement_plus_gl",
    scheduleSubtotal: "section_range",
    statementSubtotal: "section_range",
    netAdjustments: "schedule_only_plus_statement_only",
    variance: "net_adjustments_minus_difference",
  },
  workpaper: {
    labelOrder: [
      "Floorplan Reconciliation-Hiley Acura",
      "Outstanding STMT",
      "GL Balances",
      "324",
      "Total GL",
      "Difference",
      "On schedule-not on statement",
      "On statement-not on GL",
      "Net adjustments",
      "Variance",
    ],
    scheduleHeaders: ["On schedule-not on statement", "", "GL FLOORED", "BOA FLOORED"],
    statementHeaders: ["On statement-not on GL", "", "BOA FLOORED", "GL FLOORED"],
  },
};

describe("Acura rendered FP REC semantic comparison", () => {
  test("accepts the exact synthetic workpaper structure", () => {
    const workbook = syntheticAcuraFpRecWorkbook();

    expect(compareFpRecSemantics(workbook, SYNTHETIC_FP_REC_EXPECTED)).toEqual([]);
  });

  test("rejects wrong rendered worksheet metadata without exposing row identifiers", () => {
    const workbook = syntheticAcuraFpRecWorkbook();
    const html = replaceOnce(
      toFpRecXlsHtml(workbook),
      "<x:Name>APR26</x:Name>",
      "<x:Name>BAD26</x:Name>",
    );

    expect(compareRendered(workbook, html)).toContain(
      "fp_rec.sheet_name: semantic mismatch",
    );
  });

  test("rejects wrong visible column header order without exposing row identifiers", () => {
    const workbook = syntheticAcuraFpRecWorkbook();
    const html = replaceOnce(
      toFpRecXlsHtml(workbook),
      "<td>On schedule-not on statement</td><td></td><td>GL FLOORED</td><td>BOA FLOORED</td>",
      "<td>On schedule-not on statement</td><td></td><td>BOA FLOORED</td><td>GL FLOORED</td>",
    );

    expect(compareRendered(workbook, html)).toContain(
      "fp_rec.schedule_headers: semantic mismatch",
    );
  });

  test("rejects a populated fifth logical cell without exposing its contents", () => {
    const workbook = syntheticAcuraFpRecWorkbook();
    const rendered = toFpRecXlsHtml(workbook);
    const titleRow = requiredRenderedRowByClass(rendered, "title-row");
    const html = replaceOnce(
      rendered,
      titleRow,
      titleRow.replace("</tr>", "<td>SYNTHETIC_EXTRA_CELL</td></tr>"),
    );

    const errors = compareRendered(workbook, html);

    expect(errors).toContain(
      "fp_rec.row_width: 1 rendered row has logical width other than 4",
    );
    expect(errors.join("\n")).not.toContain("SYNTHETIC_EXTRA_CELL");
  });

  test("rejects a rendered row under four logical columns", () => {
    const workbook = syntheticAcuraFpRecWorkbook();
    const rendered = toFpRecXlsHtml(workbook);
    const html = replaceOnce(rendered, 'colspan="4"', 'colspan="3"');

    expect(compareRendered(workbook, html)).toContain(
      "fp_rec.row_width: 1 rendered row has logical width other than 4",
    );
  });

  test("rejects wrong workpaper label order without exposing row identifiers", () => {
    const workbook = syntheticAcuraFpRecWorkbook();
    const rendered = toFpRecXlsHtml(workbook);
    const totalGlRow = requiredRenderedRow(rendered, "Total GL");
    const differenceRow = requiredRenderedRow(rendered, "Difference");
    const html = rendered
      .replace(totalGlRow, "__TOTAL_GL_ROW__")
      .replace(differenceRow, totalGlRow)
      .replace("__TOTAL_GL_ROW__", differenceRow);

    expect(compareRendered(workbook, html)).toContain(
      "fp_rec.label_order: semantic mismatch",
    );
  });

  test.each([
    ["=SUM(B5:B5)", "=SUM(B4:B5)", "fp_rec.formula.total_gl: semantic mismatch"],
    ["=SUM(B3+B6)", "=SUM(B4+B6)", "fp_rec.formula.difference: semantic mismatch"],
    ["=SUM(B9:B20)", "=SUM(B10:B20)", "fp_rec.formula.schedule_subtotal: semantic mismatch"],
    ["=SUM(B23:B26)", "=SUM(B24:B26)", "fp_rec.formula.statement_subtotal: semantic mismatch"],
    ["=B27+B21", "=B26+B21", "fp_rec.formula.net_adjustments: semantic mismatch"],
    ["=B28-B7", "=B27-B7", "fp_rec.formula.variance: semantic mismatch"],
  ])("rejects an incorrect rendered reference for %s", (validFormula, invalidFormula, error) => {
    const workbook = syntheticAcuraFpRecWorkbook();
    const html = replaceOnce(toFpRecXlsHtml(workbook), validFormula, invalidFormula);

    expect(compareRendered(workbook, html)).toContain(error);
  });
});

function syntheticAcuraFpRecWorkbook(): FpRecWorkbook {
  const profile = ROOFTOP_PROFILES.acura;
  const merged: MergedFloorplanWorkbook = {
    store_config: profile,
    store_name: "Hiley Acura",
    period_date: "04-30-26",
    headers: ["ACURA", "Serial No/VIN", "VIN6", "Ending Balance", "324", "VIN6", "Description", "Control"],
    rows: [],
    boa_total_amount: "0.00",
    boa_total_amount_cents: 0,
    dealertrack_total_amount: "0.00",
    dealertrack_total_amount_cents: 0,
    variance_amount: "0.00",
    variance_amount_cents: 0,
  };
  return buildFpRecWorkbookFromMergedFloorplan(merged, profile);
}

function compareRendered(workbook: FpRecWorkbook, html: string): string[] {
  return compareFpRecSemantics(workbook, SYNTHETIC_FP_REC_EXPECTED, html);
}

function replaceOnce(value: string, from: string, to: string): string {
  expect(value).toContain(from);
  return value.replace(from, to);
}

function requiredRenderedRow(html: string, label: string): string {
  const row = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map(([match]) => match)
    .find((match) => match.includes(`<td>${label}</td>`));
  expect(row).toBeDefined();
  return row as string;
}

function requiredRenderedRowByClass(html: string, className: string): string {
  const row = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map(([match]) => match)
    .find((match) => match.includes(`class="${className}"`));
  expect(row).toBeDefined();
  return row as string;
}
