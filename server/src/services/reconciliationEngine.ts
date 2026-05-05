import type {
  MatchGroup,
  ReconciliationException,
  ReconciliationResponse,
  SourceType,
  Transaction,
  TransactionSummary,
} from "../domain/types.js";
import { formatCents } from "../domain/money.js";
import type { TransactionRepository } from "../repositories/transactionRepository.js";

export const VIN_EXACT_REASON = "vin_exact";
export const STOCK_AMOUNT_REASON = "stock_number_amount";
export const AMOUNT_CONTEXT_REASON = "amount_reference_context";

type ReconciliationScope = {
  leftSourceFileId?: number;
  rightSourceFileId?: number;
};

type CandidateMatch = {
  transaction: Transaction;
  match_reason: string;
  confidence_score: number;
};

export async function reconcileTransactions(
  repository: TransactionRepository,
  leftSourceType: SourceType = "boa",
  rightSourceType: SourceType = "dealertrack",
  scope: ReconciliationScope = {},
): Promise<ReconciliationResponse> {
  const leftTransactions =
    scope.leftSourceFileId === undefined
      ? await repository.listBySource(leftSourceType)
      : await repository.listBySourceFile(scope.leftSourceFileId);
  const rightTransactions =
    scope.rightSourceFileId === undefined
      ? await repository.listBySource(rightSourceType)
      : await repository.listBySourceFile(scope.rightSourceFileId);

  const matchedRightIds = new Set<number>();
  const duplicateRightIds = new Set<number>();
  const matchGroups: MatchGroup[] = [];
  const exceptions: ReconciliationException[] = [];

  for (const leftTransaction of leftTransactions) {
    const candidates = rightTransactions.filter(
      (rightTransaction) =>
        !matchedRightIds.has(rightTransaction.id) && !duplicateRightIds.has(rightTransaction.id),
    );
    const matchingCandidates = findMatchingCandidates(leftTransaction, candidates);

    if (matchingCandidates.length === 0) {
      exceptions.push(
        buildException(
          `missing_in_${rightSourceType}`,
          leftTransaction,
          `${leftSourceType} transaction has no matching ${rightSourceType} transaction.`,
        ),
      );
      continue;
    }

    const [match, ...duplicateMatches] = matchingCandidates;
    matchedRightIds.add(match.transaction.id);
    matchGroups.push({
      match_reason: match.match_reason,
      confidence_score: match.confidence_score,
      transactions: [toSummary(leftTransaction), toSummary(match.transaction)],
    });

    for (const duplicateMatch of duplicateMatches) {
      duplicateRightIds.add(duplicateMatch.transaction.id);
      exceptions.push(
        buildException(
          "duplicate_transaction",
          duplicateMatch.transaction,
          `Duplicate ${rightSourceType} transaction matches ${leftSourceType} transaction ${leftTransaction.id} by ${duplicateMatch.match_reason}.`,
        ),
      );
    }
  }

  for (const rightTransaction of rightTransactions) {
    if (matchedRightIds.has(rightTransaction.id) || duplicateRightIds.has(rightTransaction.id)) {
      continue;
    }

    exceptions.push(
      buildException(
        `missing_in_${leftSourceType}`,
        rightTransaction,
        `${rightSourceType} transaction has no matching ${leftSourceType} transaction.`,
      ),
    );
  }

  const result = {
    matched_count: matchGroups.length,
    exception_count: exceptions.length,
    duplicate_count: duplicateRightIds.size,
    match_groups: matchGroups,
    exceptions,
  };
  assertReconciliationInvariants([...leftTransactions, ...rightTransactions], result);
  return result;
}

function findMatchingCandidates(
  leftTransaction: Transaction,
  rightTransactions: Transaction[],
): CandidateMatch[] {
  const matchers: Array<[string, number, (left: Transaction, right: Transaction) => boolean]> = [
    [VIN_EXACT_REASON, 1.0, isVinMatch],
    [STOCK_AMOUNT_REASON, 0.92, isStockAmountMatch],
    [AMOUNT_CONTEXT_REASON, 0.72, isAmountContextMatch],
  ];

  for (const [matchReason, confidenceScore, matcher] of matchers) {
    const matches = rightTransactions
      .filter((rightTransaction) => matcher(leftTransaction, rightTransaction))
      .map((rightTransaction) => ({
        transaction: rightTransaction,
        match_reason: matchReason,
        confidence_score: confidenceScore,
      }));
    if (matches.length > 0) {
      return matches;
    }
  }

  return [];
}

