import type {
  ReconciliationException,
  ReconciliationExceptionCategory,
  ReconciliationRunDetail,
  SourceType,
  Transaction,
  TransactionSummary,
} from "../domain/types.js";
import { computeVin6, extractVin6FromDescription } from "../domain/vin6.js";

type CategorizableException = {
  exception_type: string;
  source_type: SourceType;
  transaction: TransactionSummary;
  description?: string;
  reason?: string;
  status?: string;
};

type CategorizationInput = {
  exceptions: CategorizableException[];
  boaTransactions: Array<Transaction | TransactionSummary>;
  dealertrackTransactions: Array<Transaction | TransactionSummary>;
};

const vinPattern = /\b[A-HJ-NPR-Z0-9]{17}\b/i;

export function categorizeReconciliationExceptions<TException extends CategorizableException>({
  exceptions,
  boaTransactions,
  dealertrackTransactions,
}: CategorizationInput & { exceptions: TException[] }): Array<
  TException & { exception_category: ReconciliationExceptionCategory }
> {
  return exceptions.map((exception) => ({
    ...exception,
    exception_category: categorizeReconciliationException(exception, {
      boaTransactions,
      dealertrackTransactions,
    }),
  })) as Array<TException & { exception_category: ReconciliationExceptionCategory }>;
}

export function categorizeReconciliationException(
  exception: CategorizableException,
  {
    boaTransactions,
    dealertrackTransactions,
  }: Omit<CategorizationInput, "exceptions">,
): ReconciliationExceptionCategory {
  if (
    exception.exception_type === "needs_review_vin6_only" ||
    isNeedsReviewVin6Reason(exception)
  ) {
    return "vin6_match_amount_mismatch";
  }

  const transaction = exception.transaction;
  const counterpartTransactions =
    transaction.source_type === "boa" ? dealertrackTransactions : boaTransactions;

  if (hasSameVinCounterpart(transaction, counterpartTransactions)) {
    return "vin6_match_amount_mismatch";
  }

  if (exception.exception_type === "missing_in_boa") {
    return "missing_in_boa";
  }
  if (exception.exception_type === "missing_in_dealertrack") {
    return "missing_in_dealertrack";
  }
  if (
    exception.exception_type === "duplicate_transaction" ||
    exception.exception_type === "needs_review_amount_only" ||
    isDuplicateReason(exception)
  ) {
    return placementCategoryForSource(transaction.source_type);
  }
  return "unclassified";
}

export function categorizeRunDetailExceptions(
  run: Pick<ReconciliationRunDetail, "exceptions" | "match_groups">,
  boaTransactions: Array<Transaction | TransactionSummary>,
  dealertrackTransactions: Array<Transaction | TransactionSummary>,
): ReconciliationRunDetail["exceptions"] {
  return categorizeReconciliationExceptions({
    exceptions: run.exceptions,
    boaTransactions,
    dealertrackTransactions,
  });
}

export function categorizeEngineExceptions(
  exceptions: ReconciliationException[],
  boaTransactions: Transaction[],
  dealertrackTransactions: Transaction[],
): ReconciliationException[] {
  return categorizeReconciliationExceptions({
    exceptions,
    boaTransactions,
    dealertrackTransactions,
  });
}

function hasSameVinCounterpart(
  transaction: Transaction | TransactionSummary,
  counterparts: Array<Transaction | TransactionSummary>,
): boolean {
  const fullVin = matchingFullVin(transaction);
  if (fullVin && counterparts.some((counterpart) => matchingFullVin(counterpart) === fullVin)) {
    return true;
  }

  const vin6 = matchingVin6(transaction);
  return Boolean(vin6 && counterparts.some((counterpart) => matchingVin6(counterpart) === vin6));
}

function matchingFullVin(transaction: Transaction | TransactionSummary): string {
  return clean(matchingRawFullVin(transaction.vin) || matchingRawFullVin(transaction.description));
}

function matchingRawFullVin(value: string | null): string {
  return value?.toUpperCase().match(vinPattern)?.[0] ?? "";
}

function matchingVin6(transaction: Transaction | TransactionSummary): string {
  return computeVin6(transaction.vin) ?? extractVin6FromDescription(transaction.description) ?? "";
}

function placementCategoryForSource(sourceType: SourceType): ReconciliationExceptionCategory {
  if (sourceType === "boa") {
    return "missing_in_dealertrack";
  }
  if (sourceType === "dealertrack" || sourceType === "dms" || sourceType === "gl") {
    return "missing_in_boa";
  }
  return "unclassified";
}

function clean(value: string | null): string {
  return value?.toUpperCase().replace(/\//g, " ").replace(/-/g, " ").split(/\s+/).join(" ") ?? "";
}

function isDuplicateReason(exception: CategorizableException): boolean {
  return (exception.description ?? exception.reason ?? "").toLowerCase().includes("duplicate");
}

function isNeedsReviewVin6Reason(exception: CategorizableException): boolean {
  const text = (exception.description ?? exception.reason ?? "").toLowerCase();
  return (
    (
      text.includes("needs review") &&
      text.includes("vin6") &&
      text.includes("amount differs")
    ) ||
    (
      text.includes("vin appears on both sides") &&
      text.includes("amount differs") &&
      text.includes("review manually")
    )
  );
}
