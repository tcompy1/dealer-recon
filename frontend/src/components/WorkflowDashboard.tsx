import { type ChangeEvent, useEffect, useMemo, useState } from "react";

import {
  createScheduledJob,
  getAutomationStatus,
  getOperationalMetrics,
  listIngestionEvents,
  listOperationalEvents,
  listScheduledJobs,
  updateScheduledJob,
} from "../api/automation";
import {
  getHurstFpRecExportUrl,
  getReconciliationExceptionsCsvUrl,
  getReconciliationRun,
  getReconciliationRunAnalytics,
  listReconciliationRuns,
  reconcileSourceFiles,
  replayReconciliationRun,
  updateReconciliationExceptionReview,
} from "../api/reconciliation";
import {
  createDealershipStore,
  getDealerGroupAnalytics,
  listDealerGroups,
  listDealershipStores,
} from "../api/stores";
import { UploadError, listSourceFiles, uploadSourceFile } from "../api/uploads";
import { PreprocessingDiagnosticsPanel } from "./preprocessing/PreprocessingDiagnosticsPanel";
import { VinPresenceDiagnosticsPanel } from "./VinPresenceDiagnosticsPanel";
import type {
  ReconciledTransaction,
  ReconciliationExceptionStatus,
  ReconciliationExceptionReviewUpdate,
  ReconciliationExceptionReviewStatus,
  ReconciliationRunComparison,
  ReconciliationRunFilters,
  ReconciliationRunDetail,
  ReconciliationRunListItem,
  ReconciliationReplayResponse,
  VinPresenceDiagnostics,
} from "../types/reconciliation";
import type {
  SourceFileSummary,
  UploadPreprocessingMetadata,
  UploadResponse,
  UploadValidationError,
} from "../types/sourceFile";
import type {
  IngestionEvent,
  OperationalEvent,
  OperationalMetrics,
  ScheduledReconciliationJob,
  StoreAutomationStatus,
} from "../types/automation";
import type { CurrentUser } from "../types/auth";
import type { DealerGroup, DealerGroupAnalytics, DealershipStore } from "../types/store";
import { formatRunId } from "../utils/formatRunId";

type UploadSlot = {
  file: File | null;
  upload: UploadResponse | null;
  isUploading: boolean;
  error: string | null;
  errorPreprocessing: UploadPreprocessingMetadata | null;
};

type SourceKind = "boa" | "dealertrack";

const initialUploadSlot: UploadSlot = {
  file: null,
  upload: null,
  isUploading: false,
  error: null,
  errorPreprocessing: null,
};

const VALIDATION_ERROR_PREVIEW_LIMIT = 10;

