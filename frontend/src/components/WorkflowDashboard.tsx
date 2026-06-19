import { type ChangeEvent, useEffect, useState } from "react";

import {
  getArtifactDownloadUrl,
  getFpRecExportUrl,
  getMergedFloorplanExportUrl,
  getReconciliationRun,
  listReconciliationArtifacts,
  reconcileSourceFiles,
  replayReconciliationRun,
} from "../api/reconciliation";
import { createDealershipStore, listDealerGroups, listDealershipStores } from "../api/stores";
import { UploadError, uploadSourceFile } from "../api/uploads";
import { PreprocessingDiagnosticsPanel } from "./preprocessing/PreprocessingDiagnosticsPanel";
import { VinPresenceDiagnosticsPanel } from "./VinPresenceDiagnosticsPanel";
import type {
  ReconciledTransaction,
  ReconciliationArtifact,
  ReconciliationArtifactType,
  ReconciliationRunDetail,
  ReconciliationReplayResponse,
  VinPresenceDiagnostics,
} from "../types/reconciliation";
import type {
  UploadPreprocessingMetadata,
  UploadResponse,
  UploadValidationError,
} from "../types/sourceFile";
import type { CurrentUser } from "../types/auth";
import type { DealerGroup, DealershipStore } from "../types/store";
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
const ARTIFACT_LABELS: Record<ReconciliationArtifactType, string> = {
  RAW_BOA: "Raw BOA",
  RAW_DEALERTRACK: "Raw Dealertrack",
  CLEANED_BOA: "Cleaned BOA",
  CLEANED_DEALERTRACK: "Cleaned Dealertrack",
  MERGED_FLOORPLAN: "Merged Floorplan",
  FP_REC: "FP REC",
};
const ARTIFACT_SORT_ORDER: ReconciliationArtifactType[] = [
  "RAW_BOA",
  "RAW_DEALERTRACK",
  "CLEANED_BOA",
  "CLEANED_DEALERTRACK",
  "MERGED_FLOORPLAN",
  "FP_REC",
];

