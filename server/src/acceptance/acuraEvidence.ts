import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";

import { ROOFTOP_PROFILES } from "../config/storeWorkflowConfig.js";
import {
  accountingMonthEndDate,
  parseAccountingMonth,
  type AccountingMonth,
} from "../domain/accountingMonth.js";
import { parseAmountToCents } from "../domain/money.js";
import type {
  NewTransaction,
  ReconciliationRunDetail,
  SourceFileSummary,
  Transaction,
} from "../domain/types.js";
import {
  buildFpRecWorkbook,
  toFpRecXlsHtml,
  type FpRecWorkbook,
} from "../presenters/fpRec.js";
import {
  buildMergedFloorplanWorkbookFromReconciliationDetail,
  type MergedFloorplanWorkbook,
} from "../presenters/mergedFloorplan.js";
import { preprocessUpload } from "../services/preprocessing/index.js";
import { reconcileTransactionSets } from "../services/reconciliationEngine.js";

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

export type AcuraEvidencePaths = {
  boaCsv: string;
  dealertrackCsv: string;
  mergedCsv: string;
  goalWorkbook: string;
  goalSheet: "APR26";
};

const APRIL_ACCOUNTING_MONTH = requireAccountingMonth("2026-04");
const APRIL_END_DATE = accountingMonthEndDate(APRIL_ACCOUNTING_MONTH);
const ACURA_STORE_NAME = "Hiley Acura";
const REQUIRED_FP_REC_LABELS = [
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
const ORDERED_WORKPAPER_LABELS = [
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
] as const;

export function resolveAprilAcuraEvidence(root: string): AcuraEvidencePaths {
  const evidenceRoot = resolve(root);
  return {
    boaCsv: resolve(evidenceRoot, "ACURA BOA APRIL(in).csv"),
    dealertrackCsv: resolve(evidenceRoot, "ACURA DT APRIL(in).csv"),
    mergedCsv: resolve(evidenceRoot, "ACURA APRIL MERGED(BillingStatementApril2026).csv"),
    goalWorkbook: resolve(evidenceRoot, "Acura FP Rec.xlsx"),
    goalSheet: "APR26",
  };
}

export function readExpectedMergedSemantics(path: string): ExpectedMergedSemantics {
  const records = parse(readFileSync(path, "utf8"), {
    relax_column_count: true,
    skip_empty_lines: false,
  }) as string[][];
  const [headers, ...rawRows] = records;
  if (!headers || headers.length < 8) {
    throw safeEvidenceError("merged", "the eight-column header is unavailable");
  }

  const rows = rawRows.filter((row) => row.some(hasText));
  const totalsIndex = rows.findIndex((row) => text(row[6]) === "Final Totals:");
  if (totalsIndex === -1) {
    throw safeEvidenceError("merged", "the final totals row is unavailable");
  }
  const totalsRow = rows[totalsIndex];
  const detailRows = rows.filter((_, index) => index !== totalsIndex);

  return {
    headers: headers.slice(0, 8).map(text),
    rows: detailRows.map((row) => ({
      classification: classifyMergedEvidenceRow(row),
      boaVin6: text(row[2]),
      endingBalanceCents: optionalEvidenceAmount(row[3], "merged detail BOA amount"),
      dealertrackCents: optionalEvidenceAmount(row[4], "merged detail Dealertrack amount"),
      dealertrackVin6: text(row[5]),
      control: text(row[7]),
    })),
    totals: {
      boaCents: requiredEvidenceAmount(totalsRow[3], "merged BOA total"),
      dealertrackCents: requiredEvidenceAmount(totalsRow[4], "merged Dealertrack total"),
    },
  };
}

export async function readExpectedFpRecSemantics(
  path: string,
  sheet: "APR26",
): Promise<ExpectedFpRecSemantics> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const worksheet = workbook.getWorksheet(sheet);
  if (!worksheet) {
    throw safeEvidenceError("FP REC", "the approved worksheet is unavailable");
  }

  const rowByLabel = buildWorksheetLabelIndex(worksheet);
  for (const label of REQUIRED_FP_REC_LABELS) {
    if (!rowByLabel.has(normalizeLabel(label))) {
      throw safeEvidenceError("FP REC", `a required label is unavailable (${label})`);
    }
  }

  const outstandingRow = requiredLabelRow(rowByLabel, "Outstanding STMT");
  const accountRow = requiredLabelRow(rowByLabel, "324");
  const totalGlRow = requiredLabelRow(rowByLabel, "Total GL");
  const differenceRow = requiredLabelRow(rowByLabel, "Difference");
  const scheduleHeaderRow = requiredLabelRow(rowByLabel, "On schedule-not on statement");
  const statementHeaderRow = requiredLabelRow(rowByLabel, "On statement-not on GL");
  const netAdjustmentsRow = requiredLabelRow(rowByLabel, "Net adjustments");
  const varianceRow = requiredLabelRow(rowByLabel, "Variance");
  const scheduleSubtotalRow = requiredSubtotalRow(
    worksheet,
    scheduleHeaderRow + 1,
    statementHeaderRow - 1,
    "schedule-only",
  );
  const statementSubtotalRow = requiredSubtotalRow(
    worksheet,
    statementHeaderRow + 1,
    netAdjustmentsRow - 1,
    "statement-only",
  );

  assertRangeFormula(
    worksheet.getCell(totalGlRow, 2),
    accountRow,
    accountRow,
    "Total GL",
  );

  assertFormulaMeaning(
    worksheet.getCell(differenceRow, 2),
    [outstandingRow, totalGlRow],
    "add",
    "Difference",
  );
  assertFormulaMeaning(
    worksheet.getCell(netAdjustmentsRow, 2),
    [statementSubtotalRow, scheduleSubtotalRow],
    "add",
    "Net adjustments",
  );
  assertFormulaMeaning(
    worksheet.getCell(varianceRow, 2),
    [netAdjustmentsRow, differenceRow],
    "subtract",
    "Variance",
  );
  assertRangeFormula(
    worksheet.getCell(scheduleSubtotalRow, 2),
    scheduleHeaderRow + 1,
    scheduleSubtotalRow - 1,
    "schedule-only subtotal",
  );
  assertRangeFormula(
    worksheet.getCell(statementSubtotalRow, 2),
    statementHeaderRow + 1,
    statementSubtotalRow - 1,
    "statement-only subtotal",
  );
  const outstandingStatementCents = requiredWorkbookAmount(
    worksheet.getCell(outstandingRow, 2),
    "Outstanding STMT",
  );
  const totalGlCents = requiredWorkbookAmount(worksheet.getCell(accountRow, 2), "account 324");
  const scheduleOnly = readWorkbookSection(
    worksheet,
    scheduleHeaderRow + 1,
    scheduleSubtotalRow - 1,
  );
  const statementOnly = readWorkbookSection(
    worksheet,
    statementHeaderRow + 1,
    statementSubtotalRow - 1,
  );
  const differenceCents = outstandingStatementCents + totalGlCents;
  const netAdjustmentsCents = [...scheduleOnly, ...statementOnly].reduce(
    (total, row) => total + row.amountCents,
    0,
  );

  return {
    sheetName: "APR26",
    visibleColumnCount: populatedColumnCount(worksheet),
    printArea: normalizedPrintArea(worksheet.pageSetup.printArea),
    summary: {
      outstandingStatementCents,
      totalGlCents,
      differenceCents,
      netAdjustmentsCents,
      varianceCents: netAdjustmentsCents - differenceCents,
    },
    scheduleOnly,
    statementOnly,
    formulas: {
      totalGl: "account_range",
      difference: "statement_plus_gl",
      scheduleSubtotal: "section_range",
      statementSubtotal: "section_range",
      netAdjustments: "schedule_only_plus_statement_only",
      variance: "net_adjustments_minus_difference",
    },
    workpaper: {
      labelOrder: [...ORDERED_WORKPAPER_LABELS]
        .sort((left, right) => requiredLabelRow(rowByLabel, left) - requiredLabelRow(rowByLabel, right)),
      scheduleHeaders: worksheetHeaderCells(worksheet, scheduleHeaderRow),
      statementHeaders: worksheetHeaderCells(worksheet, statementHeaderRow),
    },
  };
}

