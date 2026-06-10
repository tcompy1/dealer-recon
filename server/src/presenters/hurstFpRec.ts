import { formatCents } from "../domain/money.js";
import { computeVin6, extractVin6FromDescription } from "../domain/vin6.js";
import type { ReconciliationRunDetail, SourceType, TransactionSummary } from "../domain/types.js";

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
  store_name: string;
  period_date: string | null;
  net_adjustments_amount: string;
  net_adjustments_amount_cents: number;
  variance_amount: string;
  variance_amount_cents: number;
  summary: HurstFpRecSummary;
  schedule_not_on_statement: HurstFpRecSection;
  statement_not_on_gl: HurstFpRecSection;
};

type DetailException = ReconciliationRunDetail["exceptions"][number];

const SCHEDULE_SECTION_TITLE = "On schedule-not on statement";
const STATEMENT_SECTION_TITLE = "On statement-not on GL";
const FULL_VIN_RE = /\b(?=[A-HJ-NPR-Z0-9]{17}\b)(?=[A-HJ-NPR-Z0-9]*[A-Z])(?=[A-HJ-NPR-Z0-9]*\d)[A-HJ-NPR-Z0-9]{17}\b/gi;

export function buildHurstFpRecWorkbook(detail: ReconciliationRunDetail): HurstFpRecWorkbook {
  const scheduleRowsRaw: HurstFpRecRow[] = [];
  const statementRowsRaw: HurstFpRecRow[] = [];

  for (const exception of detail.exceptions) {
    const placement = worksheetPlacement(exception);
    if (placement === "schedule") {
      scheduleRowsRaw.push(buildRow(exception));
    } else if (placement === "statement") {
      statementRowsRaw.push(buildRow(exception));
    }
  }

  const scheduleRows = scheduleRowsRaw.map((row) => withSignedAmount(row, -1));
  const statementRows = statementRowsRaw.map((row) => withSignedAmount(row, +1));

  const scheduleSection = buildSection(SCHEDULE_SECTION_TITLE, scheduleRows);
  const statementSection = buildSection(STATEMENT_SECTION_TITLE, statementRows);

  const outstandingPerStmtCents = sumSourceTransactions(
    detail,
    "boa",
    (amountCents) => Math.abs(amountCents),
  );
  const gl2100Cents = sumSourceTransactions(
    detail,
    "dealertrack",
    (amountCents) => amountCents,
  );
  const totalGlCents = gl2100Cents;
  const differenceCents = outstandingPerStmtCents + totalGlCents;
  const netAdjustmentsCents =
    statementSection.total_amount_cents + scheduleSection.total_amount_cents;
  const varianceCents = differenceCents - netAdjustmentsCents;

  return {
    store_name: detail.store_name ?? "Unassigned store",
    period_date: resolvePeriodAnchorDate(detail),
    net_adjustments_amount: formatCents(netAdjustmentsCents),
    net_adjustments_amount_cents: netAdjustmentsCents,
    variance_amount: formatCents(varianceCents),
    variance_amount_cents: varianceCents,
    summary: {
      outstanding_per_stmt_amount: formatCents(outstandingPerStmtCents),
      outstanding_per_stmt_amount_cents: outstandingPerStmtCents,
      gl_2100_amount: formatCents(gl2100Cents),
      gl_2100_amount_cents: gl2100Cents,
      total_gl_amount: formatCents(totalGlCents),
      total_gl_amount_cents: totalGlCents,
      difference_amount: formatCents(differenceCents),
      difference_amount_cents: differenceCents,
    },
    schedule_not_on_statement: scheduleSection,
    statement_not_on_gl: statementSection,
  };
}

