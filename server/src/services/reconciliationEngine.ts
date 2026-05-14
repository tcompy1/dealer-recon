import type {
  MatchGroup,
  ReconciliationException,
  ReconciliationResponse,
  SourceType,
  Transaction,
  TransactionSummary,
  VinPresenceDiagnostics,
  VinPresenceDiagnosticReason,
} from "../domain/types.js";
import { formatCents } from "../domain/money.js";
import type { TransactionRepository } from "../repositories/transactionRepository.js";
import { categorizeEngineExceptions } from "./exceptionCategorizer.js";

export const VIN_EXACT_REASON = "vin_exact";
export const VIN_AMOUNT_REASON = "vin_abs_amount";
export const DERIVED_VIN_AMOUNT_REASON = "derived_vin_abs_amount";
export const STOCK_AMOUNT_REASON = "stock_number_amount";
export const AMOUNT_CONTEXT_REASON = "amount_reference_context";
export const RECONCILIATION_ENGINE_VERSION = "reconciliation-engine-v1";

type ReconciliationScope = {
  dealershipId?: number;
  leftSourceFileId?: number;
  rightSourceFileId?: number;
};

type CandidateMatch = {
  transaction: Transaction;
  match_reason: string;
  confidence_score: number;
  duplicate_eligible: boolean;
};

type MatchTier = {
  reason: string;
  confidence: number;
  duplicateEligible: boolean;
  matcher: (left: Transaction, right: Transaction) => boolean;
};

const MATCH_TIERS: MatchTier[] = [
  {
    reason: VIN_AMOUNT_REASON,
    confidence: 1.0,
    duplicateEligible: true,
    matcher: isExplicitVinAmountMatch,
  },
  {
    reason: DERIVED_VIN_AMOUNT_REASON,
    confidence: 0.98,
    duplicateEligible: true,
    matcher: isDerivedVinAmountMatch,
  },
  {
    reason: STOCK_AMOUNT_REASON,
    confidence: 0.92,
    duplicateEligible: true,
    matcher: isStockAmountMatch,
  },
  {
    reason: AMOUNT_CONTEXT_REASON,
    confidence: 0.72,
    duplicateEligible: false,
    matcher: isAmountContextMatch,
  },
];

export async function reconcileTransactions(
  repository: TransactionRepository,
  leftSourceType: SourceType = "boa",
  rightSourceType: SourceType = "dealertrack",
  scope: ReconciliationScope = {},
): Promise<ReconciliationResponse> {
  const dealershipId = scope.dealershipId ?? 1;
  const leftTransactions =
    scope.leftSourceFileId === undefined
      ? await repository.listBySource(dealershipId, leftSourceType)
      : await repository.listBySourceFile(dealershipId, scope.leftSourceFileId);
  const rightTransactions =
    scope.rightSourceFileId === undefined
      ? await repository.listBySource(dealershipId, rightSourceType)
      : await repository.listBySourceFile(dealershipId, scope.rightSourceFileId);

  return reconcileTransactionSets(leftTransactions, rightTransactions, leftSourceType, rightSourceType);
}