export async function buildAcuraArtifactsFromEvidence(paths: AcuraEvidencePaths): Promise<{
  merged: MergedFloorplanWorkbook;
  fpRec: FpRecWorkbook;
}> {
  const profile = ROOFTOP_PROFILES.acura;
  const boaOutput = requirePreprocessedOutput(
    preprocessUpload(readFileSync(paths.boaCsv), "boa", basename(paths.boaCsv), {
      accountingMonth: APRIL_ACCOUNTING_MONTH,
      rooftopProfile: profile,
    }),
    "BOA",
  );
  const dealertrackOutput = requirePreprocessedOutput(
    preprocessUpload(
      readFileSync(paths.dealertrackCsv),
      "dealertrack",
      basename(paths.dealertrackCsv),
      { accountingMonth: APRIL_ACCOUNTING_MONTH, rooftopProfile: profile },
    ),
    "Dealertrack",
  );

  const boaTransactions = toTransactions(boaOutput.transactions, "boa", 1, 1);
  const dealertrackTransactions = toTransactions(
    dealertrackOutput.transactions,
    "dealertrack",
    2,
    100_000,
  );
  const result = reconcileTransactionSets(boaTransactions, dealertrackTransactions);
  const detail = toRunDetail(
    result,
    boaTransactions,
    dealertrackTransactions,
    boaOutput.summary.rows_accepted,
    dealertrackOutput.summary.rows_accepted,
  );

  return {
    merged: buildMergedFloorplanWorkbookFromReconciliationDetail(detail, profile),
    fpRec: buildFpRecWorkbook(detail, profile),
  };
}

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