export function toHurstFpRecXlsHtml(workbook: HurstFpRecWorkbook): string {
  const accountingFormat = '\\\\\\(\\#\\,\\#\\#0\\.00\\\\\\)\\;\\#\\,\\#\\#0\\.00';
  const dateFormat = "mm\\-dd\\-yy";
  const styles = `
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #111827; }
    table { border-collapse: collapse; margin-bottom: 14px; width: 780px; }
    th, td { border: 1px solid #9ca3af; padding: 4px 8px; text-align: left; vertical-align: top; }
    th { background-color: #d9e2f3; color: #111827; font-weight: bold; }
    tr.title-row td { border: 0; font-size: 14pt; font-weight: bold; padding: 0 0 8px 0; }
    tr.summary-row td { background-color: #ffffff; }
    tr.summary-row.subheader td { font-weight: bold; background-color: #f3f4f6; }
    tr.summary-row.difference td, tr.bottom-row.net td { background-color: #fff2cc; font-weight: bold; }
    tr.bottom-row.variance td { background-color: #ffffff; font-weight: bold; }
    tr.subtotal-row td { background-color: #f3f4f6; font-weight: bold; }
    td.label { font-weight: bold; }
    td.amount { text-align: right; font-family: Consolas, Menlo, monospace; mso-number-format: '${accountingFormat}'; }
    td.amount-negative { color: #b91c1c; }
    td.date { mso-number-format: '${dateFormat}'; }
    td.no-items { color: #6b7280; }
  `;

  return [
    "<!DOCTYPE html>",
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>Floorplan Reconciliation - ${escapeHtml(workbook.store_name)}</title>`,
    `<style>${styles}</style>`,
    "</head>",
    "<body>",
    worksheetSummaryHtml(workbook),
    sectionHtml(workbook.schedule_not_on_statement, ["GL Floored note", "BOA Floored note"]),
    sectionHtml(workbook.statement_not_on_gl, ["BOA Floored note", "GL Floored note"]),
    bottomRowsHtml(workbook),
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

function worksheetSummaryHtml(workbook: HurstFpRecWorkbook): string {
  return [
    "<table>",
    `<tr class="title-row"><td colspan="2">Floorplan Reconciliation - ${escapeHtml(workbook.store_name)}</td></tr>`,
    `<tr class="summary-row"><td class="label">Period date</td><td class="date">${escapeHtml(workbook.period_date ?? "")}</td></tr>`,
    summaryAmountRow("Outstanding per stmt", workbook.summary.outstanding_per_stmt_amount_cents),
    `<tr class="summary-row subheader"><td class="label">GL Balances</td><td></td></tr>`,
    summaryAmountRow("2100", workbook.summary.gl_2100_amount_cents),
    summaryAmountRow("Total GL", workbook.summary.total_gl_amount_cents),
    summaryAmountRow("Difference", workbook.summary.difference_amount_cents, "difference"),
    "</table>",
  ].join("");
}

function summaryAmountRow(label: string, amountCents: number, extraClass = ""): string {
  const className = ["summary-row", extraClass].filter(Boolean).join(" ");
  return `<tr class="${className}"><td class="label">${escapeHtml(label)}</td><td class="amount${
    amountCents < 0 ? " amount-negative" : ""
  }">${escapeHtml(formatAccountingCents(amountCents))}</td></tr>`;
}

function sectionHtml(
  section: HurstFpRecSection,
  noteColumns: ["GL Floored note", "BOA Floored note"] | ["BOA Floored note", "GL Floored note"],
): string {
  const headers = ["Unit / stock / VIN6 reference", "Amount", ...noteColumns];
  const colWidths = [260, 110, 190, 190];
  const colgroup = `<colgroup>${colWidths.map((width) => `<col style="width:${width}px"/>`).join("")}</colgroup>`;
  const header = headers.map((label) => `<th>${escapeHtml(label)}</th>`).join("");
  const rows = section.rows.length === 0
    ? `<tr><td class="no-items" colspan="${headers.length}">No items</td></tr>`
    : section.rows.map((row) => sectionRowHtml(row, noteColumns)).join("");
  const subtotal = `<tr class="subtotal-row"><td>Subtotal</td><td class="amount${
    section.total_amount_cents < 0 ? " amount-negative" : ""
  }">${escapeHtml(formatAccountingCents(section.total_amount_cents))}</td><td colspan="2"></td></tr>`;

  return [
    `<table>${colgroup}`,
    `<thead><tr><th colspan="${headers.length}">${escapeHtml(section.title)}</th></tr><tr>${header}</tr></thead>`,
    `<tbody>${rows}${subtotal}</tbody>`,
    "</table>",
  ].join("");
}

function sectionRowHtml(
  row: HurstFpRecRow,
  noteColumns: ["GL Floored note", "BOA Floored note"] | ["BOA Floored note", "GL Floored note"],
): string {
  const notes = noteColumns.map((column) =>
    column === "GL Floored note" ? row.gl_floored_note : row.boa_floored_note,
  );
  return `<tr>
    <td>${escapeHtml(row.unit_reference)}</td>
    <td class="amount${row.amount_cents < 0 ? " amount-negative" : ""}">${escapeHtml(
      formatAccountingCents(row.amount_cents),
    )}</td>
    <td>${escapeHtml(notes[0])}</td>
    <td>${escapeHtml(notes[1])}</td>
  </tr>`;
}

function bottomRowsHtml(workbook: HurstFpRecWorkbook): string {
  return [
    "<table>",
    `<tr class="bottom-row net"><td class="label">Net adjustments</td><td class="amount${
      workbook.net_adjustments_amount_cents < 0 ? " amount-negative" : ""
    }">${escapeHtml(formatAccountingCents(workbook.net_adjustments_amount_cents))}</td></tr>`,
    `<tr class="bottom-row variance"><td class="label">Variance</td><td class="amount${
      workbook.variance_amount_cents < 0 ? " amount-negative" : ""
    }">${escapeHtml(formatAccountingCents(workbook.variance_amount_cents))}</td></tr>`,
    "</table>",
  ].join("");
}