export function WorkflowDashboard({ currentUser }: { currentUser?: CurrentUser }) {
  const [boaUpload, setBoaUpload] = useState<UploadSlot>(initialUploadSlot);
  const [dealertrackUpload, setDealertrackUpload] = useState<UploadSlot>(initialUploadSlot);
  const [dealerGroups, setDealerGroups] = useState<DealerGroup[]>([]);
  const [stores, setStores] = useState<DealershipStore[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [newStoreName, setNewStoreName] = useState("");
  const [activeRun, setActiveRun] = useState<ReconciliationRunDetail | null>(null);
  const [activeRunDiagnostics, setActiveRunDiagnostics] = useState<VinPresenceDiagnostics | null>(null);
  const [activeRunReplay, setActiveRunReplay] = useState<ReconciliationReplayResponse | null>(null);
  const [activeRunArtifacts, setActiveRunArtifacts] = useState<ReconciliationArtifact[]>([]);
  const [activeRunArtifactsError, setActiveRunArtifactsError] = useState<string | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
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
    setDealerGroups(groups);
    setStores(storeList);
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
    setActiveRunArtifacts([]);
    setActiveRunArtifactsError(null);

    try {
      const result = await reconcileSourceFiles({
        boaSourceFileId: boaUpload.upload.source_file_id,
        dealertrackSourceFileId: dealertrackUpload.upload.source_file_id,
        dealershipStoreId: selectedStoreId,
      });
      const detail = await getReconciliationRun(result.reconciliation_run_id);
      setActiveRun(detail);
      setActiveRunDiagnostics(result.vin_presence_diagnostics);
      setActiveRunReplay(null);
      await loadRunArtifacts(result.reconciliation_run_id);
      setIsReconciliationStale(false);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Reconciliation failed.");
    } finally {
      setIsReconciling(false);
    }
  }

  function handleStoreChange(storeId: number | null) {
    setSelectedStoreId(storeId);
    setActiveRun(null);
    setActiveRunDiagnostics(null);
    setActiveRunReplay(null);
    setActiveRunArtifacts([]);
    setActiveRunArtifactsError(null);
    setBoaUpload(initialUploadSlot);
    setDealertrackUpload(initialUploadSlot);
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
      handleStoreChange(store.id);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Store could not be created.");
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

  async function loadRunArtifacts(reconciliationRunId: number) {
    setActiveRunArtifacts([]);
    setActiveRunArtifactsError(null);
    try {
      setActiveRunArtifacts(await listReconciliationArtifacts(reconciliationRunId));
    } catch (error) {
      setActiveRunArtifactsError(error instanceof Error ? error.message : "Artifacts could not be loaded.");
    }
  }

  return (
    <div className="grid gap-4">
      <PilotWorkflowIntro
        hasStore={Boolean(selectedStoreId)}
        hasBoaUpload={Boolean(boaUpload.upload)}
        hasDealertrackUpload={Boolean(dealertrackUpload.upload)}
        hasRun={Boolean(activeRun)}
      />

      <StoreManagementPanel
        newStoreName={newStoreName}
        selectedStoreId={selectedStoreId}
        stores={stores}
        onCreateStore={() => void handleCreateStore()}
        onNewStoreNameChange={setNewStoreName}
        onStoreChange={(storeId) => void handleStoreChange(storeId)}
      />

      <TaskSelectionPanel />

      <section className="forge-panel forge-panel-pad grid gap-3">
        <div className="flex flex-col gap-1">
          <p className="forge-eyebrow">Step 3</p>
          <h2 className="forge-section-title">Upload Inputs</h2>
          <p className="forge-copy">
            Upload the BOA and Dealertrack source files for the selected store/month run.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <UploadPanel
            kind="boa"
            label="BOA input"
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
            label="Dealertrack input"
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
            className="forge-notice forge-notice-warning"
            data-testid="reconciliation-stale-banner"
          >
            VIN repaired. Re-run reconciliation to apply the corrected VIN.
          </div>
        ) : null}

      </section>

      <section className="forge-panel forge-panel-pad flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex-1">
          <p className="forge-eyebrow">Step 4</p>
          <h2 className="forge-section-title">Run Workflow</h2>
          <p className="forge-copy mt-1">
            Selected BOA #{boaUpload.upload?.source_file_id ?? "none"} and Dealertrack #
            {dealertrackUpload.upload?.source_file_id ?? "none"}
          </p>
        </div>
        <button
          className="forge-button-primary w-full md:w-auto md:flex-shrink-0"
          disabled={!canModify || !canReconcile || isReconciling}
          type="button"
          onClick={() => void handleReconcile()}
        >
          {isReconciling ? "Running workflow..." : "Run Workflow"}
        </button>
      </section>

      {workflowError ? <ErrorBanner message={workflowError} /> : null}

      <ResultsSection
        artifacts={activeRunArtifacts}
        artifactsError={activeRunArtifactsError}
        diagnostics={activeRunDiagnostics}
        replay={activeRunReplay}
        run={activeRun}
        isReconciling={isReconciling}
        isReplaying={isReplaying}
        onReplay={() => void handleReplayRun()}
      />
    </div>
  );
}

function PilotWorkflowIntro({
  hasStore,
  hasBoaUpload,
  hasDealertrackUpload,
  hasRun,
}: {
  hasStore: boolean;
  hasBoaUpload: boolean;
  hasDealertrackUpload: boolean;
  hasRun: boolean;
}) {
  const hasInputs = hasBoaUpload && hasDealertrackUpload;
  const steps = [
    {
      label: "Step 1",
      title: "Select Store",
      detail: "Choose the store for this run",
      state: hasStore ? "complete" : "current",
    },
    {
      label: "Step 2",
      title: "Select Task",
      detail: "Floorplan Reconciliation",
      state: hasStore ? "complete" : "waiting",
    },
    {
      label: "Step 3",
      title: "Upload Inputs",
      detail: "BOA and Dealertrack files",
      state: hasInputs ? "complete" : hasStore ? "current" : "waiting",
    },
    {
      label: "Step 4",
      title: "Run Workflow",
      detail: "Generate the workpaper outputs",
      state: hasRun ? "complete" : hasInputs ? "current" : "waiting",
    },
    {
      label: "Step 5",
      title: "Download Outputs",
      detail: "Merged export and FP REC",
      state: hasRun ? "current" : "waiting",
    },
  ] as const;

  return (
    <section className="forge-workflow-intro grid gap-3">
      <div className="grid gap-1">
        <p className="forge-eyebrow">v1 floorplan workflow</p>
        <h2 className="forge-section-title">Five steps to the FP REC workpaper</h2>
        <p className="forge-copy max-w-4xl">
          Select the store, confirm Floorplan Reconciliation, upload the source files, run the workflow,
          then download the merged export and FP REC final workpaper.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        {steps.map((step) => (
          <PilotWorkflowStep
            detail={step.detail}
            key={step.label}
            label={step.label}
            state={step.state}
            title={step.title}
          />
        ))}
      </div>
    </section>
  );
}

