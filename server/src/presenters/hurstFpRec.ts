import { formatCents } from "../domain/money.js";
import { computeVin6 } from "../domain/vin6.js";
import type { ReconciliationRunDetail, SourceType, TransactionSummary } from "../domain/types.js";
import {
  STORE_WORKFLOW_CONFIGS,
  type StoreWorkflowConfig,
} from "../config/storeWorkflowConfig.js";
import type { MergedFloorplanWorkbook, MergedFloorplanRow } from "./mergedFloorplan.js";

export type HurstFpRecRowClassification = "matched" | "boa_only" | "dealertrack_only";

export type HurstFpRecClerkRow = {
  hurst_description: string;
  boa_vin: string;
  boa_vin6: string;
  ending_balance_cents: number | null;
  dt_2100_cents: number | null;
  dt_vin6: string;
  dt_description: string;
  dt_control: string;
  classification: HurstFpRecRowClassification;
};

export type HurstFpRecSection = {
  title: string;
  rows: HurstFpRecRow[];
  total_amount: string;
  total_amount_cents: number;
};

export type HurstFpRecRow = {
  unit_reference: string;
  amount: string;
  amount_cents: number;
  gl_floored_note: string;
  boa_floored_note: string;
};

export type HurstFpRecSummary = {
  outstanding_per_stmt_amount: string;
  outstanding_per_stmt_amount_cents: number;
  gl_2100_amount: string;
  gl_2100_amount_cents: number;
  total_gl_amount: string;
  total_gl_amount_cents: number;
  difference_amount: string;
  difference_amount_cents: number;
};

export type HurstFpRecWorkbook = {
  store_config: StoreWorkflowConfig;
  store_name: string;
  period_date: string | null;
  headers: string[];
  rows: HurstFpRecClerkRow[];
  boa_total_amount: string;
  boa_total_amount_cents: number;
  dealertrack_total_amount: string;
  dealertrack_total_amount_cents: number;
  net_adjustments_amount: string;
  net_adjustments_amount_cents: number;
  variance_amount: string;
  variance_amount_cents: number;
  summary: HurstFpRecSummary;
  // Compatibility fields retained for JSON consumers while the export moves to
  // the accepted clerk worksheet shape.
  schedule_not_on_statement: HurstFpRecSection;
  statement_not_on_gl: HurstFpRecSection;
};

type DetailException = ReconciliationRunDetail["exceptions"][number];
type MatchGroup = ReconciliationRunDetail["match_groups"][number];

const SCHEDULE_SECTION_TITLE = "On schedule-not on statement";
const STATEMENT_SECTION_TITLE = "On statement-not on GL";
const FINAL_VIN_TOKEN_RE = /(?:^|\s)([A-HJ-NPR-Z0-9]{17})\s*$/i;

export function buildHurstFpRecWorkbook(
  detail: ReconciliationRunDetail,
  storeConfig: StoreWorkflowConfig = STORE_WORKFLOW_CONFIGS.hurst,
): HurstFpRecWorkbook {
  const rows = sortClerkRows([
    ...detail.match_groups.flatMap(buildRowsFromMatchGroup),
    ...detail.exceptions.flatMap(buildRowsFromException),
  ]);

  return buildWorkbookFromClerkRows({
    storeConfig,
    storeName: detail.store_name ?? storeConfig.displayName,
    periodDate: resolvePeriodAnchorDate(detail),
    rows,
  });
}

export function buildFpRecWorkbookFromMergedFloorplan(
  mergedWorkbook: MergedFloorplanWorkbook,
): HurstFpRecWorkbook {
  return buildWorkbookFromClerkRows({
    storeConfig: mergedWorkbook.store_config,
    storeName: mergedWorkbook.store_name,
    periodDate: mergedWorkbook.period_date,
    rows: mergedWorkbook.rows.map(clerkRowFromMergedRow),
  });
}

