import type {
  MonthEndReport,
  ReconciliationRunDetail,
} from "../domain/types.js";

export function toExceptionsCsv(detail: ReconciliationRunDetail): string {
  const headers = [
    "reconciliation_run_id",
    "exception_id",
    "placement",
    "status",
    "note",
    "review_status",
    "assigned_to",
    "review_notes",
    "reviewed_at",
    "reviewed_by",
    "source_type",
    "transaction_id",
    "transaction_date",
    "post_date",
    "amount",
    "amount_cents",
    "reference_number",
    "stock_number",
    "vin",
    "description",
    "research_prompt",
    "created_at",
  ];
  const rows = detail.exceptions.map((exception) => {
    const transaction = exception.transaction;
    return [
      detail.reconciliation_run_id,
      exception.exception_id,
      formatExceptionPlacement(exception),
      exception.status,
      exception.note,
      exception.review_status,
      exception.assigned_to,
      exception.review_notes,
      exception.reviewed_at,
      exception.reviewed_by,
      exception.source_type,
      transaction.id,
      transaction.transaction_date,
      transaction.post_date,
      transaction.amount,
      transaction.amount_cents,
      transaction.reference_number,
      transaction.stock_number,
      transaction.vin,
      transaction.description,
      neutralExceptionPrompt(exception),
      exception.created_at,
    ];
  });

  return [headers, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n") + "\n";
}

function exceptionPlacement(
  exception: ReconciliationRunDetail["exceptions"][number],
): "statement" | "schedule" | "manual_review" {
  if (
    exception.exception_type === "needs_review_vin6_only" ||
    exception.exception_category === "vin6_match_amount_mismatch"
  ) {
    return "manual_review";
  }
  if (exception.exception_type === "missing_in_dealertrack" || exception.source_type === "boa") {
    return "statement";
  }
  return "schedule";
}

function formatExceptionPlacement(exception: ReconciliationRunDetail["exceptions"][number]): string {
  const placement = exceptionPlacement(exception);
  if (placement === "statement") {
    return "On statement-not on GL";
  }
  if (placement === "schedule") {
    return "On schedule-not on statement";
  }
  return "Needs manual review";
}

function neutralExceptionPrompt(exception: ReconciliationRunDetail["exceptions"][number]): string {
  const placement = exceptionPlacement(exception);
  if (placement === "statement") {
    return "BOA statement row with no matching Dealertrack/GL row";
  }
  if (placement === "schedule") {
    return "Dealertrack/GL row with no matching BOA statement row";
  }
  return "VIN appears on both sides but amount differs; review manually";
}

export function toMonthEndReportCsv(report: MonthEndReport): string {
  const headers = [
    "account_identifier",
    "account_type",
    "boa_total",
    "dealertrack_total",
    "net_difference",
    "unresolved_exception_count",
    "resolved_exception_count",
    "ignored_exception_count",
  ];
  const rows = report.account_summaries.map((account) => [
    account.account_identifier,
    account.account_type,
    sourceTotalAmount(account.source_totals, "boa"),
    sourceTotalAmount(account.source_totals, "dealertrack"),
    account.net_difference_amount,
    account.unresolved_exception_count,
    account.resolved_exception_count,
    account.ignored_exception_count,
  ]);

  return [headers, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n") + "\n";
}

function sourceTotalAmount(
  sourceTotals: MonthEndReport["account_summaries"][number]["source_totals"],
  sourceType: "boa" | "dealertrack",
): string {
  return sourceTotals.find((total) => total.source_type === sourceType)?.amount ?? "0.00";
}

function toCsvCell(value: string | number | null): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
