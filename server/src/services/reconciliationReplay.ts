import type {
  ReconciliationReplayResponse,
  ReconciliationResponse,
  ReconciliationRunDetail,
  ReconciliationRunInputSnapshot,
  TransactionSummary,
} from "../domain/types.js";
import type { TransactionRepository } from "../repositories/transactionRepository.js";
import {
  RECONCILIATION_ENGINE_VERSION,
  reconcileTransactionSets,
} from "./reconciliationEngine.js";
import { TRANSACTION_NORMALIZER_VERSION } from "./transactionNormalizer.js";

export async function buildReconciliationReplay(
  repository: TransactionRepository,
  dealershipId: number,
  reconciliationRunId: number,
): Promise<ReconciliationReplayResponse | null> {
  const [detail, snapshot] = await Promise.all([
    repository.getReconciliationRunDetail(dealershipId, reconciliationRunId),
    repository.getReconciliationRunSnapshot(dealershipId, reconciliationRunId),
  ]);
  if (!detail || !snapshot) {
    return null;
  }

  return replaySnapshot(detail, snapshot);
}

export function replaySnapshot(
  detail: ReconciliationRunDetail,
  snapshot: ReconciliationRunInputSnapshot,
): ReconciliationReplayResponse {
  const boaInput = snapshot.inputs.find((input) => input.side === "boa");
  const dealertrackInput = snapshot.inputs.find((input) => input.side === "dealertrack");
  if (!boaInput || !dealertrackInput) {
    throw new Error("Reconciliation snapshot is missing BOA or Dealertrack inputs.");
  }

  const replayed = reconcileTransactionSets(
    boaInput.transactions,
    dealertrackInput.transactions,
    "boa",
    "dealertrack",
  );
  const originalExceptionKeys = new Set(
    detail.exceptions.map((exception) => exceptionKey(exception.transaction)),
  );
  const replayExceptionKeys = new Set(
    replayed.exceptions.map((exception) => exceptionKey(exception.transaction)),
  );
  const newlyMatched = [...originalExceptionKeys]
    .filter((key) => !replayExceptionKeys.has(key))
    .sort();
  const newlyUnmatched = [...replayExceptionKeys]
    .filter((key) => !originalExceptionKeys.has(key))
    .sort();
  const matchedCountDelta = replayed.matched_count - detail.matched_count;
  const exceptionCountDelta = replayed.exception_count - detail.exception_count;

  return {
    reconciliation_run_id: detail.reconciliation_run_id,
    results_changed:
      matchedCountDelta !== 0 ||
      exceptionCountDelta !== 0 ||
      newlyMatched.length > 0 ||
      newlyUnmatched.length > 0,
    original: {
      matched_count: detail.matched_count,
      exception_count: detail.exception_count,
    },
    replayed: {
      matched_count: replayed.matched_count,
      exception_count: replayed.exception_count,
    },
    matched_count_delta: matchedCountDelta,
    exception_count_delta: exceptionCountDelta,
    newly_matched: newlyMatched,
    newly_unmatched: newlyUnmatched,
    engine_version_difference: {
      original: snapshot.engine_version,
      current: RECONCILIATION_ENGINE_VERSION,
      differs: snapshot.engine_version !== RECONCILIATION_ENGINE_VERSION,
    },
    parser_version_difference: snapshot.inputs.map((input) => ({
      side: input.side,
      original: input.parser_version,
      current: TRANSACTION_NORMALIZER_VERSION,
      differs: input.parser_version !== TRANSACTION_NORMALIZER_VERSION,
    })),
  };
}

function exceptionKey(transaction: TransactionSummary): string {
  return [
    transaction.source_type,
    transaction.id,
    normalizeKeyPart(transaction.vin),
    normalizeKeyPart(transaction.reference_number),
    normalizeKeyPart(transaction.stock_number),
    transaction.amount_cents,
  ].join("|");
}

function normalizeKeyPart(value: string | null): string {
  return value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
}
