import type {
  IngestionEvent,
  NewIngestionEvent,
  NewOperationalEvent,
  OperationalMetrics,
  ReconciliationRun,
  SourceFile,
  SourceFileSummary,
  SourceType,
  StoreAutomationStatus,
  ReconciliationResponse,
} from "../domain/types.js";
import type { TransactionRepository } from "../repositories/transactionRepository.js";
import {
  RECONCILIATION_ENGINE_VERSION,
  reconcileTransactionSets,
} from "./reconciliationEngine.js";
import { TRANSACTION_NORMALIZER_VERSION } from "./transactionNormalizer.js";
import { persistReconciliationRunArtifacts } from "./reconciliationArtifacts.js";

const expectedFloorplanSourceTypes: SourceType[] = ["boa", "dealertrack"];
const staleReconciliationMs = 7 * 24 * 60 * 60 * 1000;

export async function recordIngestionEvent(
  repository: TransactionRepository,
  dealershipId: number,
  event: NewIngestionEvent,
): Promise<IngestionEvent> {
  return repository.createIngestionEvent(dealershipId, event);
}

export async function createReconciliationRunFromSourceFiles({
  repository,
  dealershipId,
  boaSourceFile,
  dealertrackSourceFile,
  automated,
  uploadedByUserId = null,
}: {
  repository: TransactionRepository;
  dealershipId: number;
  boaSourceFile: SourceFile;
  dealertrackSourceFile: SourceFile;
  automated: boolean;
  uploadedByUserId?: number | null;
}): Promise<{ run: ReconciliationRun; result: ReconciliationResponse; duration_ms: number }> {
  const startedAt = Date.now();
  const [boaTransactions, dealertrackTransactions] = await Promise.all([
    repository.listBySourceFile(dealershipId, boaSourceFile.id),
    repository.listBySourceFile(dealershipId, dealertrackSourceFile.id),
  ]);
  const result = reconcileTransactionSets(
    boaTransactions,
    dealertrackTransactions,
    "boa",
    "dealertrack",
  );
  const run = await repository.createReconciliationRun({
    dealership_id: dealershipId,
    dealership_store_id: boaSourceFile.dealership_store_id,
    boa_source_file_id: boaSourceFile.id,
    dealertrack_source_file_id: dealertrackSourceFile.id,
    result,
    status: automated ? "completed_auto" : "completed",
    input_snapshot: {
      engine_version: RECONCILIATION_ENGINE_VERSION,
      inputs: [
        {
          side: "boa",
          source_type: "boa",
          source_file_id: boaSourceFile.id,
          parser_version: TRANSACTION_NORMALIZER_VERSION,
          parser_metadata: {
            source_type: "boa",
            source_file_id: boaSourceFile.id,
            normalizer: "normalizeTransactionsFromCsv",
          },
          transactions: boaTransactions,
        },
        {
          side: "dealertrack",
          source_type: "dealertrack",
          source_file_id: dealertrackSourceFile.id,
          parser_version: TRANSACTION_NORMALIZER_VERSION,
          parser_metadata: {
            source_type: "dealertrack",
            source_file_id: dealertrackSourceFile.id,
            normalizer: "normalizeTransactionsFromCsv",
          },
          transactions: dealertrackTransactions,
        },
      ],
    },
  });
  await persistReconciliationRunArtifacts({
    repository,
    dealershipId,
    run,
    boaSourceFile,
    dealertrackSourceFile,
    boaTransactions,
    dealertrackTransactions,
    uploadedByUserId,
  });
  await repository.createIngestionEvent(dealershipId, {
    dealership_store_id: boaSourceFile.dealership_store_id,
    source_file_id: null,
    reconciliation_run_id: run.id,
    source_type: null,
    state: "reconciled",
    message: automated ? "Automated reconciliation completed." : "Manual reconciliation completed.",
    metadata: { automated, duration_ms: Date.now() - startedAt },
  });
  await repository.createOperationalEvent(
    dealershipId,
    reconciliationCompletedEvent(
      boaSourceFile.dealership_store_id,
      run.id,
      result.exception_count,
      Date.now() - startedAt,
      automated,
    ),
  );

  if (result.exception_count >= 10) {
    await repository.createOperationalEvent(dealershipId, {
      dealership_store_id: boaSourceFile.dealership_store_id,
      reconciliation_run_id: run.id,
      event_type: "new_unresolved_exception_spike",
      severity: "warning",
      message: `Reconciliation created ${result.exception_count} unresolved exceptions.`,
      metadata: { exception_count: result.exception_count },
    });
  }
  return { run, result, duration_ms: Date.now() - startedAt };
}

