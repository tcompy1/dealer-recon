// Pure comparisons shared by invented integration tests and protected acceptance. No evidence I/O.
import {toFpRecXlsHtml, type FpRecWorkbook} from "../presenters/fpRec.js";
import type {MergedFloorplanWorkbook} from "../presenters/mergedFloorplan.js";
export type ExpectedMergedSemantics = {
  headers: string[];
  rows: Array<{
    classification: "matched" | "boa_only" | "dealertrack_only";
    boaVin6: string;
    endingBalanceCents: number | null;
    dealertrackCents: number | null;
    dealertrackVin6: string;
    control: string;
  }>;
  totals: { boaCents: number; dealertrackCents: number };
};

export type ExpectedFpRecSemantics = {
  sheetName: "APR26";
  visibleColumnCount: 4;
  printArea: "A:D";
  summary: {
    outstandingStatementCents: number;
    totalGlCents: number;
    differenceCents: number;
    netAdjustmentsCents: number;
    varianceCents: number;
  };
  scheduleOnly: Array<{ unitReference: string; amountCents: number }>;
  statementOnly: Array<{ unitReference: string; amountCents: number }>;
  formulas: {
    totalGl: "account_range";
    difference: "statement_plus_gl";
    scheduleSubtotal: "section_range";
    statementSubtotal: "section_range";
    netAdjustments: "schedule_only_plus_statement_only";
    variance: "net_adjustments_minus_difference";
  };
  workpaper: {
    labelOrder: string[];
    scheduleHeaders: [string, string, string, string];
    statementHeaders: [string, string, string, string];
  };
};

export const REQUIRED_FP_REC_LABELS = [
  "Floorplan Reconciliation-Hiley Acura",
  "Outstanding STMT",
  "GL Balances",
  "324",
  "Total GL",
  "Difference",
  "On schedule-not on statement",
  "On statement-not on GL",
  "GL FLOORED",
  "BOA FLOORED",
  "Net adjustments",
  "Variance",
] as const;

export function compareMergedSemantics(
  actual: MergedFloorplanWorkbook,
  expected: ExpectedMergedSemantics,
): string[] {
  const errors: string[] = [];
  compareStringSequence(errors, "merged.headers", actual.headers, expected.headers);
  compareNumber(errors, "merged.row_count", actual.rows.length, expected.rows.length);
  compareNumber(
    errors,
    "merged.boa_total_cents",
    actual.boa_total_amount_cents,
    expected.totals.boaCents,
  );
  compareNumber(
    errors,
    "merged.dealertrack_total_cents",
    actual.dealertrack_total_amount_cents,
    expected.totals.dealertrackCents,
  );

  compareRowField(
    errors,
    "merged.classification",
    actual.rows,
    expected.rows,
    (row) => row.classification,
    (row) => row.classification,
  );
  compareRowField(
    errors,
    "merged.boa_vin6",
    actual.rows,
    expected.rows,
    (row) => row.boa_vin6,
    (row) => row.boaVin6,
  );
  compareRowField(
    errors,
    "merged.ending_balance_cents",
    actual.rows,
    expected.rows,
    (row) => row.ending_balance_cents,
    (row) => row.endingBalanceCents,
  );
  compareRowField(
    errors,
    "merged.dealertrack_cents",
    actual.rows,
    expected.rows,
    (row) => row.dealertrack_account_amount_cents,
    (row) => row.dealertrackCents,
  );
  compareRowField(
    errors,
    "merged.dealertrack_vin6",
    actual.rows,
    expected.rows,
    (row) => row.dealertrack_vin6,
    (row) => row.dealertrackVin6,
  );
  compareRowField(
    errors,
    "merged.control",
    actual.rows,
    expected.rows,
    (row) => row.dealertrack_control,
    (row) => row.control,
  );
  return errors;
}

