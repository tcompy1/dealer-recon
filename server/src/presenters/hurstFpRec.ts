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

export type HurstFpRecWorkbook = {
  reconciliation_run_id: number;
  store_name: string;
  generated_at: string;
  boa_filename: string;
  dealertrack_filename: string;
  boa_total_amount: string;
  boa_total_amount_cents: number;
  dealertrack_total_amount: string;
  dealertrack_total_amount_cents: number;
  variance_amount: string;
  variance_amount_cents: number;
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

export function buildHurstFpRecWorkbook(detail: ReconciliationRunDetail): HurstFpRecWorkbook {
  const scheduleRows: HurstFpRecRow[] = [];
  const statementRows: HurstFpRecRow[] = [];
  const needsReviewRows: HurstFpRecRow[] = [];

  for (const exception of detail.exceptions) {
    const row = buildRow(exception);
    if (NEEDS_REVIEW_CATEGORIES.has(exception.exception_category)) {
      needsReviewRows.push(row);
      continue;
    }
    if (exception.exception_type === "missing_in_boa") {
      // Dealertrack/GL transaction has no BOA statement counterpart.
      scheduleRows.push(row);
    } else if (exception.exception_type === "missing_in_dealertrack") {
      // BOA statement transaction has no Dealertrack/GL counterpart.
      statementRows.push(row);
    } else {
      needsReviewRows.push(row);
    }
  }

  const boaTotalCents = detail.match_groups.reduce(
    (total, group) =>
      total +
      group.transactions
        .filter((linked) => linked.source_type === "boa")
        .reduce((sum, linked) => sum + Math.abs(linked.transaction.amount_cents), 0),
    0,
  ) + statementRows.reduce((total, row) => total + Math.abs(row.amount_cents), 0);

  const dealertrackTotalCents = detail.match_groups.reduce(
    (total, group) =>
      total +
      group.transactions
        .filter((linked) => linked.source_type === "dealertrack")
        .reduce((sum, linked) => sum + Math.abs(linked.transaction.amount_cents), 0),
    0,
  ) + scheduleRows.reduce((total, row) => total + Math.abs(row.amount_cents), 0);

  const varianceCents = boaTotalCents - dealertrackTotalCents;
  const carriedForwardCount = [scheduleRows, statementRows, needsReviewRows]
    .flat()
    .filter((row) => row.carried_forward).length;

  return {
    reconciliation_run_id: detail.reconciliation_run_id,
    store_name: detail.store_name ?? "Unassigned store",
    generated_at: new Date().toISOString(),
    boa_filename: detail.boa_filename,
    dealertrack_filename: detail.dealertrack_filename,
    boa_total_amount: formatCents(boaTotalCents),
    boa_total_amount_cents: boaTotalCents,
    dealertrack_total_amount: formatCents(dealertrackTotalCents),
    dealertrack_total_amount_cents: dealertrackTotalCents,
    variance_amount: formatCents(varianceCents),
    variance_amount_cents: varianceCents,
    carried_forward_count: carriedForwardCount,
    schedule_not_on_statement: buildSection(
      "Schedule Not on Statement",
      "Dealertrack/GL rows with no matching BOA statement entry.",
      scheduleRows,
    ),
    statement_not_on_gl: buildSection(
      "Statement Not on GL",
      "BOA statement rows with no matching Dealertrack/GL entry.",
      statementRows,
    ),
    needs_review: buildSection(
      "Needs Review",
      "Items where VIN, amount, or stock differ between sides and require clerk judgment.",
      needsReviewRows,
    ),
  };
}

export function toHurstFpRecXlsHtml(workbook: HurstFpRecWorkbook): string {
  const styles = `
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1f2937; }
    h1 { font-size: 16pt; margin-bottom: 4px; }
    h2 { font-size: 13pt; margin-top: 20px; margin-bottom: 4px; }
    p.caption { margin: 0 0 8px 0; color: #4b5563; }
    table { border-collapse: collapse; margin-bottom: 12px; width: 100%; }
    th, td { border: 1px solid #cbd5f5; padding: 4px 8px; text-align: left; vertical-align: top; }
    th { background-color: #1e3a8a; color: #ffffff; }
    tr.section-total td { background-color: #f1f5f9; font-weight: bold; }
    tr.summary-row td { background-color: #fef3c7; font-weight: bold; }
    td.amount { text-align: right; font-family: 'Consolas', 'Menlo', monospace; }
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
    sectionHtml(workbook.schedule_not_on_statement),
    sectionHtml(workbook.statement_not_on_gl),
    sectionHtml(workbook.needs_review),
    "</body>",
    "</html>",
  ].join("\n");
}

function summaryTableHtml(workbook: HurstFpRecWorkbook): string {
  const rows = [
    ["BOA file", workbook.boa_filename],
    ["Dealertrack file", workbook.dealertrack_filename],
    ["Outstanding per statement (BOA)", workbook.boa_total_amount],
    ["2100 schedule total (Dealertrack)", workbook.dealertrack_total_amount],
    ["Variance (BOA - Dealertrack)", workbook.variance_amount],
    ["Carried forward from prior runs", String(workbook.carried_forward_count)],
  ];

  const body = rows
    .map(
      ([label, value]) =>
        `<tr class="summary-row"><td>${escapeHtml(label)}</td><td class="amount">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  return `<h2>Reconciliation Summary</h2><table>${body}</table>`;
}

function sectionHtml(section: HurstFpRecSection): string {
  const header = [
    "Descriptor",
    "Stock #",
    "VIN6",
    "VIN",
    "Amount",
    "GL Notes",
    "BOA Notes",
    "Carry-fwd",
    "First Seen",
    "Prior Notes",
    "Review Status",
  ]
    .map((label) => `<th>${escapeHtml(label)}</th>`)
    .join("");

  const body = section.rows.length === 0
    ? `<tr><td colspan="11">No items</td></tr>`
    : section.rows
        .map(
          (row) =>
            `<tr>
              <td>${escapeHtml(row.descriptor)}</td>
              <td>${escapeHtml(row.stock_number)}</td>
              <td>${escapeHtml(row.vin6)}</td>
              <td>${escapeHtml(row.vin)}</td>
              <td class="amount">${escapeHtml(row.amount)}</td>
              <td>${escapeHtml(row.gl_notes)}</td>
              <td>${escapeHtml(row.boa_notes)}</td>
              <td>${escapeHtml(formatCarryForward(row))}</td>
              <td>${escapeHtml(formatFirstSeen(row))}</td>
              <td>${escapeHtml(formatPriorNotes(row))}</td>
              <td>${escapeHtml(row.review_status)}</td>
            </tr>`,
        )
        .join("");

  const totalRow = `<tr class="section-total"><td colspan="4">Total</td><td class="amount">${escapeHtml(
    section.total_amount,
  )}</td><td colspan="6"></td></tr>`;

  return [
    `<h2>${escapeHtml(section.title)}</h2>`,
    `<p class="caption">${escapeHtml(section.caption)}</p>`,
    `<table><thead><tr>${header}</tr></thead><tbody>${body}${totalRow}</tbody></table>`,
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

  return {
    descriptor,
    stock_number: stockNumber,
    vin,
    vin6,
    amount: transaction.amount,
    amount_cents: transaction.amount_cents,
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

function buildSection(title: string, caption: string, rows: HurstFpRecRow[]): HurstFpRecSection {
  const totalCents = rows.reduce((total, row) => total + Math.abs(row.amount_cents), 0);
  return {
    title,
    caption,
    rows,
    total_amount: formatCents(totalCents),
    total_amount_cents: totalCents,
  };
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