function PilotWorkflowStep({
  detail,
  label,
  state,
  title,
}: {
  detail: string;
  label: string;
  state: "complete" | "current" | "waiting";
  title: string;
}) {
  const stateClasses =
    state === "complete"
      ? "forge-step-card-complete"
      : state === "current"
        ? "forge-step-card-current"
        : "forge-step-card-waiting";
  const statusLabel = state === "complete" ? "Done" : state === "current" ? "Next" : "Waiting";

  return (
    <div className={`forge-step-card ${stateClasses}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase">{label}</p>
        <span className="forge-status-pill">
          {statusLabel}
        </span>
      </div>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-slate-600">{detail}</p>
      </div>
    </div>
  );
}

function StoreManagementPanel({
  newStoreName,
  selectedStoreId,
  stores,
  onCreateStore,
  onNewStoreNameChange,
  onStoreChange,
}: {
  newStoreName: string;
  selectedStoreId: number | null;
  stores: DealershipStore[];
  onCreateStore: () => void;
  onNewStoreNameChange: (name: string) => void;
  onStoreChange: (storeId: number | null) => void;
}) {
  return (
    <section className="forge-panel forge-panel-pad grid gap-3">
      <div className="grid gap-1">
        <p className="forge-eyebrow">Step 1</p>
        <h2 className="forge-section-title">Select Store</h2>
        <p className="forge-copy">
          Choose the store for this run before uploading BOA and Dealertrack files.
        </p>
      </div>
      <div className="flex flex-col gap-3 lg:max-w-md">
        <label className="forge-field">
          Store
          <select
            className="forge-control"
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
      </div>
      <details className="forge-disclosure" open={stores.length === 0}>
        <summary className="forge-summary">
          Secondary store setup
        </summary>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="forge-field">
            Add store
            <input
              className="forge-control"
              placeholder="Store name"
              type="text"
              value={newStoreName}
              onChange={(event) => onNewStoreNameChange(event.target.value)}
            />
          </label>
          <button
            className="forge-button-primary"
            disabled={!newStoreName.trim()}
            type="button"
            onClick={onCreateStore}
          >
            Create Store
          </button>
        </div>
      </details>
    </section>
  );
}

function TaskSelectionPanel() {
  return (
    <section className="forge-panel forge-panel-pad grid gap-3">
      <div className="grid gap-1">
        <p className="forge-eyebrow">Step 2</p>
        <h2 className="forge-section-title">Select Task</h2>
        <p className="forge-copy">
          The v1 task is fixed to Floorplan Reconciliation for the selected store/month.
        </p>
      </div>
      <div className="forge-task-band">
        <p className="text-sm font-semibold text-slate-950">Floorplan Reconciliation</p>
        <p className="forge-copy mt-1">
          Generates the merged export and FP REC final workpaper. Exception review happens outside
          the app through the FP REC export.
        </p>
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
    <div className="forge-upload-card grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <h3 className="text-sm font-semibold text-slate-950">{label}</h3>
        <span className="forge-status-pill text-slate-600">
          {kind.toUpperCase()}
        </span>
      </div>

      <input
        accept=".csv,.xls,.xml,.html,.htm,text/csv,application/vnd.ms-excel,text/xml,text/html"
        className="forge-file-input"
        disabled={!canModify}
        type="file"
        onChange={handleFileChange}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <button
          className="forge-button-accent w-full sm:w-auto"
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
      <div className="forge-receipt">
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
    <details className="forge-notice forge-notice-warning mt-3">
      <summary className="forge-summary text-amber-950">
        {errors.length} validation error{errors.length === 1 ? "" : "s"} found. Showing first{" "}
        {visibleErrors.length} when expanded.
      </summary>
      <div className="forge-table-wrap mt-3 max-h-64 overflow-auto">
        <table className="forge-table">
          <thead className="sticky top-0">
            <tr>
              <th>Row</th>
              <th>Field</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {visibleErrors.map((error, index) => (
              <tr key={`${error.row ?? "file"}-${error.field ?? "field"}-${index}`}>
                <td>{error.row ?? "file"}</td>
                <td>{error.field ?? "file"}</td>
                <td>{error.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 ? (
        <p className="mt-2 text-xs text-amber-900">
          {hiddenCount} additional validation error{hiddenCount === 1 ? "" : "s"} hidden.
        </p>
      ) : null}
    </details>
  );
}

function ResultsSection({
  artifacts,
  artifactsError,
  diagnostics,
  replay,
  run,
  isReconciling,
  isReplaying,
  onReplay,
}: {
  artifacts: ReconciliationArtifact[];
  artifactsError: string | null;
  diagnostics: VinPresenceDiagnostics | null;
  replay: ReconciliationReplayResponse | null;
  run: ReconciliationRunDetail | null;
  isReconciling: boolean;
  isReplaying: boolean;
  onReplay: () => void;
}) {
  if (!run && !isReconciling) {
    return null;
  }

  return (
    <section className="forge-panel forge-panel-pad grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-1">
          <p className="forge-eyebrow">Step 5</p>
          <h2 className="forge-section-title">Download Outputs</h2>
          {run ? (
            <p className="forge-copy">
              Run {formatRunId(run.created_at)} for {run.store_name ?? "Unassigned store"} from{" "}
              {formatDateTime(run.created_at)} is ready for its merged export and FP REC final workpaper.
            </p>
          ) : null}
        </div>
        {run ? (
          <div className="flex flex-wrap gap-2">
            <a
              className="forge-button-primary"
              download
              href={getMergedFloorplanExportUrl(run.reconciliation_run_id)}
            >
              Download Merged Export
            </a>
            <a
              className="forge-button-secondary"
              download
              href={getFpRecExportUrl(run.reconciliation_run_id)}
            >
              Download FP REC
            </a>
          </div>
        ) : null}
      </div>

      {isReconciling ? (
        <div className="forge-notice forge-notice-info font-semibold">
          Running reconciliation...
        </div>
      ) : null}

      {run ? (
        <>
          <div className="forge-notice forge-notice-success">
            <p className="font-semibold">FP REC is the final workpaper.</p>
            <p className="mt-1">
              Download FP REC for exception review and annotation outside the app.
            </p>
          </div>

          <details className="forge-disclosure">
            <summary className="forge-summary">
              Secondary export and audit details
            </summary>
            <div className="mt-4 grid gap-4 opacity-90">
              <ArtifactsPanel artifacts={artifacts} error={artifactsError} />
              <RunSummaryMetrics run={run} />
              <ExceptionBreakdown run={run} />
              <HistoricalReplayPanel
                replay={replay}
                isReplaying={isReplaying}
                onReplay={onReplay}
              />
              <VinPresenceDiagnosticsPanel diagnostics={diagnostics} />
              <MatchGroupsTable run={run} />
            </div>
          </details>
        </>
      ) : null}
    </section>
  );
}

function RunSummaryMetrics({ run }: { run: ReconciliationRunDetail }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Clean matches (VIN + amount)" value={run.matched_count} />
      <Metric label="Unmatched items" value={run.exception_count} />
      <Metric label="Duplicates" value={run.duplicate_count} />
      <Metric label="Run ID" value={formatRunId(run.created_at)} />
    </div>
  );
}

function ArtifactsPanel({
  artifacts,
  error,
}: {
  artifacts: ReconciliationArtifact[];
  error: string | null;
}) {
  const sortedArtifacts = [...artifacts].sort((left, right) => {
    const leftOrder = ARTIFACT_SORT_ORDER.indexOf(left.artifact_type);
    const rightOrder = ARTIFACT_SORT_ORDER.indexOf(right.artifact_type);
    return leftOrder - rightOrder || left.filename.localeCompare(right.filename);
  });

  return (
    <div className="forge-panel forge-panel-muted forge-panel-pad grid gap-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-950">Stored artifacts</h3>
        <p className="forge-copy mt-1">
          Historical files saved for this store/month run.
        </p>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      <div className="forge-table-wrap">
        <table className="forge-table">
          <thead>
            <tr>
              <th>Artifact</th>
              <th>Filename</th>
              <th>Size</th>
              <th>Created</th>
              <th>Download</th>
            </tr>
          </thead>
          <tbody>
            {sortedArtifacts.length === 0 ? (
              <tr>
                <td className="text-slate-600" colSpan={5}>
                  No stored artifacts for this run yet.
                </td>
              </tr>
            ) : (
              sortedArtifacts.map((artifact) => (
                <tr key={artifact.id}>
                  <td className="font-medium text-slate-950">
                    {ARTIFACT_LABELS[artifact.artifact_type]}
                  </td>
                  <td className="max-w-xs break-all text-slate-700">{artifact.filename}</td>
                  <td className="text-slate-700">{formatFileSize(artifact.file_size)}</td>
                  <td className="text-slate-700">{formatDateTime(artifact.created_at)}</td>
                  <td>
                    <a
                      className="forge-button-secondary min-h-8 px-3"
                      download
                      href={getArtifactDownloadUrl(artifact.id)}
                    >
                      Download
                    </a>
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

function ExceptionBreakdown({ run }: { run: ReconciliationRunDetail }) {
  const breakdown = getExceptionBreakdown(run);

  return (
    <div className="grid gap-2">
      <div>
        <h3 className="text-sm font-semibold text-slate-950">Unmatched items breakdown</h3>
        <p className="forge-copy mt-1">
          Rows are grouped by FP REC worksheet placement. Same-VIN rows that do not cleanly
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
    <div className="forge-panel forge-panel-muted forge-panel-pad grid gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Historical Replay</h3>
          <p className="forge-copy mt-1">
            Reruns this reconciliation from its saved normalized inputs for audit checks.
          </p>
        </div>
        <button
          className="forge-button-primary"
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
            className={`forge-notice font-semibold ${
              replay.results_changed
                ? "forge-notice-warning"
                : "forge-notice-success"
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
        <p className="forge-copy">No replay has been run for this result yet.</p>
      )}
    </div>
  );
}