export function compareFpRecSemantics(
  actual: FpRecWorkbook,
  expected: ExpectedFpRecSemantics,
  renderedHtml: string = toFpRecXlsHtml(actual),
): string[] {
  const errors: string[] = [];
  const renderedRows = parseRenderedFpRecRows(renderedHtml);
  const actualSheetName = worksheetNameFromHtml(renderedHtml);
  const actualPrintArea = printAreaFromHtml(renderedHtml, actualSheetName);
  compareString(errors, "fp_rec.sheet_name", actualSheetName, expected.sheetName);
  compareNumber(
    errors,
    "fp_rec.visible_column_count",
    countHtmlColumns(renderedHtml),
    expected.visibleColumnCount,
  );
  const rowWidthMismatches = renderedRows.filter((row) => row.logicalWidth !== 4).length;
  if (rowWidthMismatches > 0) {
    errors.push(
      rowWidthMismatches === 1
        ? "fp_rec.row_width: 1 rendered row has logical width other than 4"
        : `fp_rec.row_width: ${rowWidthMismatches} rendered rows have logical width other than 4`,
    );
  }
  compareString(errors, "fp_rec.print_area", actualPrintArea, expected.printArea);
  compareStringArray(
    errors,
    "fp_rec.schedule_headers",
    renderedHeaderCells(renderedRows, expected.workpaper.scheduleHeaders[0]),
    expected.workpaper.scheduleHeaders,
  );
  compareStringArray(
    errors,
    "fp_rec.statement_headers",
    renderedHeaderCells(renderedRows, expected.workpaper.statementHeaders[0]),
    expected.workpaper.statementHeaders,
  );
  const expectedLabels = new Set(expected.workpaper.labelOrder);
  compareStringArray(
    errors,
    "fp_rec.label_order",
    renderedRows
      .map((row) => row.cells[0] ?? "")
      .filter((label) => expectedLabels.has(label)),
    expected.workpaper.labelOrder,
  );
  compareNumber(
    errors,
    "fp_rec.outstanding_statement_cents",
    actual.summary.outstanding_per_stmt_amount_cents,
    expected.summary.outstandingStatementCents,
  );
  compareNumber(
    errors,
    "fp_rec.total_gl_cents",
    actual.summary.total_gl_amount_cents,
    expected.summary.totalGlCents,
  );
  compareNumber(
    errors,
    "fp_rec.difference_cents",
    actual.summary.difference_amount_cents,
    expected.summary.differenceCents,
  );
  compareNumber(
    errors,
    "fp_rec.net_adjustments_cents",
    actual.net_adjustments_amount_cents,
    expected.summary.netAdjustmentsCents,
  );
  compareNumber(
    errors,
    "fp_rec.variance_cents",
    actual.variance_amount_cents,
    expected.summary.varianceCents,
  );
  if (actual.variance_amount_cents !== 0) {
    errors.push("fp_rec.final_variance: expected zero");
  }

  compareWorkpaperSection(
    errors,
    "fp_rec.schedule_only",
    actual.schedule_not_on_statement.rows,
    expected.scheduleOnly,
  );
  compareWorkpaperSection(
    errors,
    "fp_rec.statement_only",
    actual.statement_not_on_gl.rows,
    expected.statementOnly,
  );
  for (const label of REQUIRED_FP_REC_LABELS) {
    if (!renderedHtml.includes(`>${escapeHtml(label)}<`)) {
      errors.push(`fp_rec.required_label: missing ${label}`);
    }
  }
  compareFormulaSemantics(errors, renderedRows, actual, expected.formulas);
  return errors;
}

export function compareRowField<
  TActual,
  TExpected,
  TValue,
>(
  errors: string[],
  label: string,
  actualRows: TActual[],
  expectedRows: TExpected[],
  actualValue: (row: TActual) => TValue,
  expectedValue: (row: TExpected) => TValue,
): void {
  const compared = Math.min(actualRows.length, expectedRows.length);
  let mismatches = 0;
  for (let index = 0; index < compared; index += 1) {
    if (actualValue(actualRows[index]) !== expectedValue(expectedRows[index])) mismatches += 1;
  }
  mismatches += Math.abs(actualRows.length - expectedRows.length);
  if (mismatches > 0) errors.push(`${label}: ${mismatches} row mismatches`);
}

export function compareWorkpaperSection(
  errors: string[],
  label: string,
  actualRows: Array<{ unit_reference: string; amount_cents: number }>,
  expectedRows: Array<{ unitReference: string; amountCents: number }>,
): void {
  compareNumber(errors, `${label}.row_count`, actualRows.length, expectedRows.length);
  compareRowField(
    errors,
    `${label}.unit_reference`,
    actualRows,
    expectedRows,
    (row) => row.unit_reference,
    (row) => row.unitReference,
  );
  compareRowField(
    errors,
    `${label}.amount_cents`,
    actualRows,
    expectedRows,
    (row) => row.amount_cents,
    (row) => row.amountCents,
  );
}