function requirePreprocessedOutput(
  decision: ReturnType<typeof preprocessUpload>,
  sourceLabel: "BOA" | "Dealertrack",
) {
  if (decision.kind !== "preprocessed") {
    throw safeEvidenceError(sourceLabel, `production preprocessing returned ${decision.kind}`);
  }
  const { output } = decision;
  if (output.validationFailure) {
    throw safeEvidenceError(
      sourceLabel,
      `production preprocessing returned ${output.validationFailure.code}`,
    );
  }
  if (output.validationErrors.length > 0) {
    throw safeEvidenceError(
      sourceLabel,
      `production preprocessing reported ${output.validationErrors.length} validation errors`,
    );
  }
  return output;
}

function toTransactions(
  transactions: NewTransaction[],
  sourceType: "boa" | "dealertrack",
  sourceFileId: number,
  firstId: number,
): Transaction[] {
  return transactions.map((transaction, index) => ({
    ...transaction,
    id: firstId + index,
    dealership_id: 1,
    source_file_id: sourceFileId,
    source_type: sourceType,
    account_type: transaction.account_type ?? "floorplan",
    account_identifier: transaction.account_identifier ?? "floorplan",
  }));
}

function toRunDetail(
  result: ReturnType<typeof reconcileTransactionSets>,
  boaTransactions: Transaction[],
  dealertrackTransactions: Transaction[],
  boaRows: number,
  dealertrackRows: number,
): ReconciliationRunDetail {
  return {
    reconciliation_run_id: 1,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: ACURA_STORE_NAME,
    dealer_group_id: null,
    dealer_group_name: null,
    boa_source_file_id: 1,
    dealertrack_source_file_id: 2,
    boa_filename: "boa.csv",
    dealertrack_filename: "dealertrack.csv",
    matched_count: result.matched_count,
    exception_count: result.exception_count,
    duplicate_count: result.duplicate_count,
    status: "completed",
    accounting_month: APRIL_ACCOUNTING_MONTH,
    rooftop_profile_id: "acura-v1",
    rooftop_profile_version: "1",
    created_at: `${APRIL_END_DATE}T00:00:00.000Z`,
    boa_source_file: sourceSummary(1, "boa", boaRows),
    dealertrack_source_file: sourceSummary(2, "dealertrack", dealertrackRows),
    match_groups: result.match_groups.map((group, index) => ({
      match_group_id: index + 1,
      match_type: group.match_reason,
      confidence: group.confidence_score,
      reason: group.match_reason,
      created_at: `${APRIL_END_DATE}T00:00:00.000Z`,
      transactions: group.transactions.map((transaction) => ({
        side: transaction.source_type === "boa" ? "boa" : "dealertrack",
        source_type: transaction.source_type,
        transaction,
      })),
    })),
    exceptions: result.exceptions.map((exception, index) => ({
      exception_id: index + 1,
      dealership_id: 1,
      exception_type: exception.exception_type as ReconciliationRunDetail["exceptions"][number]["exception_type"],
      exception_category: exception.exception_category,
      status: "unresolved",
      note: "",
      review_status: "unreviewed",
      assigned_to: null,
      review_notes: "",
      boa_notes: "",
      gl_notes: "",
      reviewed_at: null,
      reviewed_by: null,
      source_type: exception.source_type,
      reason: exception.description,
      created_at: `${APRIL_END_DATE}T00:00:00.000Z`,
      transaction: exception.transaction,
    })),
  };
}