function sumSourceTransactions(
  detail: ReconciliationRunDetail,
  sourceType: SourceType,
  mapAmount: (amountCents: number) => number,
): number {
  const seenTransactionIds = new Set<number>();
  let total = 0;
  const addTransaction = (transaction: TransactionSummary) => {
    if (transaction.source_type !== sourceType || seenTransactionIds.has(transaction.id)) {
      return;
    }
    seenTransactionIds.add(transaction.id);
    total += mapAmount(transaction.amount_cents);
  };

  for (const group of detail.match_groups) {
    for (const linked of group.transactions) {
      addTransaction(linked.transaction);
    }
  }
  for (const exception of detail.exceptions) {
    addTransaction(exception.transaction);
  }
  return total;
}

function buildRow(exception: DetailException): HurstFpRecRow {
  const transaction = exception.transaction;
  const stockNumber = transaction.stock_number ?? "";
  const descriptor = transaction.description ?? "";
  const vin6 =
    computeVin6(transaction.vin) ?? extractVin6FromDescription(descriptor) ?? "";
  const { glFlooredDate, boaFlooredDate } = pickFlooredDates(exception);

  return {
    unit_reference: buildUnitReference(stockNumber, vin6, transaction.reference_number, descriptor),
    amount: transaction.amount,
    amount_cents: transaction.amount_cents,
    gl_floored_note: buildFlooredDateNote(glFlooredDate),
    boa_floored_note: buildFlooredDateNote(boaFlooredDate),
  };
}

function worksheetPlacement(exception: DetailException): "schedule" | "statement" | null {
  if (exception.exception_type === "missing_in_boa") {
    return "schedule";
  }
  if (exception.exception_type === "missing_in_dealertrack") {
    return "statement";
  }
  if (
    exception.source_type === "dealertrack" ||
    exception.source_type === "dms" ||
    exception.source_type === "gl"
  ) {
    return "schedule";
  }
  if (exception.source_type === "boa") {
    return "statement";
  }
  return null;
}

function buildUnitReference(
  stockNumber: string,
  vin6: string,
  referenceNumber: string | null,
  descriptor: string,
): string {
  const parts = [stockNumber.trim(), vin6.trim()].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(" / ");
  }
  const fallback = referenceNumber?.trim() || descriptor.trim();
  return scrubFullVin(fallback);
}

function buildFlooredDateNote(date: string): string {
  return date ? `Floored ${date}` : "";
}

function pickFlooredDates(exception: DetailException): {
  glFlooredDate: string;
  boaFlooredDate: string;
} {
  const transactionDate = exception.transaction.transaction_date ?? "";
  const postDate = exception.transaction.post_date ?? "";
  const primary = formatDateMmDdYy(transactionDate || postDate);
  const source = exception.source_type;
  if (source === "boa") {
    return { glFlooredDate: "", boaFlooredDate: primary };
  }
  if (source === "dealertrack" || source === "dms" || source === "gl") {
    return { glFlooredDate: primary, boaFlooredDate: "" };
  }
  return { glFlooredDate: "", boaFlooredDate: "" };
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

function withSignedAmount(row: HurstFpRecRow, sign: 1 | -1): HurstFpRecRow {
  const signedCents = sign * Math.abs(row.amount_cents);
  return {
    ...row,
    amount_cents: signedCents,
    amount: formatCents(signedCents),
  };
}

function buildSection(title: string, rows: HurstFpRecRow[]): HurstFpRecSection {
  const sortedRows = [...rows].sort((left, right) => {
    const magnitudeDelta = Math.abs(left.amount_cents) - Math.abs(right.amount_cents);
    if (magnitudeDelta !== 0) {
      return magnitudeDelta;
    }
    return left.unit_reference.localeCompare(right.unit_reference);
  });
  const totalCents = sortedRows.reduce((total, row) => total + row.amount_cents, 0);
  return {
    title,
    rows: sortedRows,
    total_amount: formatCents(totalCents),
    total_amount_cents: totalCents,
  };
}

function formatAccountingCents(amountCents: number): string {
  const absCents = Math.abs(amountCents);
  const dollars = Math.floor(absCents / 100);
  const cents = String(absCents % 100).padStart(2, "0");
  const dollarsWithCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (amountCents < 0) {
    return `(${dollarsWithCommas}.${cents})`;
  }
  return `${dollarsWithCommas}.${cents}`;
}

function scrubFullVin(value: string): string {
  return value.replace(FULL_VIN_RE, (vin) => computeVin6(vin) ?? vin.slice(-6));
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
