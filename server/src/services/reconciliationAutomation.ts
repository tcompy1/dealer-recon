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
import type { AccountingMonth } from "../domain/accountingMonth.js";
import {
  ROOFTOP_PROFILES,
  type RooftopProfile,
  type RooftopProfileId,
} from "../config/storeWorkflowConfig.js";
import type { TransactionRepository } from "../repositories/transactionRepository.js";
import { rooftopValidationError } from "./rooftopValidation.js";
import {
  RECONCILIATION_ENGINE_VERSION,
  reconcileTransactionSets,
} from "./reconciliationEngine.js";
import {
  persistReconciliationRunArtifacts,
  ReconciliationArtifactPersistenceError,
} from "./reconciliationArtifacts.js";

const expectedFloorplanSourceTypes: SourceType[] = ["boa", "dealertrack"];
const staleReconciliationMs = 7 * 24 * 60 * 60 * 1000;

export async function recordIngestionEvent(
  repository: TransactionRepository,
  dealershipId: number,
  event: NewIngestionEvent,
): Promise<IngestionEvent> {
  return repository.createIngestionEvent(dealershipId, event);
}

function validateReconciliationSourceIdentity({
  dealershipId,
  boaSourceFile,
  dealertrackSourceFile,
  accountingMonth,
  rooftopProfile,
}: CreateReconciliationRunFromSourceFilesInput): void {
  const baseDetails = {
    source: null,
    accounting_month: accountingMonth,
    rooftop_profile_id: rooftopProfile.profileId,
  } as const;
  if (!rooftopProfile.enabled) {
    throw rooftopValidationError(
      "ROOFTOP_PROFILE_UNSUPPORTED",
      "The selected store is not enabled for floorplan reconciliation.",
      {
        ...baseDetails,
        recovery: "Select an enabled rooftop or complete that rooftop's evidence onboarding.",
      },
    );
  }
  if (
    boaSourceFile.dealership_id !== dealershipId ||
    dealertrackSourceFile.dealership_id !== dealershipId
  ) {
    throw rooftopValidationError(
      "DEALERSHIP_MISMATCH",
      "Source files must belong to the reconciliation dealership.",
      {
        ...baseDetails,
        recovery: "Select source files from the current dealership.",
      },
    );
  }
  if (boaSourceFile.source_type !== "boa" || dealertrackSourceFile.source_type !== "dealertrack") {
    throw rooftopValidationError(
      "RECONCILIATION_SOURCE_TYPE_MISMATCH",
      "Source files do not match the required BOA and Dealertrack types.",
      {
        ...baseDetails,
        source: boaSourceFile.source_type !== "boa" ? "boa" : "dealertrack",
        recovery: "Select a BOA upload for boa_source_file_id and a Dealertrack upload for dealertrack_source_file_id.",
      },
    );
  }
  if (
    boaSourceFile.dealership_store_id === null ||
    dealertrackSourceFile.dealership_store_id === null ||
    boaSourceFile.dealership_store_id !== dealertrackSourceFile.dealership_store_id
  ) {
    throw rooftopValidationError(
      "RECONCILIATION_STORE_MISMATCH",
      "BOA and Dealertrack source files must belong to the same store.",
      {
        ...baseDetails,
        recovery: "Select source files that both belong to the selected store.",
      },
    );
  }
  if (
    boaSourceFile.accounting_month !== accountingMonth ||
    dealertrackSourceFile.accounting_month !== accountingMonth
  ) {
    throw rooftopValidationError(
      "RECONCILIATION_SOURCE_IDENTITY_MISMATCH",
      "The selected accounting month does not match both source files.",
      {
        ...baseDetails,
        evidence: {
          boa_accounting_month: boaSourceFile.accounting_month,
          dealertrack_accounting_month: dealertrackSourceFile.accounting_month,
        },
        recovery: "Select source files processed for the selected accounting month.",
      },
    );
  }
  if (
    boaSourceFile.rooftop_profile_id !== rooftopProfile.profileId ||
    dealertrackSourceFile.rooftop_profile_id !== rooftopProfile.profileId ||
    boaSourceFile.rooftop_profile_version !== rooftopProfile.profileVersion ||
    dealertrackSourceFile.rooftop_profile_version !== rooftopProfile.profileVersion
  ) {
    throw rooftopValidationError(
      "RECONCILIATION_SOURCE_IDENTITY_MISMATCH",
      "Source files do not match the selected rooftop profile identity.",
      {
        ...baseDetails,
        evidence: {
          boa_rooftop_profile_id: boaSourceFile.rooftop_profile_id,
          boa_rooftop_profile_version: boaSourceFile.rooftop_profile_version,
          dealertrack_rooftop_profile_id: dealertrackSourceFile.rooftop_profile_id,
          dealertrack_rooftop_profile_version: dealertrackSourceFile.rooftop_profile_version,
        },
        recovery: "Select BOA and Dealertrack source files with the same enabled rooftop profile.",
      },
    );
  }
  if (!hasStoredProcessingProvenance(boaSourceFile) || !hasStoredProcessingProvenance(dealertrackSourceFile)) {
    throw rooftopValidationError(
      "RECONCILIATION_SOURCE_IDENTITY_MISMATCH",
      "Source files are missing the stored parser or preprocessor provenance required for reconciliation.",
      {
        ...baseDetails,
        recovery: "Re-upload both source files with the selected rooftop profile and accounting month.",
      },
    );
  }
}