function sourceSummary(
  sourceFileId: number,
  sourceType: "boa" | "dealertrack",
  rowCount: number,
): SourceFileSummary {
  const profile = ROOFTOP_PROFILES.acura;
  const parser = profile.parserIdentities[sourceType][0];
  const preprocessor = profile.preprocessorIdentities[sourceType];
  return {
    source_file_id: sourceFileId,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: ACURA_STORE_NAME,
    source_type: sourceType,
    filename: `${sourceType}.csv`,
    row_count: rowCount,
    validation_error_count: 0,
    accounting_month: APRIL_ACCOUNTING_MONTH,
    rooftop_profile_id: profile.profileId,
    rooftop_profile_version: profile.profileVersion,
    parser_name: parser.name,
    parser_version: parser.version,
    preprocessor_name: preprocessor.name,
    preprocessor_version: preprocessor.version,
    preprocessing_metadata: null,
    created_at: `${APRIL_END_DATE}T00:00:00.000Z`,
  };
}

function classifyMergedEvidenceRow(
  row: string[],
): "matched" | "boa_only" | "dealertrack_only" {
  const hasBoa = [row[0], row[1], row[2], row[3]].some(hasText);
  const hasDealertrack = [row[4], row[5], row[6], row[7]].some(hasText);
  if (hasBoa && hasDealertrack) return "matched";
  if (hasBoa) return "boa_only";
  if (hasDealertrack) return "dealertrack_only";
  throw safeEvidenceError("merged", "an empty detail row survived structural filtering");
}

function buildWorksheetLabelIndex(worksheet: ExcelJS.Worksheet): Map<string, number> {
  const result = new Map<string, number>();
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const label = normalizeLabel(workbookCellText(cell));
      if (label && !result.has(label)) result.set(label, rowNumber);
    });
  });
  return result;
}

function requiredLabelRow(index: Map<string, number>, label: string): number {
  const row = index.get(normalizeLabel(label));
  if (!row) throw safeEvidenceError("FP REC", `a required label is unavailable (${label})`);
  return row;
}

function requiredSubtotalRow(
  worksheet: ExcelJS.Worksheet,
  firstRow: number,
  lastRow: number,
  section: string,
): number {
  for (let row = lastRow; row >= firstRow; row -= 1) {
    const label = workbookCellText(worksheet.getCell(row, 1));
    const amountCell = worksheet.getCell(row, 2);
    const amount = workbookAmount(amountCell);
    if (!hasText(label) && (amount !== null || workbookFormula(amountCell))) return row;
  }
  throw safeEvidenceError("FP REC", `${section} subtotal is unavailable`);
}

function readWorkbookSection(
  worksheet: ExcelJS.Worksheet,
  firstRow: number,
  lastRow: number,
): Array<{ unitReference: string; amountCents: number }> {
  const result: Array<{ unitReference: string; amountCents: number }> = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    const unitReference = workbookCellText(worksheet.getCell(row, 1));
    if (!hasText(unitReference)) continue;
    const amountCents = workbookAmount(worksheet.getCell(row, 2));
    if (amountCents === null) {
      throw safeEvidenceError("FP REC", "an exception row has no numeric amount");
    }
    result.push({ unitReference, amountCents });
  }
  return result;
}