export function reconcileTransactionSets(
  leftTransactions: Transaction[],
  rightTransactions: Transaction[],
  leftSourceType: SourceType = "boa",
  rightSourceType: SourceType = "dealertrack",
): ReconciliationResponse {
  const matchedRightIds = new Set<number>();
  const matchedLeftIds = new Set<number>();
  const duplicateRightIds = new Set<number>();
  const matchGroups: MatchGroup[] = [];
  const exceptions: ReconciliationException[] = [];

  for (const tier of MATCH_TIERS) {
    for (const leftTransaction of leftTransactions) {
      if (matchedLeftIds.has(leftTransaction.id)) {
        continue;
      }

      const candidates = rightTransactions.filter(
        (rightTransaction) =>
          !matchedRightIds.has(rightTransaction.id) && !duplicateRightIds.has(rightTransaction.id),
      );
      const matchingCandidates = findMatchingCandidatesForTier(leftTransaction, candidates, tier);

      if (matchingCandidates.length === 0) {
        continue;
      }

      const [match, ...duplicateMatches] = matchingCandidates;
      matchedLeftIds.add(leftTransaction.id);
      matchedRightIds.add(match.transaction.id);
      matchGroups.push({
        match_reason: match.match_reason,
        confidence_score: match.confidence_score,
        transactions: [toSummary(leftTransaction), toSummary(match.transaction)],
      });

      for (const duplicateMatch of duplicateMatches.filter((candidate) => candidate.duplicate_eligible)) {
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
  }

  for (const leftTransaction of leftTransactions) {
    if (matchedLeftIds.has(leftTransaction.id)) {
      continue;
    }

    exceptions.push(
      buildException(
        `missing_in_${rightSourceType}`,
        leftTransaction,
        `${leftSourceType} transaction has no matching ${rightSourceType} transaction.`,
      ),
    );
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

  const categorizedExceptions = categorizeEngineExceptions(
    exceptions,
    leftTransactions,
    rightTransactions,
  );
  const result = {
    matched_count: matchGroups.length,
    exception_count: categorizedExceptions.length,
    duplicate_count: duplicateRightIds.size,
    match_groups: matchGroups,
    exceptions: categorizedExceptions,
    vin_presence_diagnostics: buildVinPresenceDiagnostics(
      leftTransactions,
      rightTransactions,
      matchGroups,
      categorizedExceptions,
      leftSourceType,
      rightSourceType,
    ),
  };
  assertReconciliationInvariants([...leftTransactions, ...rightTransactions], result);
  return result;
}

function findMatchingCandidatesForTier(
  leftTransaction: Transaction,
  rightTransactions: Transaction[],
  tier: MatchTier,
): CandidateMatch[] {
  return rightTransactions
    .filter((rightTransaction) => tier.matcher(leftTransaction, rightTransaction))
    .map((rightTransaction) => ({
      transaction: rightTransaction,
      match_reason: tier.reason,
      confidence_score: tier.confidence,
      duplicate_eligible: tier.duplicateEligible,
    }));
}

function isExplicitVinAmountMatch(
  leftTransaction: Transaction,
  rightTransaction: Transaction,
): boolean {
  return Boolean(
    leftTransaction.vin &&
      rightTransaction.vin &&
      clean(leftTransaction.vin) === clean(rightTransaction.vin) &&
      amountsMatch(leftTransaction.amount_cents, rightTransaction.amount_cents),
  );
}

function isDerivedVinAmountMatch(
  leftTransaction: Transaction,
  rightTransaction: Transaction,
): boolean {
  const leftVin = matchingVin(leftTransaction);
  const rightVin = matchingVin(rightTransaction);
  return Boolean(
    leftVin &&
      rightVin &&
      leftVin === rightVin &&
      amountsMatch(leftTransaction.amount_cents, rightTransaction.amount_cents),
  );
}

function isStockAmountMatch(leftTransaction: Transaction, rightTransaction: Transaction): boolean {
  const leftVin = matchingVin(leftTransaction);
  const rightVin = matchingVin(rightTransaction);
  if (leftVin && rightVin && leftVin !== rightVin) {
    return false;
  }

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

  if (!datesWithinTolerance(leftTransaction, rightTransaction, 45)) {
    return false;
  }

  const leftContext = context(leftTransaction);
  const rightContext = context(rightTransaction);
  return [...leftContext].filter((token) => rightContext.has(token)).length >= 2;
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

function matchingVin(transaction: Transaction): string {
  return clean(transaction.vin) || extractVin(transaction.description);
}

function extractVin(value: string | null): string {
  if (!value) {
    return "";
  }
  return value.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/)?.[0] ?? "";
}

function datesWithinTolerance(
  leftTransaction: Transaction,
  rightTransaction: Transaction,
  toleranceDays: number,
): boolean {
  const leftDate = effectiveDate(leftTransaction);
  const rightDate = effectiveDate(rightTransaction);
  if (!leftDate || !rightDate) {
    return true;
  }
  return Math.abs(Date.parse(leftDate) - Date.parse(rightDate)) <= toleranceDays * 86_400_000;
}

function effectiveDate(transaction: Transaction): string | null {
  return transaction.transaction_date ?? transaction.post_date;
}

function clean(value: string | null): string {
  if (!value) {
    return "";
  }
  return value.toUpperCase().replace(/\//g, " ").replace(/-/g, " ").split(/\s+/).join(" ");
}

function buildVinPresenceDiagnostics(
  leftTransactions: Transaction[],
  rightTransactions: Transaction[],
  matchGroups: MatchGroup[],
  exceptions: ReconciliationException[],
  leftSourceType: SourceType,
  rightSourceType: SourceType,
): VinPresenceDiagnostics {
  const leftVinMap = buildVinMap(leftTransactions);
  const rightVinMap = buildVinMap(rightTransactions);
  const leftVins = new Set(leftVinMap.keys());
  const rightVins = new Set(rightVinMap.keys());
  const matchedByVin = buildMatchedByVin(matchGroups);
  const exceptionIds = new Set(exceptions.map((exception) => exception.transaction.id));
  const matchedLeftIds = new Set<number>();
  const matchedRightIds = new Set<number>();

  for (const group of matchGroups) {
    for (const transaction of group.transactions) {
      if (transaction.source_type === leftSourceType) {
        matchedLeftIds.add(transaction.id);
      }
      if (transaction.source_type === rightSourceType) {
        matchedRightIds.add(transaction.id);
      }
    }
  }

  const sharedVins = [...leftVins].filter((vin) => rightVins.has(vin)).sort();
  const transactionUnmatchedSharedVins = sharedVins
    .filter((vin) => !matchedByVin.has(vin) || hasUnmatchedTransactionForVin(vin, leftVinMap, rightVinMap, exceptionIds))
    .map((vin) => {
      const leftRows = leftVinMap.get(vin) ?? [];
      const rightRows = rightVinMap.get(vin) ?? [];
      const unmatchedLeftRows = leftRows.filter((transaction) => !matchedLeftIds.has(transaction.id));
      const unmatchedRightRows = rightRows.filter((transaction) => !matchedRightIds.has(transaction.id));

      return {
        vin,
        likely_reason: classifySharedVinUnmatchedReason(
          vin,
          leftRows,
          rightRows,
          unmatchedLeftRows,
          unmatchedRightRows,
          matchGroups,
          exceptions,
        ),
        boa_transaction_ids: leftRows.map((transaction) => transaction.id),
        dealertrack_transaction_ids: rightRows.map((transaction) => transaction.id),
        unmatched_boa_transaction_ids: unmatchedLeftRows.map((transaction) => transaction.id),
        unmatched_dealertrack_transaction_ids: unmatchedRightRows.map((transaction) => transaction.id),
      };
    });

  return {
    extracted_vin_sets: {
      boa: summarizeVinMap(leftVinMap),
      dealertrack: summarizeVinMap(rightVinMap),
    },
    vin_presence_exceptions: {
      dealertrack_not_in_boa: [...rightVins].filter((vin) => !leftVins.has(vin)).sort(),
      boa_not_in_dealertrack: [...leftVins].filter((vin) => !rightVins.has(vin)).sort(),
    },
    transaction_unmatched_shared_vins: transactionUnmatchedSharedVins,
  };
}

function buildVinMap(transactions: Transaction[]): Map<string, Transaction[]> {
  const byVin = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const vin = matchingVin(transaction);
    if (!vin) {
      continue;
    }
    byVin.set(vin, [...(byVin.get(vin) ?? []), transaction]);
  }
  return byVin;
}

function summarizeVinMap(vinMap: Map<string, Transaction[]>): VinPresenceDiagnostics["extracted_vin_sets"]["boa"] {
  return [...vinMap.entries()]
    .map(([vin, transactions]) => ({
      vin,
      stored_vin_count: transactions.filter((transaction) => clean(transaction.vin) === vin).length,
      extracted_vin_count: transactions.length,
      transaction_ids: transactions.map((transaction) => transaction.id),
    }))
    .sort((left, right) => left.vin.localeCompare(right.vin));
}

function buildMatchedByVin(matchGroups: MatchGroup[]): Set<string> {
  const matched = new Set<string>();
  for (const group of matchGroups) {
    const vins = group.transactions
      .map((transaction) => clean(transaction.vin) || extractVin(transaction.description))
      .filter(Boolean);
    if (vins.length >= 2 && vins.every((vin) => vin === vins[0])) {
      matched.add(vins[0]);
    }
  }
  return matched;
}

function hasUnmatchedTransactionForVin(
  vin: string,
  leftVinMap: Map<string, Transaction[]>,
  rightVinMap: Map<string, Transaction[]>,
  exceptionIds: Set<number>,
): boolean {
  return [...(leftVinMap.get(vin) ?? []), ...(rightVinMap.get(vin) ?? [])].some((transaction) =>
    exceptionIds.has(transaction.id),
  );
}

function classifySharedVinUnmatchedReason(
  vin: string,
  leftRows: Transaction[],
  rightRows: Transaction[],
  unmatchedLeftRows: Transaction[],
  unmatchedRightRows: Transaction[],
  matchGroups: MatchGroup[],
  exceptions: ReconciliationException[],
): VinPresenceDiagnosticReason {
  if (leftRows.length === 0 || rightRows.length === 0) {
    return "row_filtered_before_matching";
  }
  if (leftRows.some((transaction) => !matchingVin(transaction)) || rightRows.some((transaction) => !matchingVin(transaction))) {
    return "missing_parsed_vin";
  }

  const hasAbsoluteAmountCounterpart = leftRows.some((left) =>
    rightRows.some((right) => amountsMatch(left.amount_cents, right.amount_cents)),
  );
  const hasSignedAmountCounterpart = leftRows.some((left) =>
    rightRows.some((right) => left.amount_cents === right.amount_cents),
  );
  if (!hasAbsoluteAmountCounterpart) {
    return hasSignedAmountCounterpart ? "sign_mismatch_or_absolute_amount_issue" : "amount_mismatch";
  }

  if (isConsumedByOtherMatch(vin, [...unmatchedLeftRows, ...unmatchedRightRows], matchGroups)) {
    return "weak_match_consumed_stronger_vin_match";
  }
  if (leftRows.length > 1 || rightRows.length > 1) {
    return "duplicate_or_one_to_many_transaction_structure";
  }
  if (
    leftRows.some((left) =>
      rightRows.some(
        (right) =>
          left.stock_number &&
          right.stock_number &&
          clean(left.stock_number) !== clean(right.stock_number) &&
          amountsMatch(left.amount_cents, right.amount_cents),
      ),
    )
  ) {
    return "stock_number_mismatch";
  }
  if (exceptions.some((exception) => exception.transaction.vin === vin || extractVin(exception.transaction.description) === vin)) {
    return "duplicate_or_one_to_many_transaction_structure";
  }
  return "stock_number_mismatch";
}

function isConsumedByOtherMatch(
  expectedVin: string,
  unmatchedRows: Transaction[],
  matchGroups: MatchGroup[],
): boolean {
  const unmatchedIds = new Set(unmatchedRows.map((transaction) => transaction.id));
  for (const group of matchGroups) {
    const groupVins = group.transactions.map((transaction) => clean(transaction.vin) || extractVin(transaction.description));
    const groupIds = group.transactions.map((transaction) => transaction.id);
    if (groupIds.some((id) => unmatchedIds.has(id))) {
      continue;
    }
    if (groupVins.includes(expectedVin) && groupVins.some((vin) => vin && vin !== expectedVin)) {
      return true;
    }
  }
  return false;
}

function buildException(
  exceptionType: string,
  transaction: Transaction,
  description: string,
): ReconciliationException {
  return {
    exception_type: exceptionType,
    exception_category: "unclassified",
    source_type: transaction.source_type,
    transaction: toSummary(transaction),
    description,
  };
}

function toSummary(transaction: Transaction): TransactionSummary {
  return {
    id: transaction.id,
    dealership_id: transaction.dealership_id,
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