function isVinMatch(leftTransaction: Transaction, rightTransaction: Transaction): boolean {
  return Boolean(
    leftTransaction.vin &&
      rightTransaction.vin &&
      clean(leftTransaction.vin) === clean(rightTransaction.vin),
  );
}

function isStockAmountMatch(leftTransaction: Transaction, rightTransaction: Transaction): boolean {
  return Boolean(
      leftTransaction.stock_number &&
      rightTransaction.stock_number &&
      clean(leftTransaction.stock_number) === clean(rightTransaction.stock_number) &&
      amountsMatch(leftTransaction.amount_cents, rightTransaction.amount_cents),
  );
}

function isAmountContextMatch(leftTransaction: Transaction, rightTransaction: Transaction): boolean {
  if (!amountsMatch(leftTransaction.amount_cents, rightTransaction.amount_cents)) {
    return false;
  }

  const leftReference = clean(leftTransaction.reference_number);
  const rightReference = clean(rightTransaction.reference_number);
  if (leftReference && rightReference && leftReference === rightReference) {
    return true;
  }

  const leftContext = context(leftTransaction);
  const rightContext = context(rightTransaction);
  return [...leftContext].some((token) => rightContext.has(token));
}

function amountsMatch(leftAmountCents: number, rightAmountCents: number): boolean {
  return Math.abs(leftAmountCents) === Math.abs(rightAmountCents);
}

function context(transaction: Transaction): Set<string> {
  const values = [
    transaction.reference_number,
    transaction.stock_number,
    transaction.vin,
    transaction.description,
  ];
  const tokens = new Set<string>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    for (const token of clean(value).split(" ")) {
      if (token.length >= 4) {
        tokens.add(token);
      }
    }
  }
  return tokens;
}

function clean(value: string | null): string {
  if (!value) {
    return "";
  }
  return value.toUpperCase().replace(/\//g, " ").replace(/-/g, " ").split(/\s+/).join(" ");
}

function buildException(
  exceptionType: string,
  transaction: Transaction,
  description: string,
): ReconciliationException {
  return {
    exception_type: exceptionType,
    source_type: transaction.source_type,
    transaction: toSummary(transaction),
    description,
  };
}

function toSummary(transaction: Transaction): TransactionSummary {
  return {
    id: transaction.id,
    source_type: transaction.source_type,
    transaction_date: transaction.transaction_date,
    post_date: transaction.post_date,
    amount: formatCents(transaction.amount_cents),
    amount_cents: transaction.amount_cents,
    reference_number: transaction.reference_number,
    description: transaction.description,
    account: transaction.account,
    stock_number: transaction.stock_number,
    vin: transaction.vin,
  };
}

export function assertReconciliationInvariants(
  transactions: Transaction[],
  result: ReconciliationResponse,
): void {
  const expectedIds = new Set(transactions.map((transaction) => transaction.id));
  const bucketCounts = new Map<number, number>();

  for (const group of result.match_groups) {
    for (const transaction of group.transactions) {
      bucketCounts.set(transaction.id, (bucketCounts.get(transaction.id) ?? 0) + 1);
    }
  }

  for (const exception of result.exceptions) {
    bucketCounts.set(exception.transaction.id, (bucketCounts.get(exception.transaction.id) ?? 0) + 1);
  }

  for (const transactionId of expectedIds) {
    if ((bucketCounts.get(transactionId) ?? 0) !== 1) {
      throw new Error(`Reconciliation invariant failed for transaction ${transactionId}.`);
    }
  }

  for (const transactionId of bucketCounts.keys()) {
    if (!expectedIds.has(transactionId)) {
      throw new Error(`Reconciliation result references unknown transaction ${transactionId}.`);
    }
  }
}