function hasStoredProcessingProvenance(sourceFile: SourceFile): boolean {
  return sourceFile.parser_name !== null &&
    sourceFile.parser_version !== null &&
    sourceFile.preprocessor_name !== null &&
    sourceFile.preprocessor_version !== null &&
    sourceFile.preprocessing_metadata !== null;
}

function resolvePersistedRooftopProfile(sourceFile: SourceFile): RooftopProfile | null {
  return Object.values(ROOFTOP_PROFILES).find(
    (profile) =>
      profile.enabled &&
      profile.profileId === sourceFile.rooftop_profile_id &&
      profile.profileVersion === sourceFile.rooftop_profile_version,
  ) ?? null;
}

export type CreateReconciliationRunFromSourceFilesInput = {
  repository: TransactionRepository;
  dealershipId: number;
  boaSourceFile: SourceFile;
  dealertrackSourceFile: SourceFile;
  accountingMonth: AccountingMonth;
  rooftopProfile: RooftopProfile;
  automated: boolean;
  uploadedByUserId?: number | null;
};

export async function createReconciliationRunFromSourceFiles(
  input: CreateReconciliationRunFromSourceFilesInput,
): Promise<{ run: ReconciliationRun; result: ReconciliationResponse; duration_ms: number }> {
  const {
    repository,
    dealershipId,
    boaSourceFile,
    dealertrackSourceFile,
    accountingMonth,
    rooftopProfile,
    automated,
    uploadedByUserId = null,
  } = input;
  validateReconciliationSourceIdentity(input);
  const startedAt = Date.now();
  const [boaTransactions, dealertrackTransactions] = await Promise.all([
    repository.listBySourceFile(dealershipId, boaSourceFile.id),
    repository.listBySourceFile(dealershipId, dealertrackSourceFile.id),
  ]);
  const reconciliationResult = reconcileTransactionSets(
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
    accounting_month: accountingMonth,
    rooftop_profile_id: rooftopProfile.profileId,
    rooftop_profile_version: rooftopProfile.profileVersion,
    result: reconciliationResult,
    status: "artifact_pending",
    input_snapshot: {
      engine_version: RECONCILIATION_ENGINE_VERSION,
      inputs: [
        {
          side: "boa",
          source_type: "boa",
          source_file_id: boaSourceFile.id,
          parser_version: boaSourceFile.parser_version!,
          parser_metadata: {
            source_type: "boa",
            source_file_id: boaSourceFile.id,
            parser_name: boaSourceFile.parser_name,
            parser_version: boaSourceFile.parser_version,
            preprocessor_name: boaSourceFile.preprocessor_name,
            preprocessor_version: boaSourceFile.preprocessor_version,
            accounting_month: boaSourceFile.accounting_month,
            rooftop_profile_id: boaSourceFile.rooftop_profile_id,
            rooftop_profile_version: boaSourceFile.rooftop_profile_version,
            preprocessing_metadata: boaSourceFile.preprocessing_metadata,
          },
          transactions: boaTransactions,
        },
        {
          side: "dealertrack",
          source_type: "dealertrack",
          source_file_id: dealertrackSourceFile.id,
          parser_version: dealertrackSourceFile.parser_version!,
          parser_metadata: {
            source_type: "dealertrack",
            source_file_id: dealertrackSourceFile.id,
            parser_name: dealertrackSourceFile.parser_name,
            parser_version: dealertrackSourceFile.parser_version,
            preprocessor_name: dealertrackSourceFile.preprocessor_name,
            preprocessor_version: dealertrackSourceFile.preprocessor_version,
            accounting_month: dealertrackSourceFile.accounting_month,
            rooftop_profile_id: dealertrackSourceFile.rooftop_profile_id,
            rooftop_profile_version: dealertrackSourceFile.rooftop_profile_version,
            preprocessing_metadata: dealertrackSourceFile.preprocessing_metadata,
          },
          transactions: dealertrackTransactions,
        },
      ],
    },
  });
  const result: ReconciliationResponse = {
    ...reconciliationResult,
    reconciliation_run_id: run.id,
    accounting_month: accountingMonth,
    rooftop_profile_id: rooftopProfile.profileId,
    rooftop_profile_version: rooftopProfile.profileVersion,
  };
  let completedRun: ReconciliationRun;
  try {
    await persistReconciliationRunArtifacts({
      repository,
      dealershipId,
      run,
      rooftopProfile,
      boaSourceFile,
      dealertrackSourceFile,
      boaTransactions,
      dealertrackTransactions,
      uploadedByUserId,
    });
    const persistedCompletedRun = await repository.updateReconciliationRunStatus(
      dealershipId,
      run.id,
      automated ? "completed_auto" : "completed",
    );
    if (!persistedCompletedRun) {
      throw new ReconciliationArtifactPersistenceError(
        `Reconciliation run ${run.id} completed status transition was not persisted.`,
      );
    }
    completedRun = persistedCompletedRun;
  } catch (error) {
    await repository.updateReconciliationRunStatus(dealershipId, run.id, "artifact_failed");
    throw error;
  }
  await repository.createIngestionEvent(dealershipId, {
    dealership_store_id: boaSourceFile.dealership_store_id,
    source_file_id: null,
    reconciliation_run_id: completedRun.id,
    source_type: null,
    state: "reconciled",
    message: automated ? "Automated reconciliation completed." : "Manual reconciliation completed.",
    metadata: { automated, duration_ms: Date.now() - startedAt },
  });
  await repository.createOperationalEvent(
    dealershipId,
    reconciliationCompletedEvent(
      boaSourceFile.dealership_store_id,
      completedRun.id,
      reconciliationResult.exception_count,
      Date.now() - startedAt,
      automated,
    ),
  );

  if (reconciliationResult.exception_count >= 10) {
    await repository.createOperationalEvent(dealershipId, {
      dealership_store_id: boaSourceFile.dealership_store_id,
      reconciliation_run_id: completedRun.id,
      event_type: "new_unresolved_exception_spike",
      severity: "warning",
      message: `Reconciliation created ${reconciliationResult.exception_count} unresolved exceptions.`,
      metadata: { exception_count: reconciliationResult.exception_count },
    });
  }
  return { run: completedRun, result, duration_ms: Date.now() - startedAt };
}