export async function evaluateAutoRunAfterUpload(
  repository: TransactionRepository,
  dealershipId: number,
  sourceFile: SourceFile,
  uploadedByUserId: number | null = null,
): Promise<ReconciliationRun | null> {
  const jobs = await repository.listScheduledReconciliationJobs(
    dealershipId,
    sourceFile.dealership_store_id ?? undefined,
  );
  const autoRunEnabled = jobs.some(
    (job) =>
      job.enabled &&
      job.auto_run_on_pair &&
      job.expected_source_types.includes("boa") &&
      job.expected_source_types.includes("dealertrack"),
  );
  if (!autoRunEnabled) {
    await recordMissingExpectedFiles(repository, dealershipId, sourceFile.dealership_store_id);
    return null;
  }

  const pair = await findLatestSourceFilePair(repository, dealershipId, sourceFile.dealership_store_id);
  if (!pair || pair.boa.source_file_id === pair.dealertrack.source_file_id) {
    await recordMissingExpectedFiles(repository, dealershipId, sourceFile.dealership_store_id);
    return null;
  }

  const existingRuns = await repository.listReconciliationRuns(dealershipId, {
    dealershipStoreId: sourceFile.dealership_store_id ?? undefined,
  });
  if (
    existingRuns.some(
      (run) =>
        run.boa_source_file_id === pair.boa.source_file_id &&
        run.dealertrack_source_file_id === pair.dealertrack.source_file_id,
    )
  ) {
    return null;
  }

  const [boaSourceFile, dealertrackSourceFile] = await Promise.all([
    repository.getSourceFile(pair.boa.source_file_id),
    repository.getSourceFile(pair.dealertrack.source_file_id),
  ]);
  if (!boaSourceFile || !dealertrackSourceFile) {
    return null;
  }
  const { run } = await createReconciliationRunFromSourceFiles({
    repository,
    dealershipId,
    boaSourceFile,
    dealertrackSourceFile,
    automated: true,
    uploadedByUserId,
  });
  for (const job of jobs.filter((job) => job.enabled && job.auto_run_on_pair)) {
    await repository.updateScheduledReconciliationJob(dealershipId, job.id, {
      last_run_at: run.created_at,
      next_run_at: nextRunAt(job.cadence, run.created_at),
    });
  }
  return run;
}

