import type {
  ReconciliationExceptionCategory,
  ReconciliationRunComparison,
  ReconciliationRunDetail,
  ReconciliationRunMetrics,
} from "../domain/types.js";
import type { TransactionRepository } from "../repositories/transactionRepository.js";

type DetailException = ReconciliationRunDetail["exceptions"][number];

export async function buildReconciliationRunComparison(
  repository: TransactionRepository,
  dealershipId: number,
  reconciliationRunId: number,
): Promise<ReconciliationRunComparison | null> {
  const current = await repository.getReconciliationRunDetail(dealershipId, reconciliationRunId);
  if (!current) {
    return null;
  }

  const previous = await findPreviousRun(repository, dealershipId, current);
  return compareReconciliationRuns(current, previous);
}

export function compareReconciliationRuns(
  current: ReconciliationRunDetail,
  previous: ReconciliationRunDetail | null,
): ReconciliationRunComparison {
  const currentKeys = toExceptionKeyMap(current.exceptions);
  const previousKeys = toExceptionKeyMap(previous?.exceptions ?? []);
  const newlyCreated = current.exceptions.filter((exception) => !previousKeys.has(exceptionKey(exception)));
  const recurring = current.exceptions.filter((exception) => previousKeys.has(exceptionKey(exception)));
  const newlyResolved = (previous?.exceptions ?? []).filter(
    (exception) => !currentKeys.has(exceptionKey(exception)),
  );
  const currentMetrics = buildRunMetrics(current);
  const previousMetrics = previous ? buildRunMetrics(previous) : null;

  return {
    current_run_id: current.reconciliation_run_id,
    previous_run_id: previous?.reconciliation_run_id ?? null,
    newly_resolved_exception_ids: newlyResolved.map((exception) => exception.exception_id),
    newly_created_exception_ids: newlyCreated.map((exception) => exception.exception_id),
    recurring_exception_ids: recurring.map((exception) => exception.exception_id),
    category_delta_summary: buildCategoryDelta(current.exceptions, previous?.exceptions ?? []),
    reviewer_workload_trends: buildReviewerWorkloadDelta(current.exceptions, previous?.exceptions ?? []),
    run_comparison_summary: {
      current: currentMetrics,
      previous: previousMetrics,
      matched_count_delta: previous ? current.matched_count - previous.matched_count : null,
      unresolved_count_delta: previous
        ? currentMetrics.unresolved_count - previousMetrics!.unresolved_count
        : null,
      match_rate_delta_percent: previous
        ? roundPercent(currentMetrics.match_rate_percent - previousMetrics!.match_rate_percent)
        : null,
      newly_resolved_count: newlyResolved.length,
      newly_created_count: newlyCreated.length,
      recurring_count: recurring.length,
    },
  };
}

export function buildRunMetrics(run: ReconciliationRunDetail): ReconciliationRunMetrics {
  const resolvedDurations = run.exceptions
    .map((exception) => timeToResolutionHours(exception))
    .filter((duration): duration is number => duration !== null);
  const totalCompared = run.matched_count + run.exception_count;

  return {
    total_matched_transactions: run.matched_count,
    total_exception_count: run.exception_count,
    unresolved_count: run.exceptions.filter((exception) => isOperationallyOpen(exception)).length,
    match_rate_percent: totalCompared > 0 ? roundPercent((run.matched_count / totalCompared) * 100) : 100,
    category_distribution: countCategories(run.exceptions),
    average_time_to_resolution_hours:
      resolvedDurations.length > 0
        ? roundHours(resolvedDurations.reduce((sum, duration) => sum + duration, 0) / resolvedDurations.length)
        : null,
  };
}

async function findPreviousRun(
  repository: TransactionRepository,
  dealershipId: number,
  current: ReconciliationRunDetail,
): Promise<ReconciliationRunDetail | null> {
  const runs = await repository.listReconciliationRuns(dealershipId);
  const previousRun = runs
    .filter(
      (run) =>
        run.reconciliation_run_id !== current.reconciliation_run_id &&
        (run.created_at < current.created_at ||
          (run.created_at === current.created_at && run.reconciliation_run_id < current.reconciliation_run_id)),
    )
    .sort((left, right) => {
      const dateCompare = right.created_at.localeCompare(left.created_at);
      return dateCompare || right.reconciliation_run_id - left.reconciliation_run_id;
    })[0];

  if (!previousRun) {
    return null;
  }
  return repository.getReconciliationRunDetail(dealershipId, previousRun.reconciliation_run_id);
}