function assertFormulaMeaning(
  cell: ExcelJS.Cell,
  operandRows: [number, number],
  operator: "add" | "subtract",
  label: string,
): void {
  const formula = workbookFormula(cell);
  if (!formula) throw safeEvidenceError("FP REC", `${label} formula is unavailable`);
  const normalized = formula.toUpperCase().replace(/^=/, "").replace(/\$/g, "").replace(/\s+/g, "");
  const left = `B${operandRows[0]}`;
  const right = `B${operandRows[1]}`;
  const direct = operator === "add" ? `${left}+${right}` : `${left}-${right}`;
  const accepted = operator === "add"
    ? new Set([direct, `SUM(${direct})`, `${right}+${left}`, `SUM(${right}+${left})`])
    : new Set([direct, `SUM(${direct})`]);
  if (!accepted.has(normalized)) {
    throw safeEvidenceError("FP REC", `${label} formula has unexpected structure`);
  }
}

function assertRangeFormula(
  cell: ExcelJS.Cell,
  firstRow: number,
  lastRow: number,
  label: string,
): void {
  const formula = workbookFormula(cell);
  const normalized = normalizeFormula(formula);
  if (normalized !== `SUM(B${firstRow}:B${lastRow})`) {
    throw safeEvidenceError("FP REC", `${label} formula has unexpected structure`);
  }
}

function workbookFormula(cell: ExcelJS.Cell): string | null {
  const value = cell.value;
  if (!value || typeof value !== "object") return null;
  if ("formula" in value && typeof value.formula === "string") return value.formula;
  return null;
}

function workbookAmount(cell: ExcelJS.Cell): number | null {
  const value = cell.value;
  const resolved = value && typeof value === "object" && "result" in value
    ? value.result
    : value;
  if (typeof resolved !== "string" && typeof resolved !== "number") return null;
  return parseAmountToCents(String(resolved));
}

function requiredWorkbookAmount(cell: ExcelJS.Cell, label: string): number {
  const value = workbookAmount(cell);
  if (value === null) throw safeEvidenceError("FP REC", `${label} amount is unavailable`);
  return value;
}

function workbookCellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (value instanceof Date) return "";
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((fragment) => fragment.text).join("").trim();
  }
  if ("text" in value && typeof value.text === "string") return value.text.trim();
  return "";
}

function worksheetHeaderCells(
  worksheet: ExcelJS.Worksheet,
  row: number,
): [string, string, string, string] {
  return [1, 2, 3, 4].map((column) => workbookCellText(worksheet.getCell(row, column))) as [
    string,
    string,
    string,
    string,
  ];
}

function populatedColumnCount(worksheet: ExcelJS.Worksheet): 4 {
  let maximumColumn = 0;
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      if (workbookCellText(cell) || workbookAmount(cell) !== null || workbookFormula(cell)) {
        maximumColumn = Math.max(maximumColumn, columnNumber);
      }
    });
  });
  if (maximumColumn !== 4) {
    throw safeEvidenceError("FP REC", `populated column count is ${maximumColumn}`);
  }
  return 4;
}

function normalizedPrintArea(value: string | undefined): "A:D" {
  const match = /\$?([A-Z]+)\$?\d+\s*:\s*\$?([A-Z]+)\$?\d+/i.exec(value ?? "");
  if (!match || match[1].toUpperCase() !== "A" || match[2].toUpperCase() !== "D") {
    throw safeEvidenceError("FP REC", "print area is not restricted to columns A:D");
  }
  return "A:D";
}

function optionalEvidenceAmount(value: string | undefined, label: string): number | null {
  if (!hasText(value)) return null;
  return requiredEvidenceAmount(value, label);
}

function requiredEvidenceAmount(value: string | undefined, label: string): number {
  const parsed = parseAmountToCents(value);
  if (parsed === null) throw safeEvidenceError("Acura", `${label} is not a valid amount`);
  return parsed;
}

function compareRowField<
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

