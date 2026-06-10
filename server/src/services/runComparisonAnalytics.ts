import type {
  DealerGroupAnalytics,
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

export async function buildDealerGroupAnalytics(
  repository: TransactionRepository,
  dealershipId: number,
): Promise<DealerGroupAnalytics[]> {
  const [groups, stores] = await Promise.all([
    repository.listDealerGroups(dealershipId),
    repository.listDealershipStores(dealershipId),
  ]);
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const grouped = new Map<number | null, DealerGroupAnalytics>();

  for (const store of stores) {
    const runs = await repository.listReconciliationRuns(dealershipId, {
      dealershipStoreId: store.id,
    });
    const details = (
      await Promise.all(
        runs.map((run) => repository.getReconciliationRunDetail(dealershipId, run.reconciliation_run_id)),
      )
    ).filter((detail): detail is ReconciliationRunDetail => detail !== null);
    const storeAnalytics = buildStoreAnalytics(store.id, store.name, details);
    const groupId = store.dealer_group_id;
    const group = grouped.get(groupId) ?? {
      dealer_group_id: groupId,
      dealer_group_name: groupNames.get(groupId ?? -1) ?? "Ungrouped stores",
      stores: [],
    };
    group.stores.push(storeAnalytics);
    grouped.set(groupId, group);
  }

  return [...grouped.values()].sort((left, right) =>
    left.dealer_group_name.localeCompare(right.dealer_group_name),
  );
}

export function compareReconciliationRuns(
  current: ReconciliationRunDetail,
  previous: ReconciliationRunDetail | null,
): ReconciliationRunComparison {
  const previousKeys = toExceptionKeyMap(previous?.exceptions ?? []);
  const newlyCreated = current.exceptions.filter((exception) => !previousKeys.has(exceptionKey(exception)));
  const recurring = current.exceptions.filter((exception) => previousKeys.has(exceptionKey(exception)));
  const currentMetrics = buildRunMetrics(current);

  return {
    current_run_id: current.reconciliation_run_id,
    previous_run_id: previous?.reconciliation_run_id ?? null,
    newly_created_exception_ids: newlyCreated.map((exception) => exception.exception_id),
    recurring_exception_ids: recurring.map((exception) => exception.exception_id),
    category_summary: buildCategorySummary(current.exceptions),
    run_comparison_summary: {
      current: currentMetrics,
      newly_created_count: newlyCreated.length,
      recurring_count: recurring.length,
    },
  };
}

export function buildRunMetrics(run: ReconciliationRunDetail): ReconciliationRunMetrics {
  return {
    total_matched_transactions: run.matched_count,
    total_exception_count: run.exception_count,
    unresolved_count: run.exceptions.filter((exception) => isOperationallyOpen(exception)).length,
    category_distribution: countCategories(run.exceptions),
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

function buildCategorySummary(currentExceptions: DetailException[]): ReconciliationRunComparison["category_summary"] {
  const currentCounts = countCategories(currentExceptions);
  const categories = Object.keys(currentCounts) as ReconciliationExceptionCategory[];

  return categories
    .map((exception_category) => {
      const current_count = currentCounts[exception_category] ?? 0;
      return {
        exception_category,
        current_count,
      };
    })
    .sort((left, right) => right.current_count - left.current_count || left.exception_category.localeCompare(right.exception_category));
}

function buildStoreAnalytics(
  storeId: number | null,
  storeName: string,
  details: ReconciliationRunDetail[],
): DealerGroupAnalytics["stores"][number] {
  const latest = details[0] ?? null;
  const recurringExceptionCount = details.length > 0
    ? compareReconciliationRuns(details[0], details[1] ?? null).run_comparison_summary.recurring_count
    : 0;
  const latestMetrics = latest ? buildRunMetrics(latest) : null;

  return {
    dealership_store_id: storeId,
    store_name: storeName,
    run_count: details.length,
    unresolved_count: latestMetrics?.unresolved_count ?? 0,
    recurring_exception_count: recurringExceptionCount,
  };
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

function isOperationallyOpen(exception: DetailException): boolean {
  return exception.review_status !== "resolved" && exception.review_status !== "ignored";
}

function normalizeKeyPart(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  return normalized ? normalized : null;
}