function buildWorkbookFromClerkRows(input: {
  storeConfig: StoreWorkflowConfig;
  storeName: string;
  periodDate: string | null;
  rows: HurstFpRecClerkRow[];
}): HurstFpRecWorkbook {
  const rows = input.rows;
  const boaTotalCents = rows.reduce(
    (total, row) => total + (row.ending_balance_cents ?? 0),
    0,
  );
  const dealertrackTotalCents = rows.reduce(
    (total, row) => total + (row.dt_2100_cents ?? 0),
    0,
  );
  const varianceCents = boaTotalCents + dealertrackTotalCents;
  const netAdjustmentsCents = rows
    .filter((row) => row.classification !== "matched")
    .reduce(
      (total, row) => total + (row.ending_balance_cents ?? 0) + (row.dt_2100_cents ?? 0),
      0,
    );
  const finalVarianceCents = netAdjustmentsCents - varianceCents;

  const statementSection = buildLegacySection(
    STATEMENT_SECTION_TITLE,
    rows.filter((row) => row.classification === "boa_only").map(legacyStatementRow),
  );
  const scheduleSection = buildLegacySection(
    SCHEDULE_SECTION_TITLE,
    rows.filter((row) => row.classification === "dealertrack_only").map(legacyScheduleRow),
  );

  return {
    store_config: input.storeConfig,
    store_name: input.storeName,
    period_date: input.periodDate,
    headers: clerkHeaders(input.storeConfig),
    rows,
    boa_total_amount: formatCents(boaTotalCents),
    boa_total_amount_cents: boaTotalCents,
    dealertrack_total_amount: formatCents(dealertrackTotalCents),
    dealertrack_total_amount_cents: dealertrackTotalCents,
    net_adjustments_amount: formatCents(netAdjustmentsCents),
    net_adjustments_amount_cents: netAdjustmentsCents,
    variance_amount: formatCents(finalVarianceCents),
    variance_amount_cents: finalVarianceCents,
    summary: {
      outstanding_per_stmt_amount: formatCents(boaTotalCents),
      outstanding_per_stmt_amount_cents: boaTotalCents,
      gl_2100_amount: formatCents(dealertrackTotalCents),
      gl_2100_amount_cents: dealertrackTotalCents,
      total_gl_amount: formatCents(dealertrackTotalCents),
      total_gl_amount_cents: dealertrackTotalCents,
      difference_amount: formatCents(varianceCents),
      difference_amount_cents: varianceCents,
    },
    schedule_not_on_statement: scheduleSection,
    statement_not_on_gl: statementSection,
  };
}

function clerkRowFromMergedRow(row: MergedFloorplanRow): HurstFpRecClerkRow {
  return {
    hurst_description: row.store_description,
    boa_vin: row.serial_no_vin,
    boa_vin6: row.boa_vin6,
    ending_balance_cents: row.ending_balance_cents,
    dt_2100_cents: row.dealertrack_account_amount_cents,
    dt_vin6: row.dealertrack_vin6,
    dt_description: row.dealertrack_description,
    dt_control: row.dealertrack_control,
    classification: row.classification,
  };
}

function clerkHeaders(storeConfig: StoreWorkflowConfig): string[] {
  return [
    storeConfig.mergedSheetLabel,
    "Serial No/VIN",
    "VIN6",
    "Ending Balance",
    storeConfig.dealertrackAccountLabel,
    "VIN6",
    "Description",
    "Control",
  ];
}