export async function runDueScheduledJobs(
  repository: TransactionRepository,
  dealershipId: number,
  nowIso = new Date().toISOString(),
): Promise<ReconciliationRun[]> {
  const jobs = (await repository.listScheduledReconciliationJobs(dealershipId)).filter(
    (job) => job.enabled && job.next_run_at !== null && job.next_run_at <= nowIso,
  );
  const runs: ReconciliationRun[] = [];
  for (const job of jobs) {
    const pair = await findLatestSourceFilePair(repository, dealershipId, job.dealership_store_id);
    if (!pair) {
      await recordMissingExpectedFiles(repository, dealershipId, job.dealership_store_id);
      await repository.updateScheduledReconciliationJob(dealershipId, job.id, {
        next_run_at: nextRunAt(job.cadence, nowIso),
      });
      continue;
    }
    const [boaSourceFile, dealertrackSourceFile] = await Promise.all([
      repository.getSourceFile(pair.boa.source_file_id),
      repository.getSourceFile(pair.dealertrack.source_file_id),
    ]);
    if (!boaSourceFile || !dealertrackSourceFile) {
      continue;
    }
    try {
      const { run } = await createReconciliationRunFromSourceFiles({
        repository,
        dealershipId,
        boaSourceFile,
        dealertrackSourceFile,
        automated: true,
      });
      runs.push(run);
      await repository.updateScheduledReconciliationJob(dealershipId, job.id, {
        last_run_at: run.created_at,
        next_run_at: nextRunAt(job.cadence, run.created_at),
      });
    } catch (error) {
      await repository.createOperationalEvent(dealershipId, {
        dealership_store_id: job.dealership_store_id,
        reconciliation_run_id: null,
        event_type: "reconciliation_failed",
        severity: "critical",
        message: "Scheduled reconciliation failed.",
        metadata: { job_id: job.id, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
  return runs;
}

export async function buildStoreAutomationStatuses(
  repository: TransactionRepository,
  dealershipId: number,
): Promise<StoreAutomationStatus[]> {
  const [stores, jobs, runs] = await Promise.all([
    repository.listDealershipStores(dealershipId),
    repository.listScheduledReconciliationJobs(dealershipId),
    repository.listReconciliationRuns(dealershipId),
  ]);
  const sourceFiles = await repository.listSourceFiles(dealershipId);
  const now = Date.now();

  return stores.map((store) => {
    const storeSourceFiles = sourceFiles.filter(
      (sourceFile) => sourceFile.dealership_store_id === store.id,
    );
    const storeRuns = runs.filter((run) => run.dealership_store_id === store.id);
    const latestRun = newest(storeRuns.map((run) => run.created_at));
    const missing = expectedFloorplanSourceTypes.filter(
      (sourceType) => !storeSourceFiles.some((sourceFile) => sourceFile.source_type === sourceType),
    );
    const enabledJobs = jobs.filter((job) => job.dealership_store_id === store.id && job.enabled);
    return {
      dealership_store_id: store.id,
      store_name: store.name,
      last_upload_at: newest(storeSourceFiles.map((sourceFile) => sourceFile.created_at)),
      last_reconciliation_at: latestRun,
      missing_expected_source_types: missing,
      stale_reconciliation: latestRun === null || now - Date.parse(latestRun) > staleReconciliationMs,
      enabled_job_count: enabledJobs.length,
      next_run_at: newest(enabledJobs.map((job) => job.next_run_at).filter((value): value is string => value !== null), "asc"),
    };
  });
}

export async function buildOperationalMetrics(
  repository: TransactionRepository,
  dealershipId: number,
): Promise<OperationalMetrics> {
  const [events, ingestionEvents, statuses, runs] = await Promise.all([
    repository.listOperationalEvents(dealershipId, undefined, 500),
    repository.listIngestionEvents(dealershipId, undefined, 500),
    buildStoreAutomationStatuses(repository, dealershipId),
    repository.listReconciliationRuns(dealershipId),
  ]);
  const completionDurations = events
    .filter((event) => event.event_type === "reconciliation_completed")
    .map((event) => event.metadata.duration_ms)
    .filter((value): value is number => typeof value === "number");
  const automatedCount = runs.filter((run) => run.status === "completed_auto").length;
  const manualCount = runs.length - automatedCount;
  const failedBySourceType = new Map<SourceType | null, number>();
  for (const event of ingestionEvents.filter((event) => event.state === "failed")) {
    failedBySourceType.set(event.source_type, (failedBySourceType.get(event.source_type) ?? 0) + 1);
  }

  return {
    average_reconciliation_completion_time_ms:
      completionDurations.length === 0
        ? null
        : Math.round(completionDurations.reduce((sum, value) => sum + value, 0) / completionDurations.length),
    stale_stores: statuses.filter((status) => status.stale_reconciliation),
    upload_failure_trends: [...failedBySourceType.entries()].map(([sourceType, failureCount]) => ({
      source_type: sourceType,
      failure_count: failureCount,
    })),
    auto_vs_manual_reconciliation_rates: {
      automated_count: automatedCount,
      manual_count: manualCount,
      automated_percent:
        runs.length === 0 ? 0 : Math.round((automatedCount / runs.length) * 10000) / 100,
    },
  };
}

export async function generateStaleStoreEvents(
  repository: TransactionRepository,
  dealershipId: number,
): Promise<void> {
  const statuses = await buildStoreAutomationStatuses(repository, dealershipId);
  for (const status of statuses.filter((candidate) => candidate.stale_reconciliation)) {
    await repository.createOperationalEvent(dealershipId, {
      dealership_store_id: status.dealership_store_id,
      reconciliation_run_id: null,
      event_type: "stale_store_activity",
      severity: "warning",
      message: `${status.store_name} has stale reconciliation activity.`,
      metadata: status,
    });
  }
}

async function recordMissingExpectedFiles(
  repository: TransactionRepository,
  dealershipId: number,
  dealershipStoreId: number | null,
): Promise<void> {
  const files = await repository.listSourceFiles(dealershipId, undefined, dealershipStoreId ?? undefined);
  const missing = expectedFloorplanSourceTypes.filter(
    (sourceType) => !files.some((file) => file.source_type === sourceType),
  );
  for (const sourceType of missing) {
    await repository.createOperationalEvent(dealershipId, {
      dealership_store_id: dealershipStoreId,
      reconciliation_run_id: null,
      event_type: "missing_expected_file",
      severity: "warning",
      message: `Missing expected ${sourceType.toUpperCase()} file for reconciliation automation.`,
      metadata: { source_type: sourceType },
    });
  }
}

async function findLatestSourceFilePair(
  repository: TransactionRepository,
  dealershipId: number,
  dealershipStoreId: number | null,
): Promise<{ boa: SourceFileSummary; dealertrack: SourceFileSummary } | null> {
  const files = await repository.listSourceFiles(dealershipId, undefined, dealershipStoreId ?? undefined);
  const boa = files.find((file) => file.source_type === "boa");
  const dealertrack = files.find((file) => file.source_type === "dealertrack");
  return boa && dealertrack ? { boa, dealertrack } : null;
}

function reconciliationCompletedEvent(
  dealershipStoreId: number | null,
  reconciliationRunId: number,
  exceptionCount: number,
  durationMs: number,
  automated: boolean,
): NewOperationalEvent {
  return {
    dealership_store_id: dealershipStoreId,
    reconciliation_run_id: reconciliationRunId,
    event_type: "reconciliation_completed",
    severity: exceptionCount > 0 ? "warning" : "info",
    message: automated ? "Automated reconciliation completed." : "Manual reconciliation completed.",
    metadata: { exception_count: exceptionCount, duration_ms: durationMs, automated },
  };
}

function nextRunAt(cadence: "daily" | "weekly" | "monthly", fromIso: string): string {
  const next = new Date(fromIso);
  if (cadence === "daily") {
    next.setUTCDate(next.getUTCDate() + 1);
  } else if (cadence === "weekly") {
    next.setUTCDate(next.getUTCDate() + 7);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next.toISOString();
}

function newest(values: string[], direction: "asc" | "desc" = "desc"): string | null {
  if (values.length === 0) {
    return null;
  }
  return values.sort((left, right) =>
    direction === "asc"
      ? Date.parse(left) - Date.parse(right)
      : Date.parse(right) - Date.parse(left),
  )[0];
}