export function compareFormulaSemantics(
  errors: string[],
  rows: RenderedFpRecRow[],
  workbook: FpRecWorkbook,
  expected: ExpectedFpRecSemantics["formulas"],
): void {
  const statementRow = renderedRowNumber(rows, "Outstanding STMT");
  const accountRow = renderedRowNumber(rows, workbook.store_config.dealertrackAccountLabel);
  const totalGlRow = renderedRowNumber(rows, "Total GL");
  const differenceRow = renderedRowNumber(rows, "Difference");
  const scheduleHeaderRow = renderedRowNumber(rows, "On schedule-not on statement");
  const statementHeaderRow = renderedRowNumber(rows, "On statement-not on GL");
  const netAdjustmentsRow = renderedRowNumber(rows, "Net adjustments");
  const varianceRow = renderedRowNumber(rows, "Variance");
  const scheduleSubtotalRow = renderedSubtotalRow(
    rows,
    scheduleHeaderRow,
    statementHeaderRow,
  );
  const statementSubtotalRow = renderedSubtotalRow(
    rows,
    statementHeaderRow,
    netAdjustmentsRow,
  );

  if (
    expected.totalGl !== "account_range" ||
    !formulaEqualsRange(formulaForRenderedRow(rows, totalGlRow), accountRow, accountRow)
  ) {
    errors.push("fp_rec.formula.total_gl: semantic mismatch");
  }
  if (
    expected.difference !== "statement_plus_gl" ||
    !formulaEqualsAddition(
      formulaForRenderedRow(rows, differenceRow),
      statementRow,
      totalGlRow,
    )
  ) {
    errors.push("fp_rec.formula.difference: semantic mismatch");
  }
  if (
    expected.scheduleSubtotal !== "section_range" ||
    !formulaEqualsRange(
      formulaForRenderedRow(rows, scheduleSubtotalRow),
      nextRow(scheduleHeaderRow),
      previousRow(scheduleSubtotalRow),
    )
  ) {
    errors.push("fp_rec.formula.schedule_subtotal: semantic mismatch");
  }
  if (
    expected.statementSubtotal !== "section_range" ||
    !formulaEqualsRange(
      formulaForRenderedRow(rows, statementSubtotalRow),
      nextRow(statementHeaderRow),
      previousRow(statementSubtotalRow),
    )
  ) {
    errors.push("fp_rec.formula.statement_subtotal: semantic mismatch");
  }
  if (
    expected.netAdjustments !== "schedule_only_plus_statement_only" ||
    !formulaEqualsAddition(
      formulaForRenderedRow(rows, netAdjustmentsRow),
      scheduleSubtotalRow,
      statementSubtotalRow,
    )
  ) {
    errors.push("fp_rec.formula.net_adjustments: semantic mismatch");
  }
  if (
    expected.variance !== "net_adjustments_minus_difference" ||
    !formulaEqualsSubtraction(
      formulaForRenderedRow(rows, varianceRow),
      netAdjustmentsRow,
      differenceRow,
    )
  ) {
    errors.push("fp_rec.formula.variance: semantic mismatch");
  }
}

export type RenderedFpRecRow = {
  rowNumber: number;
  cells: string[];
  formulas: Array<string | null>;
  logicalWidth: number;
};

export function parseRenderedFpRecRows(html: string): RenderedFpRecRow[] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch, index) => {
    const cells = [...rowMatch[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
    return {
      rowNumber: index + 1,
      cells: cells.map((cell) => decodeHtml(stripTags(cell[2])).trim()),
      formulas: cells.map((cell) => {
        const formula = cell[1].match(/\bx:fmla="([^"]+)"/i)?.[1];
        return formula ? decodeHtml(formula) : null;
      }),
      logicalWidth: cells.reduce(
        (width, cell) => width + renderedCellColspan(cell[1]),
        0,
      ),
    };
  });
}

export function renderedCellColspan(attributes: string): number {
  const match = attributes.match(/\bcolspan\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))/i);
  const colspan = Number(match?.[1] ?? match?.[2] ?? match?.[3] ?? 1);
  return Number.isSafeInteger(colspan) && colspan > 0 ? colspan : 1;
}

export function renderedHeaderCells(rows: RenderedFpRecRow[], label: string): string[] {
  return rows.find((row) => row.cells[0] === label)?.cells ?? [];
}

export function renderedRowNumber(rows: RenderedFpRecRow[], label: string): number | null {
  return rows.find((row) => row.cells[0] === label)?.rowNumber ?? null;
}