export function toHurstFpRecXlsHtml(workbook: HurstFpRecWorkbook): string {
  const accountingNumberFormat = '_\\(\\* \\#\\,\\#\\#0\\.00_\\)\\;_\\(\\* \\(\\#\\,\\#\\#0\\.00\\)\\;_\\(\\* "-"??_\\)\\;_\\(@_\\)';
  const styles = `
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #111827; }
    table { border-collapse: collapse; width: 760px; }
    td { border: 1px solid #d1d5db; padding: 4px 8px; text-align: left; vertical-align: top; }
    tr.title-row td { border: 0; font-size: 14pt; font-weight: bold; padding: 0 0 8px 0; }
    tr.period-row td { border: 0; padding: 0 0 8px 0; }
    tr.section-row td { font-weight: bold; background-color: #f3f4f6; }
    tr.summary-row td:first-child, tr.total-row td:first-child, tr.variance-row td:first-child { font-weight: bold; }
    tr.highlight-row td { background-color: #fff2cc; font-weight: bold; }
    tr.variance-row td { background-color: #fff2cc; font-weight: bold; }
    td.amount { text-align: right; font-family: Calibri, Arial, sans-serif; mso-number-format: '${accountingNumberFormat}'; }
    td.note-entry { background-color: #ffffff; }
  `;
  const colWidths = [260, 120, 110, 110];
  const colgroup = `<colgroup>${colWidths.map((width) => `<col style="width:${width}px"/>`).join("")}</colgroup>`;
  const rows = buildWorkpaperRows(workbook);

  return [
    "<!DOCTYPE html>",
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>Floorplan Reconciliation - ${escapeHtml(workbook.store_name)}</title>`,
    `<style>${styles}</style>`,
    "</head>",
    "<body>",
    `<table>${colgroup}`,
    "<tbody>",
    rows.map(workpaperRowHtml).join(""),
    "</tbody>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
}

export function toHurstFpRecFilename(workbook: HurstFpRecWorkbook): string {
  const store = workbook.store_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "store";
  const period = workbook.period_date?.replace(/[^0-9]/g, "-").replace(/^-|-$/g, "") || "period";
  return `floorplan-reconciliation-${store}-${period}.xls`;
}

function buildRowsFromMatchGroup(group: MatchGroup): HurstFpRecClerkRow[] {
  const boa = group.transactions.find((linked) => isBoaSource(linked.source_type))?.transaction;
  const dealertrack = group.transactions.find((linked) =>
    isDealertrackSource(linked.source_type),
  )?.transaction;

  if (boa && dealertrack) {
    return [buildMatchedRow(boa, dealertrack)];
  }
  if (boa) {
    return [buildBoaOnlyRow(boa)];
  }
  if (dealertrack) {
    return [buildDealertrackOnlyRow(dealertrack)];
  }
  return [];
}

function buildRowsFromException(exception: DetailException): HurstFpRecClerkRow[] {
  if (isBoaSource(exception.source_type)) {
    return [buildBoaOnlyRow(exception.transaction)];
  }
  if (isDealertrackSource(exception.source_type)) {
    return [buildDealertrackOnlyRow(exception.transaction)];
  }
  return [];
}

function buildMatchedRow(
  boa: TransactionSummary,
  dealertrack: TransactionSummary,
): HurstFpRecClerkRow {
  return {
    ...emptyClerkRow("matched"),
    hurst_description: boa.description ?? "",
    boa_vin: boaVin(boa),
    boa_vin6: boaVin6(boa),
    ending_balance_cents: Math.abs(boa.amount_cents),
    dt_2100_cents: dealertrackAccountCents(dealertrack),
    dt_vin6: dealertrackVin6(dealertrack),
    dt_description: dealertrack.description ?? "",
    dt_control: dealertrackControl(dealertrack),
  };
}

function buildBoaOnlyRow(boa: TransactionSummary): HurstFpRecClerkRow {
  return {
    ...emptyClerkRow("boa_only"),
    hurst_description: boa.description ?? "",
    boa_vin: boaVin(boa),
    boa_vin6: boaVin6(boa),
    ending_balance_cents: Math.abs(boa.amount_cents),
  };
}

function buildDealertrackOnlyRow(dealertrack: TransactionSummary): HurstFpRecClerkRow {
  return {
    ...emptyClerkRow("dealertrack_only"),
    dt_2100_cents: dealertrackAccountCents(dealertrack),
    dt_vin6: dealertrackVin6(dealertrack),
    dt_description: dealertrack.description ?? "",
    dt_control: dealertrackControl(dealertrack),
  };
}

function emptyClerkRow(classification: HurstFpRecRowClassification): HurstFpRecClerkRow {
  return {
    hurst_description: "",
    boa_vin: "",
    boa_vin6: "",
    ending_balance_cents: null,
    dt_2100_cents: null,
    dt_vin6: "",
    dt_description: "",
    dt_control: "",
    classification,
  };
}

function sortClerkRows(rows: HurstFpRecClerkRow[]): HurstFpRecClerkRow[] {
  return [...rows].sort((left, right) => {
    if (left.ending_balance_cents !== null && right.ending_balance_cents !== null) {
      const endingBalanceDelta = left.ending_balance_cents - right.ending_balance_cents;
      if (endingBalanceDelta !== 0) {
        return endingBalanceDelta;
      }
      return compareTieBreakers(left, right);
    }
    if (left.ending_balance_cents !== null) {
      return -1;
    }
    if (right.ending_balance_cents !== null) {
      return 1;
    }

    const leftDt = Math.abs(left.dt_2100_cents ?? 0);
    const rightDt = Math.abs(right.dt_2100_cents ?? 0);
    const dtDelta = leftDt - rightDt;
    if (dtDelta !== 0) {
      return dtDelta;
    }
    return compareTieBreakers(left, right);
  });
}

function compareTieBreakers(left: HurstFpRecClerkRow, right: HurstFpRecClerkRow): number {
  return (
    left.boa_vin6.localeCompare(right.boa_vin6) ||
    left.dt_vin6.localeCompare(right.dt_vin6) ||
    left.dt_control.localeCompare(right.dt_control)
  );
}

type WorkpaperRow = {
  className?: string;
  cells: WorkpaperCell[];
};

type WorkpaperCell = {
  text?: string;
  amountCents?: number;
  formula?: string;
  colspan?: number;
  className?: string;
};

function buildWorkpaperRows(workbook: HurstFpRecWorkbook): WorkpaperRow[] {
  const rows: WorkpaperRow[] = [
    {
      className: "title-row",
      cells: [{ text: `Floorplan Reconciliation - ${workbook.store_config.displayName}`, colspan: 4 }],
    },
    {
      className: "period-row",
      cells: [{ text: formatPeriodDateForWorkpaper(workbook.period_date), colspan: 4 }],
    },
    labeledAmountRow("Outstanding per stmt", workbook.summary.outstanding_per_stmt_amount_cents),
    sectionLabelRow("GL Balances"),
    labeledAmountRow(workbook.store_config.dealertrackAccountLabel, workbook.summary.gl_2100_amount_cents),
    labeledAmountRow("Total GL", workbook.summary.total_gl_amount_cents, "=B5", "summary-row"),
    labeledAmountRow("Difference", workbook.summary.difference_amount_cents, "=SUM(B3+B6)", "highlight-row"),
  ];

  let nextExcelRow = rows.length + 1;
  const scheduleStartRow = nextExcelRow + 1;
  rows.push(sectionHeaderRow(SCHEDULE_SECTION_TITLE, "GL Floored", "BOA Floored"));
  nextExcelRow += 1;
  const scheduleRows = workbook.schedule_not_on_statement.rows;
  if (scheduleRows.length === 0) {
    for (let index = 0; index < 4; index += 1) {
      rows.push(blankWorkpaperRow());
      nextExcelRow += 1;
    }
  } else {
    for (const row of scheduleRows) {
      rows.push(exceptionWorkpaperRow(row));
      nextExcelRow += 1;
    }
    rows.push(blankWorkpaperRow());
    nextExcelRow += 1;
  }
  const scheduleSubtotalRow = nextExcelRow;
  rows.push(amountOnlyRow(
    workbook.schedule_not_on_statement.total_amount_cents,
    `=SUM(B${scheduleStartRow}:B${nextExcelRow - 1})`,
  ));
  nextExcelRow += 1;

  const statementHeaderRow = nextExcelRow;
  const statementStartRow = statementHeaderRow + 1;
  rows.push(sectionHeaderRow(STATEMENT_SECTION_TITLE, "BOA Floored", "GL Floored"));
  nextExcelRow += 1;
  const statementRows = workbook.statement_not_on_gl.rows;
  if (statementRows.length === 0) {
    for (let index = 0; index < 4; index += 1) {
      rows.push(blankWorkpaperRow());
      nextExcelRow += 1;
    }
  } else {
    for (const row of statementRows) {
      rows.push(exceptionWorkpaperRow(row));
      nextExcelRow += 1;
    }
    rows.push(blankWorkpaperRow());
    nextExcelRow += 1;
  }
  const statementSubtotalRow = nextExcelRow;
  rows.push(amountOnlyRow(
    workbook.statement_not_on_gl.total_amount_cents,
    `=SUM(B${statementStartRow}:B${nextExcelRow - 1})`,
  ));
  nextExcelRow += 1;

  const netAdjustmentsRow = nextExcelRow;
  rows.push(labeledAmountRow(
    "Net adjustments",
    workbook.net_adjustments_amount_cents,
    `=B${statementSubtotalRow}+B${scheduleSubtotalRow}`,
    "highlight-row",
  ));
  nextExcelRow += 1;
  rows.push(labeledAmountRow(
    "Variance",
    workbook.variance_amount_cents,
    `=B${netAdjustmentsRow}-B7`,
    "variance-row",
  ));

  return rows;
}

function labeledAmountRow(
  label: string,
  amountCents: number,
  formula?: string,
  className?: string,
): WorkpaperRow {
  return {
    className,
    cells: [
      { text: label },
      { amountCents, formula },
      {},
      {},
    ],
  };
}

function amountOnlyRow(amountCents: number, formula: string): WorkpaperRow {
  return {
    className: "total-row",
    cells: [
      {},
      { amountCents, formula },
      {},
      {},
    ],
  };
}

function sectionLabelRow(label: string): WorkpaperRow {
  return {
    className: "section-row",
    cells: [{ text: label }, {}, {}, {}],
  };
}

function sectionHeaderRow(label: string, firstNoteHeader: string, secondNoteHeader: string): WorkpaperRow {
  return {
    className: "section-row",
    cells: [
      { text: label },
      {},
      { text: firstNoteHeader },
      { text: secondNoteHeader },
    ],
  };
}

function exceptionWorkpaperRow(row: HurstFpRecRow): WorkpaperRow {
  return {
    cells: [
      { text: row.unit_reference },
      { amountCents: row.amount_cents },
      { text: row.gl_floored_note, className: "note-entry" },
      { text: row.boa_floored_note, className: "note-entry" },
    ],
  };
}

function blankWorkpaperRow(): WorkpaperRow {
  return { cells: [{}, {}, {}, {}] };
}

function workpaperRowHtml(row: WorkpaperRow): string {
  const classAttr = row.className ? ` class="${escapeHtml(row.className)}"` : "";
  return `<tr${classAttr}>${row.cells.map(workpaperCellHtml).join("")}</tr>`;
}

function workpaperCellHtml(cell: WorkpaperCell): string {
  const classes = [
    cell.className,
    cell.amountCents !== undefined ? "amount" : null,
  ].filter(Boolean).join(" ");
  const classAttr = classes ? ` class="${escapeHtml(classes)}"` : "";
  const colspanAttr = cell.colspan && cell.colspan > 1 ? ` colspan="${cell.colspan}"` : "";
  const formulaAttr = cell.formula ? ` x:fmla="${escapeHtml(cell.formula)}"` : "";
  const numberAttr = cell.amountCents !== undefined ? " x:num" : "";
  const value = cell.amountCents !== undefined
    ? formatWorkpaperNumberCents(cell.amountCents)
    : cell.text ?? "";
  return `<td${classAttr}${colspanAttr}${numberAttr}${formulaAttr}>${escapeHtml(value)}</td>`;
}

function isBoaSource(sourceType: SourceType): boolean {
  return sourceType === "boa";
}

function isDealertrackSource(sourceType: SourceType): boolean {
  return sourceType === "dealertrack" || sourceType === "dms" || sourceType === "gl";
}

function boaVin(transaction: TransactionSummary): string {
  return cleanVin(transaction.vin) || finalVinToken(transaction.description) || "";
}

function boaVin6(transaction: TransactionSummary): string {
  return computeVin6(boaVin(transaction)) ?? "";
}

function dealertrackVin6(transaction: TransactionSummary): string {
  const descriptionVin6 = finalVin6FromDescription(transaction.description);
  return descriptionVin6 ?? computeVin6(transaction.vin) ?? "";
}

function finalVin6FromDescription(description: string | null | undefined): string | null {
  const vin = finalVinToken(description);
  return vin ? vin.slice(-6) : null;
}

function finalVinToken(description: string | null | undefined): string {
  if (!description) {
    return "";
  }
  const match = description.toUpperCase().match(FINAL_VIN_TOKEN_RE);
  return match?.[1] ?? "";
}

function cleanVin(vin: string | null | undefined): string {
  return vin?.toUpperCase().trim() ?? "";
}

function dealertrackAccountCents(transaction: TransactionSummary): number {
  return -Math.abs(transaction.amount_cents);
}

function dealertrackControl(transaction: TransactionSummary): string {
  return transaction.reference_number?.trim() || transaction.stock_number?.trim() || "";
}

function legacyStatementRow(row: HurstFpRecClerkRow): HurstFpRecRow {
  const amountCents = row.ending_balance_cents ?? 0;
  return {
    unit_reference: statementUnitReference(row),
    amount: formatCents(amountCents),
    amount_cents: amountCents,
    gl_floored_note: "",
    boa_floored_note: "",
  };
}

function legacyScheduleRow(row: HurstFpRecClerkRow): HurstFpRecRow {
  const amountCents = row.dt_2100_cents ?? 0;
  return {
    unit_reference: scheduleUnitReference(row),
    amount: formatCents(amountCents),
    amount_cents: amountCents,
    gl_floored_note: "",
    boa_floored_note: "",
  };
}

function scheduleUnitReference(row: HurstFpRecClerkRow): string {
  const vinTail = vinTailForWorkpaper(row.dt_description, row.dt_vin6);
  return [row.dt_control, vinTail].filter(Boolean).join(" - ") || row.dt_description || row.dt_vin6;
}

function statementUnitReference(row: HurstFpRecClerkRow): string {
  const vinTail = vinTailForWorkpaper(row.boa_vin, row.boa_vin6);
  const stockOrControl = row.dt_control;
  return [vinTail, stockOrControl].filter(Boolean).join(" - ") || row.hurst_description || row.boa_vin6;
}

function vinTailForWorkpaper(
  vinOrDescription: string | null | undefined,
  fallbackVin6: string,
): string {
  const vin = finalVinToken(vinOrDescription) || cleanVin(vinOrDescription);
  if (vin.length >= 8) {
    return vin.slice(-8);
  }
  return fallbackVin6;
}

function buildLegacySection(title: string, rows: HurstFpRecRow[]): HurstFpRecSection {
  const totalCents = rows.reduce((total, row) => total + row.amount_cents, 0);
  return {
    title,
    rows,
    total_amount: formatCents(totalCents),
    total_amount_cents: totalCents,
  };
}

function resolvePeriodAnchorDate(detail: ReconciliationRunDetail): string | null {
  let latestIso: string | null = null;
  const trackCandidate = (value: string | null | undefined) => {
    if (!value) {
      return;
    }
    const iso = value.length >= 10 ? value.slice(0, 10) : value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return;
    }
    if (latestIso === null || iso > latestIso) {
      latestIso = iso;
    }
  };

  for (const exception of detail.exceptions) {
    trackCandidate(exception.transaction.transaction_date);
    trackCandidate(exception.transaction.post_date);
  }
  for (const group of detail.match_groups) {
    for (const linked of group.transactions) {
      trackCandidate(linked.transaction.transaction_date);
      trackCandidate(linked.transaction.post_date);
    }
  }

  return formatDateMmDdYy(latestIso ?? detail.created_at);
}

function formatDateMmDdYy(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return `${mm}-${dd}-${yyyy.slice(2)}`;
  }
  const usMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(trimmed);
  if (usMatch) {
    const [, mm, dd, yyRaw] = usMatch;
    const yy = yyRaw.length === 4 ? yyRaw.slice(2) : yyRaw.padStart(2, "0");
    return `${mm.padStart(2, "0")}-${dd.padStart(2, "0")}-${yy}`;
  }
  return trimmed;
}

function formatWorkpaperNumberCents(amountCents: number): string {
  const absCents = Math.abs(amountCents);
  const dollars = Math.floor(absCents / 100);
  const cents = String(absCents % 100).padStart(2, "0");
  const dollarsWithCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const value = `${dollarsWithCommas}.${cents}`;
  return amountCents < 0 ? `(${value})` : value;
}

function formatPeriodDateForWorkpaper(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return value.replace(/-/g, "/");
}

function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
