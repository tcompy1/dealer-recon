import { formatCents } from "../domain/money.js";
import { computeVin6, extractVin6FromDescription } from "../domain/vin6.js";
import type {
  ReconciliationRunDetail,
} from "../domain/types.js";

export type HurstFpRecSection = {
  title: string;
  caption: string;
  rows: HurstFpRecRow[];
  total_amount: string;
  total_amount_cents: number;
};

export type HurstFpRecRow = {
  descriptor: string;
  stock_number: string;
  vin: string;
  vin6: string;
  amount: string;
  amount_cents: number;
  gl_floored_date: string;
  boa_floored_date: string;
  gl_notes: string;
  boa_notes: string;
  review_status: string;
  carried_forward: boolean;
  previous_run_id: number | null;
  first_seen_run_id: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  occurrence_count: number;
  prior_boa_notes: string;
  prior_gl_notes: string;
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

export type HurstFpRecSignOff = {
  prepared_by_label: string;
  reviewed_by_label: string;
};

export type HurstFpRecWorkbook = {
  reconciliation_run_id: number;
  store_name: string;
  generated_at: string;
  period_anchor_date: string | null;
  boa_filename: string;
  dealertrack_filename: string;
  // Signed totals: BOA outstanding rendered positive, GL 2100 rendered negative.
  boa_total_amount: string;
  boa_total_amount_cents: number;
  dealertrack_total_amount: string;
  dealertrack_total_amount_cents: number;
  variance_amount: string;
  variance_amount_cents: number;
  net_adjustments_amount: string;
  net_adjustments_amount_cents: number;
  final_variance_amount: string;
  final_variance_amount_cents: number;
  summary: HurstFpRecSummary;
  sign_off: HurstFpRecSignOff;
  carried_forward_count: number;
  schedule_not_on_statement: HurstFpRecSection;
  statement_not_on_gl: HurstFpRecSection;
  needs_review: HurstFpRecSection;
};

type DetailException = ReconciliationRunDetail["exceptions"][number];

const NEEDS_REVIEW_CATEGORIES = new Set([
  "amount_mismatch",
  "sign_mismatch",
  "duplicate_or_one_to_many",
  "stock_number_mismatch",
  "vin_missing_but_reference_match",
  "possible_timing_issue",
  "vin6_match_amount_mismatch",
  "amount_only_review",
]);

const SCHEDULE_SECTION_TITLE = "On schedule-not on statement";
const STATEMENT_SECTION_TITLE = "On statement-not on GL";
const NEEDS_REVIEW_SECTION_TITLE = "Needs Review";

export function buildHurstFpRecWorkbook(detail: ReconciliationRunDetail): HurstFpRecWorkbook {
  const scheduleRowsRaw: HurstFpRecRow[] = [];
  const statementRowsRaw: HurstFpRecRow[] = [];
  const needsReviewRowsRaw: HurstFpRecRow[] = [];

  for (const exception of detail.exceptions) {
    const row = buildRow(exception);
    if (NEEDS_REVIEW_CATEGORIES.has(exception.exception_category)) {
      needsReviewRowsRaw.push(row);
      continue;
    }
    if (exception.exception_type === "missing_in_boa") {
      scheduleRowsRaw.push(row);
    } else if (exception.exception_type === "missing_in_dealertrack") {
      statementRowsRaw.push(row);
    } else {
      needsReviewRowsRaw.push(row);
    }
  }

  // Apply accepted accounting sign convention in presentation only:
  //   - On schedule-not on statement renders negative.
  //   - On statement-not on GL renders positive.
  const scheduleRows = scheduleRowsRaw.map((row) => withSignedAmount(row, -1));
  const statementRows = statementRowsRaw.map((row) => withSignedAmount(row, +1));
  const needsReviewRows = needsReviewRowsRaw.map((row) => withSignedAmount(row, +1));

  // Signed matched totals: BOA matched + statement-not-on-GL outstanding renders positive;
  // Dealertrack matched + schedule-not-on-statement renders negative (the "2100" balance).
  const matchedBoaCents = detail.match_groups.reduce(
    (total, group) =>
      total +
      group.transactions
        .filter((linked) => linked.source_type === "boa")
        .reduce((sum, linked) => sum + Math.abs(linked.transaction.amount_cents), 0),
    0,
  );
  const matchedDealertrackCents = detail.match_groups.reduce(
    (total, group) =>
      total +
      group.transactions
        .filter((linked) => linked.source_type === "dealertrack")
        .reduce((sum, linked) => sum + Math.abs(linked.transaction.amount_cents), 0),
    0,
  );

  const outstandingPerStmtCents =
    matchedBoaCents + statementRows.reduce((total, row) => total + row.amount_cents, 0);
  const gl2100Cents =
    -matchedDealertrackCents + scheduleRows.reduce((total, row) => total + row.amount_cents, 0);
  const totalGlCents = gl2100Cents;
  const differenceCents = outstandingPerStmtCents + totalGlCents;

  const scheduleSubtotalCents = scheduleRows.reduce(
    (total, row) => total + row.amount_cents,
    0,
  );
  const statementSubtotalCents = statementRows.reduce(
    (total, row) => total + row.amount_cents,
    0,
  );
  // Phase 1: Net adjustments = statement subtotal + schedule subtotal.
  const netAdjustmentsCents = statementSubtotalCents + scheduleSubtotalCents;
  // Final Variance mirrors accepted workbook: net adjustments - Difference.
  const finalVarianceCents = netAdjustmentsCents - differenceCents;

  const carriedForwardCount = [scheduleRows, statementRows, needsReviewRows]
    .flat()
    .filter((row) => row.carried_forward).length;

  const summary: HurstFpRecSummary = {
    outstanding_per_stmt_amount: formatCents(outstandingPerStmtCents),
    outstanding_per_stmt_amount_cents: outstandingPerStmtCents,
    gl_2100_amount: formatCents(gl2100Cents),
    gl_2100_amount_cents: gl2100Cents,
    total_gl_amount: formatCents(totalGlCents),
    total_gl_amount_cents: totalGlCents,
    difference_amount: formatCents(differenceCents),
    difference_amount_cents: differenceCents,
  };

  return {
    reconciliation_run_id: detail.reconciliation_run_id,
    store_name: detail.store_name ?? "Unassigned store",
    generated_at: new Date().toISOString(),
    period_anchor_date: resolvePeriodAnchorDate(detail),
    boa_filename: detail.boa_filename,
    dealertrack_filename: detail.dealertrack_filename,
    boa_total_amount: formatCents(outstandingPerStmtCents),
    boa_total_amount_cents: outstandingPerStmtCents,
    dealertrack_total_amount: formatCents(gl2100Cents),
    dealertrack_total_amount_cents: gl2100Cents,
    variance_amount: formatCents(differenceCents),
    variance_amount_cents: differenceCents,
    net_adjustments_amount: formatCents(netAdjustmentsCents),
    net_adjustments_amount_cents: netAdjustmentsCents,
    final_variance_amount: formatCents(finalVarianceCents),
    final_variance_amount_cents: finalVarianceCents,
    summary,
    sign_off: {
      prepared_by_label: "Prepared by",
      reviewed_by_label: "Reviewed by",
    },
    carried_forward_count: carriedForwardCount,
    schedule_not_on_statement: buildSection(
      SCHEDULE_SECTION_TITLE,
      "Dealertrack/GL rows with no matching BOA statement entry.",
      scheduleRows,
    ),
    statement_not_on_gl: buildSection(
      STATEMENT_SECTION_TITLE,
      "BOA statement rows with no matching Dealertrack/GL entry.",
      statementRows,
    ),
    needs_review: buildSection(
      NEEDS_REVIEW_SECTION_TITLE,
      "Items where VIN, amount, or stock differ between sides and require clerk judgment.",
      needsReviewRows,
    ),
  };
}

export function toHurstFpRecXlsHtml(workbook: HurstFpRecWorkbook): string {
  // Excel accounting number format with parentheses for negatives, applied via
  // mso-number-format on amount cells. Date cells use mm-dd-yy.
  const accountingFormat = '\\\\\\(\\#\\,\\#\\#0\\.00\\\\\\)\\;\\#\\,\\#\\#0\\.00';
  const dateFormat = 'mm\\-dd\\-yy';
  const styles = `
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1f2937; }
    h1 { font-size: 16pt; margin-bottom: 4px; }
    h2 { font-size: 13pt; margin-top: 20px; margin-bottom: 4px; }
    p.caption { margin: 0 0 8px 0; color: #4b5563; }
    table { border-collapse: collapse; margin-bottom: 12px; width: 100%; }
    th, td { border: 1px solid #cbd5f5; padding: 4px 8px; text-align: left; vertical-align: top; }
    th { background-color: #1e3a8a; color: #ffffff; }
    tr.section-total td { background-color: #f1f5f9; font-weight: bold; }
    tr.summary-row td { background-color: #ffffff; }
    tr.summary-row.subheader td { font-weight: bold; background-color: #f1f5f9; }
    tr.summary-row.yellow td, tr.adjustments-row td { background-color: #FFFF00; font-weight: bold; }
    tr.variance-row td { background-color: #ffffff; font-weight: bold; }
    td.amount { text-align: right; font-family: 'Consolas', 'Menlo', monospace; mso-number-format: '${accountingFormat}'; }
    td.amount-negative { color: #b91c1c; }
    td.date { mso-number-format: '${dateFormat}'; }
    td.signoff { padding-top: 24px; }
    td.label { font-weight: bold; }
  `;

  return [
    "<!DOCTYPE html>",
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>Hurst FP Rec - Run ${workbook.reconciliation_run_id}</title>`,
    `<style>${styles}</style>`,
    "</head>",
    "<body>",
    `<h1>Hurst FP Rec - ${escapeHtml(workbook.store_name)}</h1>`,
    `<p class="caption">Run #${workbook.reconciliation_run_id} - generated ${escapeHtml(workbook.generated_at)}</p>`,
    summaryTableHtml(workbook),
    sectionHtml(workbook.schedule_not_on_statement, "schedule"),
    sectionHtml(workbook.statement_not_on_gl, "statement"),
    adjustmentsAndVarianceHtml(workbook),
    sectionHtml(workbook.needs_review, "needs_review"),
    signOffHtml(workbook),
    "</body>",
    "</html>",
  ].join("\n");
}

function summaryTableHtml(workbook: HurstFpRecWorkbook): string {
  const periodLine = workbook.period_anchor_date
    ? `<tr class="summary-row"><td class="label">Period</td><td class="date">${escapeHtml(
        workbook.period_anchor_date,
      )}</td></tr>`
    : "";

  const fileLines = [
    `<tr class="summary-row"><td class="label">BOA file</td><td>${escapeHtml(workbook.boa_filename)}</td></tr>`,
    `<tr class="summary-row"><td class="label">Dealertrack file</td><td>${escapeHtml(workbook.dealertrack_filename)}</td></tr>`,
  ].join("");

  const summaryRows = [
    summaryAmountRow("Outstanding per stmt", workbook.summary.outstanding_per_stmt_amount_cents),
    `<tr class="summary-row subheader"><td class="label">GL Balances</td><td></td></tr>`,
    summaryAmountRow("2100", workbook.summary.gl_2100_amount_cents),
    summaryAmountRow("Total GL", workbook.summary.total_gl_amount_cents),
    summaryAmountRow("Difference", workbook.summary.difference_amount_cents, { yellow: true }),
    `<tr class="summary-row"><td class="label">Carried forward from prior runs</td><td>${escapeHtml(
      String(workbook.carried_forward_count),
    )}</td></tr>`,
  ].join("");

  return `<h2>Reconciliation Summary</h2><table>${periodLine}${fileLines}${summaryRows}</table>`;
}

function summaryAmountRow(
  label: string,
  amountCents: number,
  opts: { yellow?: boolean } = {},
): string {
  const className = opts.yellow ? "summary-row yellow" : "summary-row";
  return `<tr class="${className}"><td class="label">${escapeHtml(label)}</td><td class="amount${
    amountCents < 0 ? " amount-negative" : ""
  }">${escapeHtml(formatAccountingCents(amountCents))}</td></tr>`;
}

function sectionHtml(section: HurstFpRecSection, kind: "schedule" | "statement" | "needs_review"): string {
  const headers = [
    "Descriptor",
    "Stock #",
    "VIN6",
    "VIN",
    "Amount",
    "GL Floored",
    "BOA Floored",
    "GL Notes",
    "BOA Notes",
    "Carry-fwd",
    "First Seen",
    "Prior Notes",
    "Review Status",
  ];
  const header = headers.map((label) => `<th>${escapeHtml(label)}</th>`).join("");

  const body = section.rows.length === 0
    ? `<tr><td colspan="${headers.length}">No items</td></tr>`
    : section.rows
        .map(
          (row) =>
            `<tr>
              <td>${escapeHtml(row.descriptor)}</td>
              <td>${escapeHtml(row.stock_number)}</td>
              <td>${escapeHtml(row.vin6)}</td>
              <td>${escapeHtml(row.vin)}</td>
              <td class="amount${row.amount_cents < 0 ? " amount-negative" : ""}">${escapeHtml(
                formatAccountingCents(row.amount_cents),
              )}</td>
              <td class="date">${escapeHtml(row.gl_floored_date)}</td>
              <td class="date">${escapeHtml(row.boa_floored_date)}</td>
              <td>${escapeHtml(row.gl_notes)}</td>
              <td>${escapeHtml(row.boa_notes)}</td>
              <td>${escapeHtml(formatCarryForward(row))}</td>
              <td>${escapeHtml(formatFirstSeen(row))}</td>
              <td>${escapeHtml(formatPriorNotes(row))}</td>
              <td>${escapeHtml(row.review_status)}</td>
            </tr>`,
        )
        .join("");

  const subtotalLabel = subtotalLabelFor(kind);
  const totalRow = `<tr class="section-total"><td colspan="4">${escapeHtml(
    subtotalLabel,
  )}</td><td class="amount${section.total_amount_cents < 0 ? " amount-negative" : ""}">${escapeHtml(
    formatAccountingCents(section.total_amount_cents),
  )}</td><td colspan="${headers.length - 5}"></td></tr>`;

  return [
    `<h2>${escapeHtml(section.title)}</h2>`,
    `<p class="caption">${escapeHtml(section.caption)}</p>`,
    `<table><thead><tr>${header}</tr></thead><tbody>${body}${totalRow}</tbody></table>`,
  ].join("");
}

function subtotalLabelFor(kind: "schedule" | "statement" | "needs_review"): string {
  if (kind === "schedule") {
    return "Schedule subtotal";
  }
  if (kind === "statement") {
    return "Statement subtotal";
  }
  return "Subtotal";
}

function adjustmentsAndVarianceHtml(workbook: HurstFpRecWorkbook): string {
  return [
    "<h2>Adjustments and Variance</h2>",
    "<table>",
    `<tr class="adjustments-row"><td class="label">Net adjustments</td><td class="amount${
      workbook.net_adjustments_amount_cents < 0 ? " amount-negative" : ""
    }">${escapeHtml(formatAccountingCents(workbook.net_adjustments_amount_cents))}</td></tr>`,
    `<tr class="variance-row"><td class="label">Variance</td><td class="amount${
      workbook.final_variance_amount_cents < 0 ? " amount-negative" : ""
    }">${escapeHtml(formatAccountingCents(workbook.final_variance_amount_cents))}</td></tr>`,
    "</table>",
  ].join("");
}

function signOffHtml(workbook: HurstFpRecWorkbook): string {
  return [
    "<h2>Sign-off</h2>",
    "<table>",
    `<tr><td class="label signoff">${escapeHtml(workbook.sign_off.prepared_by_label)}</td><td class="signoff">__________________________</td></tr>`,
    `<tr><td class="label signoff">${escapeHtml(workbook.sign_off.reviewed_by_label)}</td><td class="signoff">__________________________</td></tr>`,
    "</table>",
  ].join("");
}

function formatCarryForward(row: HurstFpRecRow): string {
  if (!row.carried_forward) {
    return "";
  }
  return `Yes (${row.occurrence_count}x)`;
}

function formatFirstSeen(row: HurstFpRecRow): string {
  if (!row.first_seen_at) {
    return "";
  }
  const date = row.first_seen_at.slice(0, 10);
  return row.first_seen_run_id ? `${date} (run #${row.first_seen_run_id})` : date;
}

function formatPriorNotes(row: HurstFpRecRow): string {
  const parts: string[] = [];
  if (row.prior_boa_notes) {
    parts.push(`BOA: ${row.prior_boa_notes}`);
  }
  if (row.prior_gl_notes) {
    parts.push(`GL: ${row.prior_gl_notes}`);
  }
  return parts.join(" | ");
}

function buildRow(exception: DetailException): HurstFpRecRow {
  const transaction = exception.transaction;
  const vin = (transaction.vin ?? "").toUpperCase();
  const vin6 =
    computeVin6(transaction.vin) ?? extractVin6FromDescription(transaction.description) ?? "";
  const descriptor = transaction.description ?? "";
  const stockNumber = transaction.stock_number ?? "";
  const glNotes = pickGlNotes(exception);
  const boaNotes = pickBoaNotes(exception);
  const reviewStatus = exception.review_status || (exception.status === "resolved" ? "resolved" : "needs_review");
  const carry = exception.carry_forward;

  const { glFlooredDate, boaFlooredDate } = pickFlooredDates(exception);

  return {
    descriptor,
    stock_number: stockNumber,
    vin,
    vin6,
    amount: transaction.amount,
    amount_cents: transaction.amount_cents,
    gl_floored_date: glFlooredDate,
    boa_floored_date: boaFlooredDate,
    gl_notes: glNotes,
    boa_notes: boaNotes,
    review_status: reviewStatus,
    carried_forward: carry?.carried_forward ?? false,
    previous_run_id: carry?.previous_run_id ?? null,
    first_seen_run_id: carry?.first_seen_run_id ?? null,
    first_seen_at: carry?.first_seen_at ?? null,
    last_seen_at: carry?.last_seen_at ?? null,
    occurrence_count: carry?.occurrence_count ?? 1,
    prior_boa_notes: carry?.prior_boa_notes ?? "",
    prior_gl_notes: carry?.prior_gl_notes ?? "",
  };
}

// Map existing TransactionSummary date fields to per-row floored dates.
// Schedule rows are GL/Dealertrack-side: GL Floored = transaction_date (or post_date as fallback);
// BOA Floored is unknown (the BOA counterpart never landed) so it is rendered blank.
// Statement rows are BOA-side: BOA Floored = transaction_date (or post_date as fallback);
// GL Floored is unknown so it is rendered blank.
// Needs Review rows carry whichever side they originate from.
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
  // Prefer the latest transaction_date observed across both source files; this is the most
  // accurate proxy for the period end without adding schema. Fall back to detail.created_at.
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

  if (latestIso !== null) {
    return formatDateMmDdYy(latestIso);
  }
  return formatDateMmDdYy(detail.created_at);
}