function ReplayVersionPanel({ replay }: { replay: ReconciliationReplayResponse }) {
  return (
    <div className="forge-panel forge-panel-pad text-sm">
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
    <div className="forge-panel forge-panel-pad text-sm">
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
    <details className="forge-panel forge-panel-muted p-2">
      <summary className="forge-summary text-slate-800">
        {label} ({rows.length})
      </summary>
      {rows.length === 0 ? (
        <p className="forge-copy mt-2">None</p>
      ) : (
        <ul className="mt-2 grid gap-1 text-xs text-slate-700">
          {rows.map((row) => (
            <li className="break-all rounded-sm bg-white px-2 py-1" key={row}>
              {row}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function MatchGroupsTable({ run }: { run: ReconciliationRunDetail }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold text-slate-950">Match groups</h3>
      <div className="forge-table-wrap">
        <table className="forge-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Reason</th>
              <th>Confidence</th>
              <th>Side</th>
              <th>Source</th>
              <th>Stock</th>
              <th>VIN</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {run.match_groups.length === 0 ? (
              <tr>
                <td className="text-slate-600" colSpan={8}>
                  No matches.
                </td>
              </tr>
            ) : (
              run.match_groups.flatMap((group) =>
                group.transactions.map((linkedTransaction) => (
                  <tr key={`${group.match_group_id}-${linkedTransaction.side}`}>
                    <td className="font-medium text-slate-950">
                      {group.match_group_id}
                    </td>
                    <td className="text-slate-700">{formatReason(group.reason)}</td>
                    <td className="text-slate-700">
                      {Math.round(group.confidence * 100)}%
                    </td>
                    <td className="text-slate-700">{linkedTransaction.side}</td>
                    <td className="text-slate-700">
                      {linkedTransaction.source_type.toUpperCase()}
                    </td>
                    <td className="text-slate-700">
                      {linkedTransaction.transaction.stock_number ?? "n/a"}
                    </td>
                    <td className="text-slate-700">
                      {linkedTransaction.transaction.vin ?? "n/a"}
                    </td>
                    <td className="text-slate-700">
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

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="forge-metric">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="forge-metric-value">{value}</p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="forge-notice forge-notice-danger font-medium">
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatSignedDelta(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
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