export function renderedSubtotalRow(
  rows: RenderedFpRecRow[],
  headerRow: number | null,
  nextSectionRow: number | null,
): number | null {
  if (headerRow === null || nextSectionRow === null) return null;
  return rows
    .filter(
      (row) =>
        row.rowNumber > headerRow &&
        row.rowNumber < nextSectionRow &&
        !row.cells[0] &&
        Boolean(row.formulas[1]),
    )
    .at(-1)?.rowNumber ?? null;
}

export function formulaForRenderedRow(
  rows: RenderedFpRecRow[],
  rowNumber: number | null,
): string | null {
  if (rowNumber === null) return null;
  return rows.find((row) => row.rowNumber === rowNumber)?.formulas[1] ?? null;
}

export function formulaEqualsRange(
  formula: string | null,
  firstRow: number | null,
  lastRow: number | null,
): boolean {
  if (firstRow === null || lastRow === null) return false;
  return normalizeFormula(formula) === `SUM(B${firstRow}:B${lastRow})`;
}

export function formulaEqualsAddition(
  formula: string | null,
  firstRow: number | null,
  secondRow: number | null,
): boolean {
  if (firstRow === null || secondRow === null) return false;
  const normalized = normalizeFormula(formula);
  const direct = `B${firstRow}+B${secondRow}`;
  const reverse = `B${secondRow}+B${firstRow}`;
  return new Set([direct, reverse, `SUM(${direct})`, `SUM(${reverse})`]).has(normalized);
}

export function formulaEqualsSubtraction(
  formula: string | null,
  minuendRow: number | null,
  subtrahendRow: number | null,
): boolean {
  if (minuendRow === null || subtrahendRow === null) return false;
  const direct = `B${minuendRow}-B${subtrahendRow}`;
  return new Set([direct, `SUM(${direct})`]).has(normalizeFormula(formula));
}

export function normalizeFormula(formula: string | null): string {
  return formula?.toUpperCase().replace(/^=/, "").replace(/\$/g, "").replace(/\s+/g, "") ?? "";
}

export function nextRow(row: number | null): number | null {
  return row === null ? null : row + 1;
}

export function previousRow(row: number | null): number | null {
  return row === null ? null : row - 1;
}

export function worksheetNameFromHtml(html: string): string {
  const worksheet = /<x:ExcelWorksheet>([\s\S]*?)<\/x:ExcelWorksheet>/i.exec(html)?.[1] ?? "";
  const name = /<x:Name>([^<]*)<\/x:Name>/i.exec(worksheet)?.[1] ?? "";
  return decodeHtml(name).trim();
}

export function printAreaFromHtml(html: string, worksheetName: string): string {
  const block = /<x:ExcelName>[\s\S]*?<x:Name>Print_Area<\/x:Name>([\s\S]*?)<\/x:ExcelName>/i.exec(html)?.[1] ?? "";
  const formula = decodeHtml(/<x:Formula>([^<]*)<\/x:Formula>/i.exec(block)?.[1] ?? "")
    .replace(/&apos;/g, "'");
  const match = /^='([^']+)'!\$?([A-Z]+)\$?\d+:\$?([A-Z]+)\$?\d+$/i.exec(formula.trim());
  return match && match[1] === worksheetName && match[2].toUpperCase() === "A" && match[3].toUpperCase() === "D"
    ? "A:D"
    : "";
}

export function countHtmlColumns(html: string): number {
  const colgroup = /<colgroup>([\s\S]*?)<\/colgroup>/i.exec(html)?.[1] ?? "";
  return [...colgroup.matchAll(/<col\b/gi)].length;
}

export function compareStringArray(
  errors: string[],
  label: string,
  actual: readonly string[],
  expected: readonly string[],
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    errors.push(`${label}: semantic mismatch`);
  }
}

export function compareStringSequence(
  errors: string[],
  label: string,
  actual: string[],
  expected: string[],
): void {
  compareNumber(errors, `${label}.count`, actual.length, expected.length);
  const mismatches = Math.min(actual.length, expected.length) - actual.filter(
    (value, index) => index < expected.length && value === expected[index],
  ).length;
  if (mismatches > 0) errors.push(`${label}.order: ${mismatches} position mismatches`);
}

export function compareNumber(
  errors: string[],
  label: string,
  actual: number,
  expected: number,
): void {
  if (actual !== expected) errors.push(`${label}: expected ${expected}, received ${actual}`);
}

export function compareString(
  errors: string[],
  label: string,
  actual: string,
  expected: string,
): void {
  if (actual !== expected) errors.push(`${label}: semantic mismatch`);
}

export function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