function compareWorkpaperSection(
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

function compareFormulaSemantics(
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

type RenderedFpRecRow = {
  rowNumber: number;
  cells: string[];
  formulas: Array<string | null>;
  logicalWidth: number;
};

function parseRenderedFpRecRows(html: string): RenderedFpRecRow[] {
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

function renderedCellColspan(attributes: string): number {
  const match = attributes.match(/\bcolspan\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))/i);
  const colspan = Number(match?.[1] ?? match?.[2] ?? match?.[3] ?? 1);
  return Number.isSafeInteger(colspan) && colspan > 0 ? colspan : 1;
}

function renderedHeaderCells(rows: RenderedFpRecRow[], label: string): string[] {
  return rows.find((row) => row.cells[0] === label)?.cells ?? [];
}

function renderedRowNumber(rows: RenderedFpRecRow[], label: string): number | null {
  return rows.find((row) => row.cells[0] === label)?.rowNumber ?? null;
}

function renderedSubtotalRow(
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

function formulaForRenderedRow(
  rows: RenderedFpRecRow[],
  rowNumber: number | null,
): string | null {
  if (rowNumber === null) return null;
  return rows.find((row) => row.rowNumber === rowNumber)?.formulas[1] ?? null;
}

function formulaEqualsRange(
  formula: string | null,
  firstRow: number | null,
  lastRow: number | null,
): boolean {
  if (firstRow === null || lastRow === null) return false;
  return normalizeFormula(formula) === `SUM(B${firstRow}:B${lastRow})`;
}

function formulaEqualsAddition(
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

function formulaEqualsSubtraction(
  formula: string | null,
  minuendRow: number | null,
  subtrahendRow: number | null,
): boolean {
  if (minuendRow === null || subtrahendRow === null) return false;
  const direct = `B${minuendRow}-B${subtrahendRow}`;
  return new Set([direct, `SUM(${direct})`]).has(normalizeFormula(formula));
}

function normalizeFormula(formula: string | null): string {
  return formula?.toUpperCase().replace(/^=/, "").replace(/\$/g, "").replace(/\s+/g, "") ?? "";
}

function nextRow(row: number | null): number | null {
  return row === null ? null : row + 1;
}

function previousRow(row: number | null): number | null {
  return row === null ? null : row - 1;
}

function worksheetNameFromHtml(html: string): string {
  const worksheet = /<x:ExcelWorksheet>([\s\S]*?)<\/x:ExcelWorksheet>/i.exec(html)?.[1] ?? "";
  const name = /<x:Name>([^<]*)<\/x:Name>/i.exec(worksheet)?.[1] ?? "";
  return decodeHtml(name).trim();
}

function printAreaFromHtml(html: string, worksheetName: string): string {
  const block = /<x:ExcelName>[\s\S]*?<x:Name>Print_Area<\/x:Name>([\s\S]*?)<\/x:ExcelName>/i.exec(html)?.[1] ?? "";
  const formula = decodeHtml(/<x:Formula>([^<]*)<\/x:Formula>/i.exec(block)?.[1] ?? "")
    .replace(/&apos;/g, "'");
  const match = /^='([^']+)'!\$?([A-Z]+)\$?\d+:\$?([A-Z]+)\$?\d+$/i.exec(formula.trim());
  return match && match[1] === worksheetName && match[2].toUpperCase() === "A" && match[3].toUpperCase() === "D"
    ? "A:D"
    : "";
}

function countHtmlColumns(html: string): number {
  const colgroup = /<colgroup>([\s\S]*?)<\/colgroup>/i.exec(html)?.[1] ?? "";
  return [...colgroup.matchAll(/<col\b/gi)].length;
}

function compareStringArray(
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

function compareStringSequence(
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

function compareNumber(
  errors: string[],
  label: string,
  actual: number,
  expected: number,
): void {
  if (actual !== expected) errors.push(`${label}: expected ${expected}, received ${actual}`);
}

function compareString(
  errors: string[],
  label: string,
  actual: string,
  expected: string,
): void {
  if (actual !== expected) errors.push(`${label}: semantic mismatch`);
}

function requireAccountingMonth(value: string): AccountingMonth {
  const month = parseAccountingMonth(value);
  if (!month) throw new Error("Invalid acceptance accounting month");
  return month;
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function text(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function hasText(value: string | null | undefined): boolean {
  return text(value).length > 0;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeEvidenceError(subject: string, message: string): Error {
  return new Error(`${subject} evidence structure error: ${message}`);
}