function buildCategoryDelta(
  currentExceptions: DetailException[],
  previousExceptions: DetailException[],
): ReconciliationRunComparison["category_delta_summary"] {
  const currentCounts = countCategories(currentExceptions);
  const previousCounts = countCategories(previousExceptions);
  const categories = new Set<ReconciliationExceptionCategory>([
    ...(Object.keys(currentCounts) as ReconciliationExceptionCategory[]),
    ...(Object.keys(previousCounts) as ReconciliationExceptionCategory[]),
  ]);

  return [...categories]
    .map((exception_category) => {
      const current_count = currentCounts[exception_category] ?? 0;
      const previous_count = previousCounts[exception_category] ?? 0;
      return {
        exception_category,
        current_count,
        previous_count,
        delta: current_count - previous_count,
      };
    })
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.exception_category.localeCompare(right.exception_category));
}

function buildReviewerWorkloadDelta(
  currentExceptions: DetailException[],
  previousExceptions: DetailException[],
): ReconciliationRunComparison["reviewer_workload_trends"] {
  const currentCounts = countAssignedReviewers(currentExceptions);
  const previousCounts = countAssignedReviewers(previousExceptions);
  const reviewers = new Set([...Object.keys(currentCounts), ...Object.keys(previousCounts)]);

  return [...reviewers]
    .map((reviewer) => {
      const current_count = currentCounts[reviewer] ?? 0;
      const previous_count = previousCounts[reviewer] ?? 0;
      return {
        reviewer,
        current_count,
        previous_count,
        delta: current_count - previous_count,
      };
    })
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.reviewer.localeCompare(right.reviewer));
}

function toExceptionKeyMap(exceptions: DetailException[]): Map<string, DetailException[]> {
  const map = new Map<string, DetailException[]>();
  for (const exception of exceptions) {
    const key = exceptionKey(exception);
    map.set(key, [...(map.get(key) ?? []), exception]);
  }
  return map;
}

function exceptionKey(exception: DetailException): string {
  const normalizedVin = normalizeKeyPart(exception.transaction.vin);
  if (normalizedVin) {
    return `vin:${normalizedVin}|category:${exception.exception_category}`;
  }

  const normalizedReference = normalizeKeyPart(exception.transaction.reference_number);
  if (normalizedReference) {
    return `reference:${normalizedReference}|category:${exception.exception_category}`;
  }

  const normalizedStock = normalizeKeyPart(exception.transaction.stock_number);
  if (normalizedStock) {
    return `stock:${normalizedStock}|category:${exception.exception_category}`;
  }

  return `exception:${exception.exception_id}`;
}

function countCategories(
  exceptions: DetailException[],
): Partial<Record<ReconciliationExceptionCategory, number>> {
  const counts: Partial<Record<ReconciliationExceptionCategory, number>> = {};
  for (const exception of exceptions) {
    counts[exception.exception_category] = (counts[exception.exception_category] ?? 0) + 1;
  }
  return counts;
}

function countAssignedReviewers(exceptions: DetailException[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const exception of exceptions) {
    const reviewer = exception.assigned_to?.trim();
    if (!reviewer) {
      continue;
    }
    counts[reviewer] = (counts[reviewer] ?? 0) + 1;
  }
  return counts;
}

function isOperationallyOpen(exception: DetailException): boolean {
  return exception.review_status !== "resolved" && exception.review_status !== "ignored";
}

function timeToResolutionHours(exception: DetailException): number | null {
  if (exception.review_status !== "resolved" || !exception.reviewed_at) {
    return null;
  }
  const createdAt = Date.parse(exception.created_at);
  const reviewedAt = Date.parse(exception.reviewed_at);
  if (!Number.isFinite(createdAt) || !Number.isFinite(reviewedAt) || reviewedAt < createdAt) {
    return null;
  }
  return (reviewedAt - createdAt) / 3_600_000;
}

function normalizeKeyPart(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  return normalized ? normalized : null;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}