export async function evaluateAutoRunAfterUpload(
  repository: TransactionRepository,
  dealershipId: number,
  sourceFile: SourceFile,
  uploadedByUserId: number | null = null,
): Promise<ReconciliationRun | null> {
  const processingIdentity = sourceFile.accounting_month !== null &&
    sourceFile.rooftop_profile_id !== null &&
    sourceFile.rooftop_profile_version !== null
    ? {
        accountingMonth: sourceFile.accounting_month,
        rooftopProfileId: sourceFile.rooftop_profile_id,
        rooftopProfileVersion: sourceFile.rooftop_profile_version,
      }
    : null;
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
    await recordMissingExpectedFiles(
      repository,
      dealershipId,
      sourceFile.dealership_store_id,
      processingIdentity,
    );
    return null;
  }

  if (
    sourceFile.accounting_month === null ||
    sourceFile.rooftop_profile_id === null ||
    sourceFile.rooftop_profile_version === null
  ) {
    await recordMissingExpectedFiles(repository, dealershipId, sourceFile.dealership_store_id);
    return null;
  }
  const pair = await findLatestSourceFilePair(
    repository,
    dealershipId,
    sourceFile.dealership_store_id,
    sourceFile.accounting_month,
    sourceFile.rooftop_profile_id,
    sourceFile.rooftop_profile_version,
  );
  if (!pair || pair.boa.source_file_id === pair.dealertrack.source_file_id) {
    await recordMissingExpectedFiles(
      repository,
      dealershipId,
      sourceFile.dealership_store_id,
      processingIdentity,
    );
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
  const rooftopProfile = resolvePersistedRooftopProfile(sourceFile);
  if (!rooftopProfile) {
    return null;
  }
  const { run } = await createReconciliationRunFromSourceFiles({
    repository,
    dealershipId,
    boaSourceFile,
    dealertrackSourceFile,
    accountingMonth: sourceFile.accounting_month,
    rooftopProfile,
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
    const pair = await findLatestProfiledSourceFilePair(
      repository,
      dealershipId,
      job.dealership_store_id,
    );
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
      const rooftopProfile = resolvePersistedRooftopProfile(boaSourceFile);
      if (!rooftopProfile) {
        continue;
      }
      const { run } = await createReconciliationRunFromSourceFiles({
        repository,
        dealershipId,
        boaSourceFile,
        dealertrackSourceFile,
        accountingMonth: boaSourceFile.accounting_month!,
        rooftopProfile,
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
  processingIdentity: {
    accountingMonth: AccountingMonth;
    rooftopProfileId: RooftopProfileId;
    rooftopProfileVersion: string;
  } | null = null,
): Promise<void> {
  const files = await repository.listSourceFiles(dealershipId, undefined, dealershipStoreId ?? undefined);
  const missing = expectedFloorplanSourceTypes.filter((sourceType) =>
    !files.some(
      (file) =>
        file.source_type === sourceType &&
        (processingIdentity === null ||
          (file.dealership_store_id === dealershipStoreId &&
            file.accounting_month === processingIdentity.accountingMonth &&
            file.rooftop_profile_id === processingIdentity.rooftopProfileId &&
            file.rooftop_profile_version === processingIdentity.rooftopProfileVersion)),
    ),
  );
  for (const sourceType of missing) {
    const available = files.find((file) => file.source_type === sourceType);
    const identityMetadata = processingIdentity === null
      ? {}
      : {
          reason: available ? "identity_mismatch" : "not_uploaded",
          expected_accounting_month: processingIdentity.accountingMonth,
          expected_rooftop_profile_id: processingIdentity.rooftopProfileId,
          expected_rooftop_profile_version: processingIdentity.rooftopProfileVersion,
          ...(available
            ? {
                available_accounting_month: available.accounting_month,
                available_rooftop_profile_id: available.rooftop_profile_id,
                available_rooftop_profile_version: available.rooftop_profile_version,
              }
            : {}),
        };
    await repository.createOperationalEvent(dealershipId, {
      dealership_store_id: dealershipStoreId,
      reconciliation_run_id: null,
      event_type: "missing_expected_file",
      severity: "warning",
      message: processingIdentity
        ? `No ${sourceType.toUpperCase()} file matches the uploaded source processing identity.`
        : `Missing expected ${sourceType.toUpperCase()} file for reconciliation automation.`,
      metadata: { source_type: sourceType, ...identityMetadata },
    });
  }
}

export async function findLatestSourceFilePair(
  repository: TransactionRepository,
  dealershipId: number,
  dealershipStoreId: number | null,
  accountingMonth: AccountingMonth,
  rooftopProfileId: RooftopProfileId,
  rooftopProfileVersion: string,
): Promise<{ boa: SourceFileSummary; dealertrack: SourceFileSummary } | null> {
  const files = await repository.listSourceFiles(dealershipId, undefined, dealershipStoreId ?? undefined);
  const matchesIdentity = (file: SourceFileSummary) =>
    file.dealership_store_id === dealershipStoreId &&
    file.accounting_month === accountingMonth &&
    file.rooftop_profile_id === rooftopProfileId &&
    file.rooftop_profile_version === rooftopProfileVersion;
  const boa = files.find((file) => file.source_type === "boa" && matchesIdentity(file));
  const dealertrack = files.find(
    (file) => file.source_type === "dealertrack" && matchesIdentity(file),
  );
  return boa && dealertrack ? { boa, dealertrack } : null;
}

async function findLatestProfiledSourceFilePair(
  repository: TransactionRepository,
  dealershipId: number,
  dealershipStoreId: number | null,
): Promise<{ boa: SourceFileSummary; dealertrack: SourceFileSummary } | null> {
  const files = await repository.listSourceFiles(
    dealershipId,
    undefined,
    dealershipStoreId ?? undefined,
  );
  const identities = new Set<string>();
  for (const file of files) {
    if (
      file.dealership_store_id !== dealershipStoreId ||
      file.accounting_month === null ||
      file.rooftop_profile_id === null ||
      file.rooftop_profile_version === null
    ) {
      continue;
    }
    const identityKey = [
      file.accounting_month,
      file.rooftop_profile_id,
      file.rooftop_profile_version,
    ].join("\u0000");
    if (identities.has(identityKey)) {
      continue;
    }
    identities.add(identityKey);
    const pair = await findLatestSourceFilePair(
      repository,
      dealershipId,
      dealershipStoreId,
      file.accounting_month,
      file.rooftop_profile_id,
      file.rooftop_profile_version,
    );
    if (pair) {
      return pair;
    }
  }
  return null;
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