export function WorkflowDashboard({ currentUser }: { currentUser?: CurrentUser }) {
  const [boaUpload, setBoaUpload] = useState<UploadSlot>(initialUploadSlot);
  const [dealertrackUpload, setDealertrackUpload] = useState<UploadSlot>(initialUploadSlot);
  const [sourceFiles, setSourceFiles] = useState<SourceFileSummary[]>([]);
  const [reconciliationRuns, setReconciliationRuns] = useState<ReconciliationRunListItem[]>([]);
  const [dealerGroups, setDealerGroups] = useState<DealerGroup[]>([]);
  const [stores, setStores] = useState<DealershipStore[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [newStoreName, setNewStoreName] = useState("");
  const [groupAnalytics, setGroupAnalytics] = useState<DealerGroupAnalytics[]>([]);
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledReconciliationJob[]>([]);
  const [automationStatuses, setAutomationStatuses] = useState<StoreAutomationStatus[]>([]);
  const [ingestionEvents, setIngestionEvents] = useState<IngestionEvent[]>([]);
  const [operationalEvents, setOperationalEvents] = useState<OperationalEvent[]>([]);
  const [operationalMetrics, setOperationalMetrics] = useState<OperationalMetrics | null>(null);
  const [activeRun, setActiveRun] = useState<ReconciliationRunDetail | null>(null);
  const [activeRunDiagnostics, setActiveRunDiagnostics] = useState<VinPresenceDiagnostics | null>(null);
  const [activeRunAnalytics, setActiveRunAnalytics] = useState<ReconciliationRunComparison | null>(null);
  const [activeRunReplay, setActiveRunReplay] = useState<ReconciliationReplayResponse | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [historyLoadingId, setHistoryLoadingId] = useState<number | null>(null);
  const [exceptionFilters, setExceptionFilters] = useState<ReconciliationRunFilters>({});
  const [reviewUpdatingId, setReviewUpdatingId] = useState<number | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [isReconciliationStale, setIsReconciliationStale] = useState(false);

  const canReconcile = Boolean(boaUpload.upload?.source_file_id && dealertrackUpload.upload?.source_file_id);
  const canModify = currentUser?.role !== "read_only_auditor";

  useEffect(() => {
    void refreshLists();
    // Initial load only; store changes are handled explicitly in handleStoreChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshLists() {
    const [groups, storeList] = await Promise.all([listDealerGroups(), listDealershipStores()]);
    const activeStoreId = selectedStoreId ?? storeList[0]?.id ?? null;
    if (selectedStoreId === null && activeStoreId !== null) {
      setSelectedStoreId(activeStoreId);
    }
    const [uploads, runs, analytics, jobs, statuses, ingestion, alerts, metrics] = await Promise.all([
      listSourceFiles(undefined, activeStoreId),
      listReconciliationRuns(activeStoreId),
      getDealerGroupAnalytics(),
      listScheduledJobs(activeStoreId),
      getAutomationStatus(),
      listIngestionEvents(activeStoreId),
      listOperationalEvents(activeStoreId),
      getOperationalMetrics(),
    ]);
    setDealerGroups(groups);
    setStores(storeList);
    setSourceFiles(uploads);
    setReconciliationRuns(runs);
    setGroupAnalytics(analytics);
    setScheduledJobs(jobs);
    setAutomationStatuses(statuses);
    setIngestionEvents(ingestion);
    setOperationalEvents(alerts);
    setOperationalMetrics(metrics);
  }

  async function handleUpload(kind: SourceKind) {
    const slot = kind === "boa" ? boaUpload : dealertrackUpload;
    const setSlot = kind === "boa" ? setBoaUpload : setDealertrackUpload;

    if (!slot.file) {
      setSlot((current) => ({ ...current, error: "Choose a CSV file." }));
      return;
    }

    setWorkflowError(null);
    setSlot((current) => ({
      ...current,
      isUploading: true,
      error: null,
      errorPreprocessing: null,
      upload: null,
    }));

    try {
      const upload = await uploadSourceFile({
        sourceType: kind,
        file: slot.file,
        dealershipStoreId: selectedStoreId,
      });
      setSlot((current) => ({
        ...current,
        upload,
        isUploading: false,
        errorPreprocessing: null,
      }));
      await refreshAutomationPanels(selectedStoreId);
    } catch (error) {
      const errorPreprocessing =
        error instanceof UploadError ? error.preprocessing : null;
      setSlot((current) => ({
        ...current,
        isUploading: false,
        error: error instanceof Error ? error.message : "Upload failed.",
        errorPreprocessing,
      }));
    }
  }

  async function handleReconcile() {
    if (!boaUpload.upload || !dealertrackUpload.upload) {
      return;
    }

    setIsReconciling(true);
    setWorkflowError(null);

    try {
      const result = await reconcileSourceFiles({
        boaSourceFileId: boaUpload.upload.source_file_id,
        dealertrackSourceFileId: dealertrackUpload.upload.source_file_id,
        dealershipStoreId: selectedStoreId,
      });
      const detail = await getReconciliationRun(result.reconciliation_run_id, exceptionFilters);
      const analytics = await getReconciliationRunAnalytics(result.reconciliation_run_id);
      setActiveRun(detail);
      setActiveRunDiagnostics(result.vin_presence_diagnostics);
      setActiveRunAnalytics(analytics);
      setActiveRunReplay(null);
      setIsReconciliationStale(false);
      setReconciliationRuns(await listReconciliationRuns(selectedStoreId));
      setGroupAnalytics(await getDealerGroupAnalytics());
      await refreshAutomationPanels(selectedStoreId);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Reconciliation failed.");
    } finally {
      setIsReconciling(false);
    }
  }

  async function handleStoreChange(storeId: number | null) {
    setSelectedStoreId(storeId);
    setActiveRun(null);
    setActiveRunDiagnostics(null);
    setActiveRunAnalytics(null);
    setActiveRunReplay(null);
    setBoaUpload(initialUploadSlot);
    setDealertrackUpload(initialUploadSlot);
    const [uploads, runs, analytics, jobs, ingestion, alerts, metrics, statuses] = await Promise.all([
      listSourceFiles(undefined, storeId),
      listReconciliationRuns(storeId),
      getDealerGroupAnalytics(),
      listScheduledJobs(storeId),
      listIngestionEvents(storeId),
      listOperationalEvents(storeId),
      getOperationalMetrics(),
      getAutomationStatus(),
    ]);
    setSourceFiles(uploads);
    setReconciliationRuns(runs);
    setGroupAnalytics(analytics);
    setScheduledJobs(jobs);
    setIngestionEvents(ingestion);
    setOperationalEvents(alerts);
    setOperationalMetrics(metrics);
    setAutomationStatuses(statuses);
  }

  async function handleCreateStore() {
    const name = newStoreName.trim();
    if (!name) {
      return;
    }
    setWorkflowError(null);
    try {
      const store = await createDealershipStore({
        name,
        dealer_group_id: dealerGroups[0]?.id ?? null,
      });
      setNewStoreName("");
      setStores(await listDealershipStores());
      await handleStoreChange(store.id);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Store could not be created.");
    }
  }

  async function handleViewRun(reconciliationRunId: number) {
    setHistoryLoadingId(reconciliationRunId);
    setWorkflowError(null);

    try {
      const [detail, analytics] = await Promise.all([
        getReconciliationRun(reconciliationRunId, exceptionFilters),
        getReconciliationRunAnalytics(reconciliationRunId),
      ]);
      setActiveRun(detail);
      setActiveRunDiagnostics(null);
      setActiveRunAnalytics(analytics);
      setActiveRunReplay(null);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Run detail could not be loaded.");
    } finally {
      setHistoryLoadingId(null);
    }
  }

  async function handleFilterChange(filters: ReconciliationRunFilters) {
    setExceptionFilters(filters);
    if (!activeRun) {
      return;
    }

    setWorkflowError(null);
    try {
      setActiveRun(await getReconciliationRun(activeRun.reconciliation_run_id, filters));
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Run detail could not be loaded.");
    }
  }

  async function handleExceptionReviewUpdate(
    exceptionId: number,
    update: ReconciliationExceptionReviewUpdate,
  ) {
    if (!activeRun) {
      return;
    }

    setReviewUpdatingId(exceptionId);
    setWorkflowError(null);
    try {
      await updateReconciliationExceptionReview({
        reconciliationRunId: activeRun.reconciliation_run_id,
        exceptionId,
        update,
      });
      const [detail, analytics] = await Promise.all([
        getReconciliationRun(activeRun.reconciliation_run_id, exceptionFilters),
        getReconciliationRunAnalytics(activeRun.reconciliation_run_id),
      ]);
      setActiveRun(detail);
      setActiveRunAnalytics(analytics);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Exception review could not be saved.");
    } finally {
      setReviewUpdatingId(null);
    }
  }

  async function handleReplayRun() {
    if (!activeRun) {
      return;
    }
    setIsReplaying(true);
    setWorkflowError(null);
    try {
      setActiveRunReplay(await replayReconciliationRun(activeRun.reconciliation_run_id));
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Historical replay could not be run.");
    } finally {
      setIsReplaying(false);
    }
  }

  async function refreshAutomationPanels(storeId: number | null) {
    const [uploads, runs, jobs, ingestion, alerts, metrics, statuses] = await Promise.all([
      listSourceFiles(undefined, storeId),
      listReconciliationRuns(storeId),
      listScheduledJobs(storeId),
      listIngestionEvents(storeId),
      listOperationalEvents(storeId),
      getOperationalMetrics(),
      getAutomationStatus(),
    ]);
    setSourceFiles(uploads);
    setReconciliationRuns(runs);
    setScheduledJobs(jobs);
    setIngestionEvents(ingestion);
    setOperationalEvents(alerts);
    setOperationalMetrics(metrics);
    setAutomationStatuses(statuses);
  }

  async function handleCreateScheduledJob() {
    if (!selectedStoreId) {
      return;
    }
    setWorkflowError(null);
    try {
      await createScheduledJob({
        dealership_store_id: selectedStoreId,
        cadence: "daily",
        expected_source_types: ["boa", "dealertrack"],
        enabled: true,
        auto_run_on_pair: true,
      });
      await refreshAutomationPanels(selectedStoreId);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Scheduled job could not be created.");
    }
  }

  async function handleToggleScheduledJob(job: ScheduledReconciliationJob, enabled: boolean) {
    setWorkflowError(null);
    try {
      await updateScheduledJob(job.id, { enabled });
      await refreshAutomationPanels(selectedStoreId);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Scheduled job could not be updated.");
    }
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <StoreManagementPanel
          analytics={groupAnalytics}
          newStoreName={newStoreName}
          selectedStoreId={selectedStoreId}
          stores={stores}
          onCreateStore={() => void handleCreateStore()}
          onNewStoreNameChange={setNewStoreName}
          onStoreChange={(storeId) => void handleStoreChange(storeId)}
        />
        <AutomationOverview
          events={operationalEvents}
          ingestionEvents={ingestionEvents}
          jobs={scheduledJobs}
          metrics={operationalMetrics}
          selectedStoreId={selectedStoreId}
          statuses={automationStatuses}
          onCreateJob={() => void handleCreateScheduledJob()}
          onToggleJob={(job, enabled) => void handleToggleScheduledJob(job, enabled)}
          canModify={canModify}
        />

        <div className="sticky top-0 z-10 -mx-4 -mt-4 flex flex-col gap-1 border-b border-slate-200 bg-white px-4 py-3 md:-mx-5 md:-mt-5 md:px-5 md:py-4">
          <p className="text-xs font-semibold uppercase text-cyan-700">Step 1</p>
          <h2 className="text-lg font-semibold text-slate-950 md:text-xl">Upload BOA and Dealertrack CSVs</h2>
        </div>

        <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
          <UploadPanel
            kind="boa"
            label="BOA file"
            slot={boaUpload}
            onFileChange={(file) =>
              setBoaUpload((current) => ({
                ...current,
                file,
                upload: null,
                error: null,
                errorPreprocessing: null,
              }))
            }
            onUpload={() => void handleUpload("boa")}
            canModify={canModify}
          />
          <UploadPanel
            kind="dealertrack"
            label="Dealertrack file"
            slot={dealertrackUpload}
            onFileChange={(file) =>
              setDealertrackUpload((current) => ({
                ...current,
                file,
                upload: null,
                error: null,
                errorPreprocessing: null,
              }))
            }
            onUpload={() => void handleUpload("dealertrack")}
            canModify={canModify}
            onVinEnriched={() => setIsReconciliationStale(true)}
          />
        </div>

        {isReconciliationStale && activeRun ? (
          <div
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            data-testid="reconciliation-stale-banner"
          >
            VIN repaired. Re-run reconciliation to apply the corrected VIN.
          </div>
        ) : null}

        <RecentUploads sourceFiles={sourceFiles} />
      </section>

      <section className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between md:p-5">
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase text-cyan-700">Step 2</p>
          <h2 className="text-lg font-semibold text-slate-950 md:text-xl">Run reconciliation</h2>
          <p className="mt-1 text-sm text-slate-600">
            Selected BOA #{boaUpload.upload?.source_file_id ?? "none"} and Dealertrack #
            {dealertrackUpload.upload?.source_file_id ?? "none"}
          </p>
        </div>
        <button
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300 md:w-auto md:flex-shrink-0"
          disabled={!canModify || !canReconcile || isReconciling}
          type="button"
          onClick={() => void handleReconcile()}
        >
          {isReconciling ? "Reconciling..." : "Run reconciliation"}
        </button>
      </section>

      {workflowError ? <ErrorBanner message={workflowError} /> : null}

      <ResultsSection
        analytics={activeRunAnalytics}
        diagnostics={activeRunDiagnostics}
        filters={exceptionFilters}
        replay={activeRunReplay}
        run={activeRun}
        isReconciling={isReconciling}
        isReplaying={isReplaying}
        onFiltersChange={(filters) => void handleFilterChange(filters)}
        onReplay={() => void handleReplayRun()}
        onReviewUpdate={(exceptionId, update) =>
          void handleExceptionReviewUpdate(exceptionId, update)
        }
        reviewUpdatingId={reviewUpdatingId}
        canModify={canModify}
      />

      <HistorySection
        activeRunId={activeRun?.reconciliation_run_id ?? null}
        loadingRunId={historyLoadingId}
        runs={reconciliationRuns}
        onViewRun={(runId) => void handleViewRun(runId)}
      />
    </div>
  );
}

function StoreManagementPanel({
  analytics,
  newStoreName,
  selectedStoreId,
  stores,
  onCreateStore,
  onNewStoreNameChange,
  onStoreChange,
}: {
  analytics: DealerGroupAnalytics[];
  newStoreName: string;
  selectedStoreId: number | null;
  stores: DealershipStore[];
  onCreateStore: () => void;
  onNewStoreNameChange: (name: string) => void;
  onStoreChange: (storeId: number | null) => void;
}) {
  return (
    <div className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Store
          <select
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100"
            value={selectedStoreId ?? ""}
            onChange={(event) => onStoreChange(event.target.value ? Number(event.target.value) : null)}
          >
            {stores.length === 0 ? <option value="">No stores</option> : null}
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Add store
            <input
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              placeholder="Store name"
              type="text"
              value={newStoreName}
              onChange={(event) => onNewStoreNameChange(event.target.value)}
            />
          </label>
          <button
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={!newStoreName.trim()}
            type="button"
            onClick={onCreateStore}
          >
            Create Store
          </button>
        </div>
      </div>
      <GroupAnalyticsSummary analytics={analytics} selectedStoreId={selectedStoreId} />
    </div>
  );
}

function GroupAnalyticsSummary({
  analytics,
  selectedStoreId,
}: {
  analytics: DealerGroupAnalytics[];
  selectedStoreId: number | null;
}) {
  const selectedStore = analytics
    .flatMap((group) => group.stores)
    .find((store) => store.dealership_store_id === selectedStoreId);
  if (!selectedStore) {
    return null;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Store runs" value={selectedStore.run_count} />
      <Metric label="Store unresolved" value={selectedStore.unresolved_count} />
      <Metric label="Recurring at store" value={selectedStore.recurring_exception_count} />
    </div>
  );
}

function AutomationOverview({
  events,
  ingestionEvents,
  jobs,
  metrics,
  selectedStoreId,
  statuses,
  onCreateJob,
  onToggleJob,
  canModify,
}: {
  events: OperationalEvent[];
  ingestionEvents: IngestionEvent[];
  jobs: ScheduledReconciliationJob[];
  metrics: OperationalMetrics | null;
  selectedStoreId: number | null;
  statuses: StoreAutomationStatus[];
  onCreateJob: () => void;
  onToggleJob: (job: ScheduledReconciliationJob, enabled: boolean) => void;
  canModify: boolean;
}) {
  const selectedStatus = statuses.find((status) => status.dealership_store_id === selectedStoreId);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Metric label="Scheduled jobs" value={jobs.length} />
        <Metric label="Enabled jobs" value={jobs.filter((job) => job.enabled).length} />
        <Metric
          label="Avg completion"
          value={
            metrics?.average_reconciliation_completion_time_ms === null ||
            metrics?.average_reconciliation_completion_time_ms === undefined
              ? "n/a"
              : `${metrics.average_reconciliation_completion_time_ms}ms`
          }
        />
        <Metric
          label="Auto reconciliation"
          value={`${metrics?.auto_vs_manual_reconciliation_rates.automated_percent.toFixed(2) ?? "0.00"}%`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Scheduled Jobs</h3>
              <p className="mt-1 text-sm text-slate-600">
                Store-level automation rules for recurring reconciliation.
              </p>
            </div>
            <button
              className="inline-flex h-9 items-center justify-center rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={!canModify || !selectedStoreId}
              type="button"
              onClick={onCreateJob}
            >
              Add Daily
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            {jobs.length === 0 ? (
              <p className="text-sm text-slate-600">No scheduled jobs for this store.</p>
            ) : (
              jobs.map((job) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3"
                  key={job.id}
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      {formatReason(job.cadence)} / {job.expected_source_types.join(" + ")}
                    </p>
                    <p className="text-xs text-slate-600">
                      Next {job.next_run_at ? formatDateTime(job.next_run_at) : "not scheduled"}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    Enabled
                    <input
                      checked={job.enabled}
                      disabled={!canModify}
                      type="checkbox"
                      onChange={(event) => onToggleJob(job, event.target.checked)}
                    />
                  </label>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-950">Store Automation Status</h3>
          {selectedStatus ? (
            <div className="mt-3 grid gap-2 text-sm text-slate-700">
              <p>Last upload: {selectedStatus.last_upload_at ? formatDateTime(selectedStatus.last_upload_at) : "None"}</p>
              <p>
                Last reconciliation:{" "}
                {selectedStatus.last_reconciliation_at
                  ? formatDateTime(selectedStatus.last_reconciliation_at)
                  : "None"}
              </p>
              <p>Missing files: {selectedStatus.missing_expected_source_types.join(", ") || "None"}</p>
              <p className={selectedStatus.stale_reconciliation ? "font-semibold text-amber-700" : "text-emerald-700"}>
                {selectedStatus.stale_reconciliation ? "Stale activity detected" : "Activity current"}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600">No status for this store yet.</p>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <EventList title="Recent Ingestion Events" rows={ingestionEvents} />
        <EventList title="Operational Alerts" rows={events} />
      </div>
    </div>
  );
}

function EventList({
  title,
  rows,
}: {
  title: string;
  rows: Array<IngestionEvent | OperationalEvent>;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <div className="mt-3 grid gap-2">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-600">None</p>
        ) : (
          rows.slice(0, 5).map((row) => (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3" key={`${title}-${row.id}`}>
              <p className="text-sm font-semibold text-slate-950">{row.message}</p>
              <p className="mt-1 text-xs text-slate-600">
                {row.store_name ?? "Unassigned store"} / {formatDateTime(row.created_at)}
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function UploadPanel({
  kind,
  label,
  slot,
  canModify,
  onFileChange,
  onUpload,
  onVinEnriched,
}: {
  kind: SourceKind;
  label: string;
  slot: UploadSlot;
  canModify: boolean;
  onFileChange: (file: File | null) => void;
  onUpload: () => void;
  onVinEnriched?: () => void;
}) {
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    onFileChange(event.target.files?.[0] ?? null);
  }

  return (
    <div className="grid gap-4 rounded-md border-2 border-slate-300 bg-white p-4 shadow-sm transition hover:border-cyan-300 hover:shadow-md md:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <h3 className="text-base font-semibold text-slate-950 md:text-lg">{label}</h3>
        <span className="w-fit rounded-md border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700">
          {kind.toUpperCase()}
        </span>
      </div>

      <input
        accept=".csv,text/csv"
        className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-100 md:file:mr-4 md:file:px-4 md:file:py-2 md:file:text-sm"
        disabled={!canModify}
        type="file"
        onChange={handleFileChange}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <button
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-cyan-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
          disabled={!canModify || !slot.file || slot.isUploading}
          type="button"
          onClick={onUpload}
        >
          {slot.isUploading ? "Uploading..." : "Upload"}
        </button>
        {slot.file ? <span className="truncate text-sm text-slate-600">{slot.file.name}</span> : null}
      </div>

      {slot.upload ? (
        <UploadReceipt
          sourceLabel={label}
          upload={slot.upload}
          sourceType={kind}
          onVinEnriched={onVinEnriched}
        />
      ) : null}
      {slot.error ? <ErrorBanner message={slot.error} /> : null}
      {slot.errorPreprocessing ? (
        <PreprocessingDiagnosticsPanel
          preprocessing={slot.errorPreprocessing}
          sourceLabel={label}
        />
      ) : null}
    </div>
  );
}

function UploadReceipt({
  sourceLabel,
  upload,
  sourceType,
  onVinEnriched,
}: {
  sourceLabel: string;
  upload: UploadResponse;
  sourceType?: SourceKind;
  onVinEnriched?: () => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
        <div className="grid gap-1 sm:grid-cols-2">
          <p>
            <span className="font-medium">source_file_id:</span> {upload.source_file_id}
          </p>
          <p>
            <span className="font-medium">filename:</span> {upload.filename}
          </p>
          <p>
            <span className="font-medium">store:</span> {upload.store_name ?? "n/a"}
          </p>
          <p>
            <span className="font-medium">transactions:</span> {upload.transaction_count}
          </p>
          <p>
            <span className="font-medium">validation errors:</span>{" "}
            {upload.validation_errors.length}
          </p>
        </div>
        {upload.validation_errors.length > 0 ? (
          <ValidationErrors errors={upload.validation_errors} />
        ) : null}
      </div>
      <PreprocessingDiagnosticsPanel
        preprocessing={upload.preprocessing ?? null}
        sourceLabel={sourceLabel}
        sourceFileId={upload.source_file_id}
        sourceType={sourceType ?? null}
        onVinEnriched={onVinEnriched}
      />
    </div>
  );
}

function ValidationErrors({ errors }: { errors: UploadValidationError[] }) {
  const visibleErrors = errors.slice(0, VALIDATION_ERROR_PREVIEW_LIMIT);
  const hiddenCount = Math.max(errors.length - visibleErrors.length, 0);

  return (
    <details className="mt-3 rounded-md border border-amber-200 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-amber-950">
        {errors.length} validation error{errors.length === 1 ? "" : "s"} found. Showing first{" "}
        {visibleErrors.length} when expanded.
      </summary>
      <div className="max-h-64 overflow-auto border-t border-amber-100">
        <table className="min-w-full divide-y divide-amber-100 text-left text-sm">
          <thead className="sticky top-0 bg-amber-50 text-amber-950">
            <tr>
              <th className="px-3 py-2 font-semibold">Row</th>
              <th className="px-3 py-2 font-semibold">Field</th>
              <th className="px-3 py-2 font-semibold">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {visibleErrors.map((error, index) => (
              <tr key={`${error.row ?? "file"}-${error.field ?? "field"}-${index}`}>
                <td className="px-3 py-2">{error.row ?? "file"}</td>
                <td className="px-3 py-2">{error.field ?? "file"}</td>
                <td className="px-3 py-2">{error.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 ? (
        <p className="border-t border-amber-100 px-3 py-2 text-xs text-amber-900">
          {hiddenCount} additional validation error{hiddenCount === 1 ? "" : "s"} hidden.
        </p>
      ) : null}
    </details>
  );
}

function RecentUploads({ sourceFiles }: { sourceFiles: SourceFileSummary[] }) {
  const recentFloorplanUploads = useMemo(
    () =>
      sourceFiles
        .filter((sourceFile) => sourceFile.source_type === "boa" || sourceFile.source_type === "dealertrack")
        .slice(0, 6),
    [sourceFiles],
  );

  if (recentFloorplanUploads.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2 font-semibold">source_file_id</th>
            <th className="px-3 py-2 font-semibold">Store</th>
            <th className="px-3 py-2 font-semibold">Source</th>
            <th className="px-3 py-2 font-semibold">Filename</th>
            <th className="px-3 py-2 font-semibold">Rows</th>
            <th className="px-3 py-2 font-semibold">Errors</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {recentFloorplanUploads.map((sourceFile) => (
            <tr key={sourceFile.source_file_id}>
              <td className="px-3 py-2 font-medium text-slate-950">{sourceFile.source_file_id}</td>
              <td className="px-3 py-2 text-slate-700">{sourceFile.store_name ?? "n/a"}</td>
              <td className="px-3 py-2 text-slate-700">{sourceFile.source_type.toUpperCase()}</td>
              <td className="px-3 py-2 text-slate-700">{sourceFile.filename}</td>
              <td className="px-3 py-2 text-slate-700">{sourceFile.row_count}</td>
              <td className="px-3 py-2 text-slate-700">{sourceFile.validation_error_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsSection({
  analytics,
  diagnostics,
  filters,
  replay,
  run,
  isReconciling,
  isReplaying,
  onFiltersChange,
  onReplay,
  onReviewUpdate,
  reviewUpdatingId,
  canModify,
}: {
  analytics: ReconciliationRunComparison | null;
  diagnostics: VinPresenceDiagnostics | null;
  filters: ReconciliationRunFilters;
  replay: ReconciliationReplayResponse | null;
  run: ReconciliationRunDetail | null;
  isReconciling: boolean;
  isReplaying: boolean;
  onFiltersChange: (filters: ReconciliationRunFilters) => void;
  onReplay: () => void;
  onReviewUpdate: (exceptionId: number, update: ReconciliationExceptionReviewUpdate) => void;
  reviewUpdatingId: number | null;
  canModify: boolean;
}) {
  if (!run && !isReconciling) {
    return null;
  }

  const exportUrl = run ? getReconciliationExceptionsCsvUrl(run.reconciliation_run_id) : null;

  return (
    <section className="grid gap-5 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase text-cyan-700">Step 3</p>
          <h2 className="text-lg font-semibold text-slate-950">Review reconciliation</h2>
          {run ? (
            <p className="text-sm text-slate-600">
              Run {formatRunId(run.created_at)} for {run.store_name ?? "Unassigned store"} from{" "}
              {formatDateTime(run.created_at)}
            </p>
          ) : null}
        </div>
        {run ? (
          <div className="flex flex-wrap gap-2">
            <a
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-700"
              download
              href={getHurstFpRecExportUrl(run.reconciliation_run_id)}
            >
              Export Hurst FP Rec (.xls)
            </a>
            {exportUrl ? (
              <a
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                download
                href={exportUrl}
              >
                Export Unmatched Items CSV
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      {isReconciling ? (
        <div className="rounded-md border border-cyan-200 bg-cyan-50 p-4 text-sm font-medium text-cyan-950">
          Running reconciliation...
        </div>
      ) : null}

      {run ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Clean matches (VIN + amount)" value={run.matched_count} />
            <Metric label="Unmatched items" value={run.exception_count} />
            <Metric label="Duplicates" value={run.duplicate_count} />
            <Metric label="Run ID" value={formatRunId(run.created_at)} />
          </div>

          <ExceptionBreakdown run={run} />
          <RunTrendAnalyticsPanel analytics={analytics} />
          <HistoricalReplayPanel
            replay={replay}
            isReplaying={isReplaying}
            onReplay={onReplay}
          />
          <VinPresenceDiagnosticsPanel diagnostics={diagnostics} />
          <MatchGroupsTable run={run} />
          <ExceptionsTable
            filters={filters}
            run={run}
            onFiltersChange={onFiltersChange}
            onReviewUpdate={onReviewUpdate}
            reviewUpdatingId={reviewUpdatingId}
            canModify={canModify}
          />
        </>
      ) : null}
    </section>
  );
}

function ExceptionBreakdown({ run }: { run: ReconciliationRunDetail }) {
  const breakdown = getExceptionBreakdown(run);

  return (
    <div className="grid gap-2">
      <div>
        <h3 className="text-base font-semibold text-slate-950">Unmatched items breakdown</h3>
        <p className="mt-1 text-sm text-slate-600">
          Rows are grouped by Hiley worksheet placement. Same-VIN rows that do not cleanly
          match stay in manual review.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="On statement-not on GL" value={breakdown.statementNotOnGl} />
        <Metric label="On schedule-not on statement" value={breakdown.scheduleNotOnStatement} />
        <Metric label="Needs manual review" value={breakdown.manualReview} />
      </div>
    </div>
  );
}

function RunTrendAnalyticsPanel({ analytics }: { analytics: ReconciliationRunComparison | null }) {
  if (!analytics) {
    return null;
  }

  const summary = analytics.run_comparison_summary;
  const current = summary.current;

  return (
    <div className="grid gap-3">
      <div>
        <h3 className="text-base font-semibold text-slate-950">Run trend analytics</h3>
        <p className="mt-1 text-sm text-slate-600">
          {analytics.previous_run_id ? "Compared with the previous run." : "No previous run is available."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Unresolved" value={current.unresolved_count} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <TrendSummaryCard
          label="New Exceptions"
          value={summary.newly_created_count}
          detail="Current exceptions absent from the prior run"
          tone={summary.newly_created_count > 0 ? "attention" : "neutral"}
        />
      </div>

      <CategoryTrendTable rows={analytics.category_summary} />
    </div>
  );
}

function HistoricalReplayPanel({
  replay,
  isReplaying,
  onReplay,
}: {
  replay: ReconciliationReplayResponse | null;
  isReplaying: boolean;
  onReplay: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">Historical Replay</h3>
          <p className="mt-1 text-sm text-slate-600">
            Reruns this reconciliation from its saved normalized inputs for audit checks.
          </p>
        </div>
        <button
          className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={isReplaying}
          type="button"
          onClick={onReplay}
        >
          {isReplaying ? "Replaying..." : "Replay Snapshot"}
        </button>
      </div>

      {replay ? (
        <>
          <div
            className={`rounded-md border p-3 text-sm font-semibold ${
              replay.results_changed
                ? "border-amber-200 bg-amber-50 text-amber-950"
                : "border-emerald-200 bg-emerald-50 text-emerald-950"
            }`}
          >
            {replay.results_changed ? "Results changed" : "Results unchanged"}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Matched delta" value={formatSignedDelta(replay.matched_count_delta)} />
            <Metric label="Exception delta" value={formatSignedDelta(replay.exception_count_delta)} />
            <Metric label="Newly matched" value={replay.newly_matched.length} />
            <Metric label="Newly unmatched" value={replay.newly_unmatched.length} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <ReplayVersionPanel replay={replay} />
            <ReplayDiffList replay={replay} />
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-600">No replay has been run for this result yet.</p>
      )}
    </div>
  );
}

function ReplayVersionPanel({ replay }: { replay: ReconciliationReplayResponse }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
      <h4 className="font-semibold text-slate-950">Version check</h4>
      <div className="mt-2 grid gap-2">
        <VersionRow
          label="Engine"
          original={replay.engine_version_difference.original}
          current={replay.engine_version_difference.current}
          differs={replay.engine_version_difference.differs}
        />
        {replay.parser_version_difference.map((version) => (
          <VersionRow
            current={version.current}
            differs={version.differs}
            key={version.side}
            label={`${formatReason(version.side)} parser`}
            original={version.original}
          />
        ))}
      </div>
    </div>
  );
}

function VersionRow({
  label,
  original,
  current,
  differs,
}: {
  label: string;
  original: string;
  current: string;
  differs: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-700">{label}</span>
        <span className={differs ? "text-amber-700" : "text-emerald-700"}>
          {differs ? "Changed" : "Same"}
        </span>
      </div>
      <p className="break-all text-xs text-slate-500">
        Original {original} / Current {current}
      </p>
    </div>
  );
}

function ReplayDiffList({ replay }: { replay: ReconciliationReplayResponse }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
      <h4 className="font-semibold text-slate-950">Deterministic diff</h4>
      <div className="mt-2 grid gap-3">
        <ReplayKeyList label="Newly matched" rows={replay.newly_matched} />
        <ReplayKeyList label="Newly unmatched" rows={replay.newly_unmatched} />
      </div>
    </div>
  );
}

function ReplayKeyList({ label, rows }: { label: string; rows: string[] }) {
  return (
    <details className="rounded-md border border-slate-200 bg-slate-50 p-2">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        {label} ({rows.length})
      </summary>
      {rows.length === 0 ? (
        <p className="mt-2 text-slate-600">None</p>
      ) : (
        <ul className="mt-2 grid gap-1 text-xs text-slate-700">
          {rows.map((row) => (
            <li className="break-all rounded bg-white px-2 py-1" key={row}>
              {row}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function TrendSummaryCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "positive" | "attention" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "attention"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-slate-200 bg-slate-50 text-slate-950";

  return (
    <div className={`rounded-md border p-4 ${toneClass}`}>
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-sm">{detail}</p>
    </div>
  );
}

function CategoryTrendTable({
  rows,
}: {
  rows: ReconciliationRunComparison["category_summary"];
}) {
  const displayRows = aggregateCategoryTrendRows(rows);

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
        <h4 className="text-sm font-semibold text-slate-950">Category trend</h4>
      </div>
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-white text-slate-600">
          <tr>
            <th className="px-3 py-2 font-semibold">Category</th>
            <th className="px-3 py-2 font-semibold">Current</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {displayRows.length === 0 ? (
            <tr>
              <td className="px-3 py-3 text-slate-600" colSpan={2}>
                No current categories.
              </td>
            </tr>
          ) : (
            displayRows.map((row) => (
              <tr key={row.label}>
                <td className="px-3 py-2 font-medium text-slate-950">{row.label}</td>
                <td className="px-3 py-2 text-slate-700">{row.currentCount}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function MatchGroupsTable({ run }: { run: ReconciliationRunDetail }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-base font-semibold text-slate-950">Match groups</h3>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Group</th>
              <th className="px-3 py-2 font-semibold">Reason</th>
              <th className="px-3 py-2 font-semibold">Confidence</th>
              <th className="px-3 py-2 font-semibold">Side</th>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold">Stock</th>
              <th className="px-3 py-2 font-semibold">VIN</th>
              <th className="px-3 py-2 font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {run.match_groups.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-slate-600" colSpan={8}>
                  No matches.
                </td>
              </tr>
            ) : (
              run.match_groups.flatMap((group) =>
                group.transactions.map((linkedTransaction) => (
                  <tr key={`${group.match_group_id}-${linkedTransaction.side}`}>
                    <td className="px-3 py-2 font-medium text-slate-950">
                      {group.match_group_id}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{formatReason(group.reason)}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {Math.round(group.confidence * 100)}%
                    </td>
                    <td className="px-3 py-2 text-slate-700">{linkedTransaction.side}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {linkedTransaction.source_type.toUpperCase()}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {linkedTransaction.transaction.stock_number ?? "n/a"}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {linkedTransaction.transaction.vin ?? "n/a"}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {formatAmount(linkedTransaction.transaction)}
                    </td>
                  </tr>
                )),
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExceptionsTable({
  filters,
  run,
  onFiltersChange,
  onReviewUpdate,
  reviewUpdatingId,
  canModify,
}: {
  filters: ReconciliationRunFilters;
  run: ReconciliationRunDetail;
  onFiltersChange: (filters: ReconciliationRunFilters) => void;
  onReviewUpdate: (
    exceptionId: number,
    update: ReconciliationExceptionReviewUpdate,
  ) => void;
  reviewUpdatingId: number | null;
  canModify: boolean;
}) {
  const exportUrl = getReconciliationExceptionsCsvUrl(run.reconciliation_run_id, filters);
  const reviewStatusCounts = getReviewStatusCounts(run);

  return (
    <div className="grid gap-2">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">Unmatched items</h3>
          <p className="mt-1 text-sm text-slate-600">
            Items that did not pair cleanly become On statement-not on GL, On schedule-not on
            statement, or Needs manual review. Showing {run.exceptions.length} of {run.exception_count}.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {reviewStatusCounts.map(([status, count]) => (
              <span className={reviewStatusBadgeClassName(status)} key={status}>
                {formatReason(status)}: {count}
              </span>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[140px_170px_150px_160px_160px_minmax(180px,1fr)_auto]">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Source
            <select
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              value={filters.sourceType ?? ""}
              onChange={(event) =>
                onFiltersChange({ ...filters, sourceType: event.target.value as never })
              }
            >
              <option value="">All sources</option>
              <option value="boa">BOA</option>
              <option value="dealertrack">Dealertrack</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Type
            <select
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              value={filters.exceptionType ?? ""}
              onChange={(event) =>
                onFiltersChange({ ...filters, exceptionType: event.target.value as never })
              }
            >
              <option value="">All types</option>
              <option value="missing_in_dealertrack">On statement-not on GL</option>
              <option value="missing_in_boa">On schedule-not on statement</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Search
            <input
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              placeholder="Stock, VIN, reason"
              type="search"
              value={filters.search ?? ""}
              onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Status
            <select
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              value={filters.status ?? ""}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  status: event.target.value as ReconciliationExceptionStatus | "",
                })
              }
            >
              <option value="">All statuses</option>
              <option value="unresolved">Only unresolved</option>
              <option value="resolved">Resolved</option>
              <option value="ignored">Ignored</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Review
            <select
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              value={filters.reviewStatus ?? ""}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  reviewStatus: event.target.value as ReconciliationExceptionReviewStatus | "",
                })
              }
            >
              <option value="">All review states</option>
              <option value="unreviewed">Unreviewed</option>
              <option value="investigating">Investigating</option>
              <option value="resolved">Resolved</option>
              <option value="ignored">Ignored</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Assigned
            <input
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              placeholder="Reviewer"
              type="search"
              value={filters.assignedTo ?? ""}
              onChange={(event) => onFiltersChange({ ...filters, assignedTo: event.target.value })}
            />
          </label>
          <a
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            download
            href={exportUrl}
          >
            Export Unmatched Items CSV
          </a>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Placement</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Review</th>
              <th className="px-3 py-2 font-semibold">Assigned</th>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold">Stock</th>
              <th className="px-3 py-2 font-semibold">VIN6</th>
              <th className="px-3 py-2 font-semibold">Amount</th>
              <th className="px-3 py-2 font-semibold">Research prompt</th>
              <th className="px-3 py-2 font-semibold">Note</th>
              <th className="px-3 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {run.exceptions.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-slate-600" colSpan={11}>
                  No unmatched items.
                </td>
              </tr>
            ) : (
              run.exceptions.map((exception) => (
                <tr
                  className={exceptionRowClassName(exception.status)}
                  key={exception.exception_id}
                >
                  <td className="px-3 py-2 font-medium">
                    {formatExceptionPlacement(exception)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={statusBadgeClassName(exception.status)}>
                      {formatReason(exception.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100 disabled:bg-slate-100"
                      disabled={!canModify || reviewUpdatingId === exception.exception_id}
                      value={exception.review_status}
                      onChange={(event) =>
                        onReviewUpdate(exception.exception_id, {
                          review_status: event.target.value as ReconciliationExceptionReviewStatus,
                        })
                      }
                    >
                      <option value="unreviewed">Unreviewed</option>
                      <option value="investigating">Investigating</option>
                      <option value="resolved">Resolved</option>
                      <option value="ignored">Ignored</option>
                    </select>
                  </td>
                  <td className="min-w-40 px-3 py-2">
                    <input
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100 disabled:bg-slate-100"
                      defaultValue={exception.assigned_to ?? ""}
                      disabled={!canModify || reviewUpdatingId === exception.exception_id}
                      placeholder="Assign reviewer"
                      type="text"
                      onBlur={(event) => {
                        const nextValue = event.currentTarget.value.trim();
                        if (nextValue !== (exception.assigned_to ?? "")) {
                          onReviewUpdate(exception.exception_id, {
                            assigned_to: nextValue || null,
                          });
                        }
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">{exception.source_type.toUpperCase()}</td>
                  <td className="px-3 py-2">{exception.transaction.stock_number ?? "n/a"}</td>
                  <td className="px-3 py-2">{computeDisplayVin6(exception.transaction)}</td>
                  <td className="px-3 py-2">{formatAmount(exception.transaction)}</td>
                  <td className="px-3 py-2">{neutralExceptionPrompt(exception)}</td>
                  <td className="min-w-56 px-3 py-2">
                    <input
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100 disabled:bg-slate-100"
                      defaultValue={exception.review_notes}
                      disabled={!canModify || reviewUpdatingId === exception.exception_id}
                      placeholder="Add review notes"
                      type="text"
                      onBlur={(event) => {
                        if (event.currentTarget.value !== exception.review_notes) {
                          onReviewUpdate(exception.exception_id, {
                            review_notes: event.currentTarget.value,
                          });
                        }
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="inline-flex h-8 items-center justify-center rounded-md border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-400"
                        disabled={
                          exception.review_status === "resolved" ||
                          !canModify || reviewUpdatingId === exception.exception_id
                        }
                        type="button"
                        onClick={() =>
                          onReviewUpdate(exception.exception_id, { review_status: "resolved" })
                        }
                      >
                        Resolve
                      </button>
                      <button
                        className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                        disabled={
                          exception.review_status === "ignored" ||
                          !canModify || reviewUpdatingId === exception.exception_id
                        }
                        type="button"
                        onClick={() =>
                          onReviewUpdate(exception.exception_id, { review_status: "ignored" })
                        }
                      >
                        Ignore
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistorySection({
  runs,
  activeRunId,
  loadingRunId,
  onViewRun,
}: {
  runs: ReconciliationRunListItem[];
  activeRunId: number | null;
  loadingRunId: number | null;
  onViewRun: (runId: number) => void;
}) {
  return (
    <section className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">History</h2>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Run</th>
              <th className="px-3 py-2 font-semibold">Store</th>
              <th className="px-3 py-2 font-semibold">BOA file</th>
              <th className="px-3 py-2 font-semibold">Dealertrack file</th>
              <th className="px-3 py-2 font-semibold">Matched</th>
              <th className="px-3 py-2 font-semibold">Exceptions</th>
              <th className="px-3 py-2 font-semibold">Duplicates</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Created</th>
              <th className="px-3 py-2 font-semibold">View</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {runs.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-slate-600" colSpan={10}>
                  No reconciliation runs.
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr
                  className={activeRunId === run.reconciliation_run_id ? "bg-cyan-50" : ""}
                  key={run.reconciliation_run_id}
                >
                  <td className="px-3 py-2 font-medium text-slate-950">
                    {formatRunId(run.created_at)}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{run.store_name ?? "n/a"}</td>
                  <td className="px-3 py-2 text-slate-700">{run.boa_filename}</td>
                  <td className="px-3 py-2 text-slate-700">{run.dealertrack_filename}</td>
                  <td className="px-3 py-2 text-slate-700">{run.matched_count}</td>
                  <td className="px-3 py-2 text-slate-700">{run.exception_count}</td>
                  <td className="px-3 py-2 text-slate-700">{run.duplicate_count}</td>
                  <td className="px-3 py-2 text-slate-700">{run.status}</td>
                  <td className="px-3 py-2 text-slate-700">{formatDateTime(run.created_at)}</td>
                  <td className="px-3 py-2">
                    <button
                      className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                      disabled={loadingRunId === run.reconciliation_run_id}
                      type="button"
                      onClick={() => onViewRun(run.reconciliation_run_id)}
                    >
                      {loadingRunId === run.reconciliation_run_id ? "Loading..." : "View"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-950">
      {message}
    </div>
  );
}

function formatReason(value: string) {
  return value.replace(/_/g, " ");
}

function formatAmount(transaction: ReconciledTransaction) {
  return Number(transaction.amount).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

const vinPattern = /\b[A-HJ-NPR-Z0-9]{17}\b/;

function computeDisplayVin6(transaction: ReconciledTransaction): string {
  const vin = (transaction.vin ?? "").toUpperCase();
  if (vin) {
    const match = vin.match(vinPattern);
    if (match) {
      return match[0].slice(-6);
    }
    if (vin.length >= 6) {
      return vin.slice(-6);
    }
  }
  const description = (transaction.description ?? "").toUpperCase();
  const descriptionMatch = description.match(vinPattern);
  if (descriptionMatch) {
    return descriptionMatch[0].slice(-6);
  }
  return "n/a";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatSignedDelta(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function exceptionRowClassName(status: string) {
  if (status === "resolved") {
    return "bg-emerald-50 text-emerald-950";
  }
  if (status === "ignored") {
    return "bg-slate-50 text-slate-500";
  }
  return "";
}

function statusBadgeClassName(status: string) {
  const base = "inline-flex rounded-md px-2 py-1 text-xs font-semibold";
  if (status === "resolved") {
    return `${base} bg-emerald-100 text-emerald-900`;
  }
  if (status === "ignored") {
    return `${base} bg-slate-200 text-slate-600`;
  }
  return `${base} bg-amber-100 text-amber-900`;
}

function reviewStatusBadgeClassName(status: string) {
  const base = "inline-flex rounded-md px-2 py-1 text-xs font-semibold";
  if (status === "resolved") {
    return `${base} bg-emerald-100 text-emerald-900`;
  }
  if (status === "ignored") {
    return `${base} bg-slate-200 text-slate-700`;
  }
  if (status === "investigating") {
    return `${base} bg-cyan-100 text-cyan-900`;
  }
  return `${base} bg-amber-100 text-amber-900`;
}

function getExceptionBreakdown(run: ReconciliationRunDetail) {
  return run.exceptions.reduce(
    (totals, exception) => {
      const placement = getExceptionPlacement(exception);
      if (placement === "statement") {
        totals.statementNotOnGl += 1;
      } else if (placement === "schedule") {
        totals.scheduleNotOnStatement += 1;
      } else if (placement === "manual_review") {
        totals.manualReview += 1;
      }
      return totals;
    },
    { statementNotOnGl: 0, scheduleNotOnStatement: 0, manualReview: 0 },
  );
}

function getExceptionPlacement(
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

function formatExceptionPlacement(exception: ReconciliationRunDetail["exceptions"][number]) {
  const placement = getExceptionPlacement(exception);
  if (placement === "statement") {
    return "On statement-not on GL";
  }
  if (placement === "schedule") {
    return "On schedule-not on statement";
  }
  return "Needs manual review";
}

function neutralExceptionPrompt(exception: ReconciliationRunDetail["exceptions"][number]) {
  const placement = getExceptionPlacement(exception);
  if (placement === "statement") {
    return "BOA statement row with no matching Dealertrack/GL row";
  }
  if (placement === "schedule") {
    return "Dealertrack/GL row with no matching BOA statement row";
  }
  return "VIN appears on both sides but amount differs; review manually";
}

function formatCategoryLabel(category: string) {
  if (category === "missing_in_dealertrack") {
    return "On statement-not on GL";
  }
  if (category === "missing_in_boa") {
    return "On schedule-not on statement";
  }
  return "Needs manual review";
}

function aggregateCategoryTrendRows(rows: ReconciliationRunComparison["category_summary"]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = formatCategoryLabel(row.exception_category);
    counts.set(label, (counts.get(label) ?? 0) + row.current_count);
  }
  return [...counts.entries()]
    .map(([label, currentCount]) => ({ label, currentCount }))
    .sort((left, right) => right.currentCount - left.currentCount || left.label.localeCompare(right.label));
}

function getReviewStatusCounts(run: ReconciliationRunDetail) {
  const counts = new Map<string, number>();
  for (const exception of run.exceptions) {
    counts.set(exception.review_status, (counts.get(exception.review_status) ?? 0) + 1);
  }
  return ["unreviewed", "investigating", "resolved", "ignored"]
    .map((status) => [status, counts.get(status) ?? 0] as const)
    .filter(([, count]) => count > 0);
}
