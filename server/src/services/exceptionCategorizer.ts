import type {
  ReconciliationException,
  ReconciliationExceptionCategory,
  ReconciliationRunDetail,
  SourceType,
  Transaction,
  TransactionSummary,
} from "../domain/types.js";

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
  if (exception.exception_type === "duplicate_transaction" || isDuplicateReason(exception)) {
    return "duplicate_or_one_to_many";
  }

  const transaction = exception.transaction;
  const counterpartTransactions =
    transaction.source_type === "boa" ? dealertrackTransactions : boaTransactions;
  const sameSideTransactions =
    transaction.source_type === "boa" ? boaTransactions : dealertrackTransactions;
  const transactionVin = matchingVin(transaction);
  const counterpartByVin = transactionVin
    ? counterpartTransactions.filter((counterpart) => matchingVin(counterpart) === transactionVin)
    : [];

  if (transactionVin && counterpartByVin.length > 0) {
    if (hasDuplicateStructure(transaction, sameSideTransactions, counterpartByVin)) {
      return "duplicate_or_one_to_many";
    }
    if (hasSameSignedAmount(transaction, counterpartByVin)) {
      return "sign_mismatch";
    }
    if (!hasSameAbsoluteAmount(transaction, counterpartByVin)) {
      return datesSuggestTiming(transaction, counterpartByVin)
        ? "possible_timing_issue"
        : "amount_mismatch";
    }
    if (hasStockMismatch(transaction, counterpartByVin)) {
      return "stock_number_mismatch";
    }
    return "unclassified";
  }

  if (!transactionVin && hasReferenceOrStockAmountCounterpart(transaction, counterpartTransactions)) {
    return "vin_missing_but_reference_match";
  }

  if (exception.exception_type === "missing_in_boa") {
    return "missing_in_boa";
  }
  if (exception.exception_type === "missing_in_dealertrack") {
    return "missing_in_dealertrack";
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

function matchingVin(transaction: Transaction | TransactionSummary): string {
  return clean(transaction.vin) || extractVin(transaction.description);
}

function extractVin(value: string | null): string {
  return value?.toUpperCase().match(vinPattern)?.[0] ?? "";
}

function clean(value: string | null): string {
  return value?.toUpperCase().replace(/\//g, " ").replace(/-/g, " ").split(/\s+/).join(" ") ?? "";
}

function hasSameAbsoluteAmount(
  transaction: TransactionSummary,
  counterparts: Array<Transaction | TransactionSummary>,
): boolean {
  return counterparts.some(
    (counterpart) => Math.abs(counterpart.amount_cents) === Math.abs(transaction.amount_cents),
  );
}

function hasSameSignedAmount(
  transaction: TransactionSummary,
  counterparts: Array<Transaction | TransactionSummary>,
): boolean {
  return counterparts.some((counterpart) => counterpart.amount_cents === transaction.amount_cents);
}

function hasStockMismatch(
  transaction: TransactionSummary,
  counterparts: Array<Transaction | TransactionSummary>,
): boolean {
  const stockNumber = clean(transaction.stock_number);
  return Boolean(
    stockNumber &&
      counterparts.some((counterpart) => {
        const counterpartStockNumber = clean(counterpart.stock_number);
        return (
          counterpartStockNumber &&
          counterpartStockNumber !== stockNumber &&
          Math.abs(counterpart.amount_cents) === Math.abs(transaction.amount_cents)
        );
      }),
  );
}

function hasDuplicateStructure(
  transaction: TransactionSummary,
  sameSideTransactions: Array<Transaction | TransactionSummary>,
  counterparts: Array<Transaction | TransactionSummary>,
): boolean {
  const transactionVin = matchingVin(transaction);
  const sameSideSimilar = sameSideTransactions.filter(
    (candidate) =>
      candidate.id !== transaction.id &&
      matchingVin(candidate) === transactionVin &&
      Math.abs(candidate.amount_cents) === Math.abs(transaction.amount_cents),
  );
  const counterpartSimilar = counterparts.filter(
    (counterpart) => Math.abs(counterpart.amount_cents) === Math.abs(transaction.amount_cents),
  );
  return sameSideSimilar.length > 0 || counterpartSimilar.length > 1;
}

function hasReferenceOrStockAmountCounterpart(
  transaction: TransactionSummary,
  counterparts: Array<Transaction | TransactionSummary>,
): boolean {
  const reference = clean(transaction.reference_number);
  const stockNumber = clean(transaction.stock_number);
  return counterparts.some((counterpart) => {
    const referenceMatches = reference && reference === clean(counterpart.reference_number);
    const stockMatches = stockNumber && stockNumber === clean(counterpart.stock_number);
    return Boolean(
      (referenceMatches || stockMatches) &&
        Math.abs(counterpart.amount_cents) === Math.abs(transaction.amount_cents),
    );
  });
}

function datesSuggestTiming(
  transaction: TransactionSummary,
  counterparts: Array<Transaction | TransactionSummary>,
): boolean {
  const transactionDate = effectiveDate(transaction);
  if (!transactionDate) {
    return false;
  }
  return counterparts.some((counterpart) => {
    const counterpartDate = effectiveDate(counterpart);
    if (!counterpartDate || counterpartDate === transactionDate) {
      return false;
    }
    return Math.abs(Date.parse(counterpartDate) - Date.parse(transactionDate)) <= 45 * 86_400_000;
  });
}

function effectiveDate(transaction: Transaction | TransactionSummary): string | null {
  return transaction.transaction_date ?? transaction.post_date;
}

function isDuplicateReason(exception: CategorizableException): boolean {
  return (exception.description ?? exception.reason ?? "").toLowerCase().includes("duplicate");
}