function pickBoaNotes(exception: DetailException): string {
  if (exception.boa_notes && exception.boa_notes.trim().length > 0) {
    return exception.boa_notes;
  }
  if (exception.source_type === "boa") {
    return exception.review_notes || exception.note || "";
  }
  return "";
}

function pickGlNotes(exception: DetailException): string {
  if (exception.gl_notes && exception.gl_notes.trim().length > 0) {
    return exception.gl_notes;
  }
  if (
    exception.source_type === "dealertrack" ||
    exception.source_type === "dms" ||
    exception.source_type === "gl"
  ) {
    return exception.review_notes || exception.note || "";
  }
  return "";
}

function withSignedAmount(row: HurstFpRecRow, sign: 1 | -1): HurstFpRecRow {
  const magnitude = Math.abs(row.amount_cents);
  const signedCents = sign * magnitude;
  return {
    ...row,
    amount_cents: signedCents,
    amount: formatCents(signedCents),
  };
}

function buildSection(title: string, caption: string, rows: HurstFpRecRow[]): HurstFpRecSection {
  // Mirror the clerk's Excel working sort: ascending by amount position. Rows
  // carry signed amounts (sign convention already applied per section), so we
  // sort by absolute magnitude to place rows at their dollar position the same
  // way the clerk sorts col D / col E ascending. VIN6 is a stable tiebreaker so
  // the order is deterministic when two rows share an amount.
  const sortedRows = [...rows].sort((left, right) => {
    const magnitudeDelta = Math.abs(left.amount_cents) - Math.abs(right.amount_cents);
    if (magnitudeDelta !== 0) {
      return magnitudeDelta;
    }
    return left.vin6.localeCompare(right.vin6);
  });
  // Subtotal preserves signed amounts on the rows (sign convention already applied).
  const totalCents = sortedRows.reduce((total, row) => total + row.amount_cents, 0);
  return {
    title,
    caption,
    rows: sortedRows,
    total_amount: formatCents(totalCents),
    total_amount_cents: totalCents,
  };
}

function formatAccountingCents(amountCents: number): string {
  // Render with thousands separators and parentheses for negative values, matching the
  // accounting number format used in the accepted workbook.
  const sign = amountCents < 0 ? "-" : "";
  const absCents = Math.abs(amountCents);
  const dollars = Math.floor(absCents / 100);
  const cents = String(absCents % 100).padStart(2, "0");
  const dollarsWithCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (sign === "-") {
    return `(${dollarsWithCommas}.${cents})`;
  }
  return `${dollarsWithCommas}.${cents}`;
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
