import { type ChangeEvent, useEffect, useMemo, useState } from "react";

import {
  getReconciliationExceptionsCsvUrl,
  getReconciliationRun,
  listReconciliationRuns,
  reconcileSourceFiles,
  updateReconciliationExceptionReview,
} from "../api/reconciliation";
import { listSourceFiles, uploadSourceFile } from "../api/uploads";
import { VinPresenceDiagnosticsPanel } from "./VinPresenceDiagnosticsPanel";
import type {
  ReconciledTransaction,
  ReconciliationExceptionStatus,
  ReconciliationExceptionReviewUpdate,
  ReconciliationExceptionReviewStatus,
  ReconciliationRunFilters,
  ReconciliationRunDetail,
  ReconciliationRunListItem,
  VinPresenceDiagnostics,
} from "../types/reconciliation";
import type { SourceFileSummary, UploadResponse, UploadValidationError } from "../types/sourceFile";

type UploadSlot = {
  file: File | null;
  upload: UploadResponse | null;
  isUploading: boolean;
  error: string | null;
};

type SourceKind = "boa" | "dealertrack";

const initialUploadSlot: UploadSlot = {
  file: null,
  upload: null,
  isUploading: false,
  error: null,
};

export function WorkflowDashboard() {
  const [boaUpload, setBoaUpload] = useState<UploadSlot>(initialUploadSlot);
  const [dealertrackUpload, setDealertrackUpload] = useState<UploadSlot>(initialUploadSlot);
  const [sourceFiles, setSourceFiles] = useState<SourceFileSummary[]>([]);
  const [reconciliationRuns, setReconciliationRuns] = useState<ReconciliationRunListItem[]>([]);
  const [activeRun, setActiveRun] = useState<ReconciliationRunDetail | null>(null);
  const [activeRunDiagnostics, setActiveRunDiagnostics] = useState<VinPresenceDiagnostics | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [historyLoadingId, setHistoryLoadingId] = useState<number | null>(null);
  const [exceptionFilters, setExceptionFilters] = useState<ReconciliationRunFilters>({});
  const [reviewUpdatingId, setReviewUpdatingId] = useState<number | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  const canReconcile = Boolean(boaUpload.upload?.source_file_id && dealertrackUpload.upload?.source_file_id);

  useEffect(() => {
    void refreshLists();
  }, []);

  async function refreshLists() {
    const [uploads, runs] = await Promise.all([listSourceFiles(), listReconciliationRuns()]);
    setSourceFiles(uploads);
    setReconciliationRuns(runs);
  }

  async function handleUpload(kind: SourceKind) {
    const slot = kind === "boa" ? boaUpload : dealertrackUpload;
    const setSlot = kind === "boa" ? setBoaUpload : setDealertrackUpload;

    if (!slot.file) {
      setSlot((current) => ({ ...current, error: "Choose a CSV file." }));
      return;
    }

    setWorkflowError(null);
    setSlot((current) => ({ ...current, isUploading: true, error: null, upload: null }));

    try {
      const upload = await uploadSourceFile({ sourceType: kind, file: slot.file });
      setSlot((current) => ({ ...current, upload, isUploading: false }));
      setSourceFiles(await listSourceFiles());
    } catch (error) {
      setSlot((current) => ({
        ...current,
        isUploading: false,
        error: error instanceof Error ? error.message : "Upload failed.",
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
      });
      const detail = await getReconciliationRun(result.reconciliation_run_id, exceptionFilters);
      setActiveRun(detail);
      setActiveRunDiagnostics(result.vin_presence_diagnostics);
      setReconciliationRuns(await listReconciliationRuns());
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Reconciliation failed.");
    } finally {
      setIsReconciling(false);
    }
  }

  async function handleViewRun(reconciliationRunId: number) {
    setHistoryLoadingId(reconciliationRunId);
    setWorkflowError(null);

    try {
      setActiveRun(await getReconciliationRun(reconciliationRunId, exceptionFilters));
      setActiveRunDiagnostics(null);
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
      setActiveRun(await getReconciliationRun(activeRun.reconciliation_run_id, exceptionFilters));
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Exception review could not be saved.");
    } finally {
      setReviewUpdatingId(null);
    }
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase text-cyan-700">Step 1</p>
          <h2 className="text-lg font-semibold text-slate-950">Upload BOA and Dealertrack CSVs</h2>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <UploadPanel
            kind="boa"
            label="BOA file"
            slot={boaUpload}
            onFileChange={(file) =>
              setBoaUpload((current) => ({ ...current, file, upload: null, error: null }))
            }
            onUpload={() => void handleUpload("boa")}
          />
          <UploadPanel
            kind="dealertrack"
            label="Dealertrack file"
            slot={dealertrackUpload}
            onFileChange={(file) =>
              setDealertrackUpload((current) => ({ ...current, file, upload: null, error: null }))
            }
            onUpload={() => void handleUpload("dealertrack")}
          />
        </div>

        <RecentUploads sourceFiles={sourceFiles} />
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-cyan-700">Step 2</p>
          <h2 className="text-lg font-semibold text-slate-950">Run reconciliation</h2>
          <p className="mt-1 text-sm text-slate-600">
            Selected BOA #{boaUpload.upload?.source_file_id ?? "none"} and Dealertrack #
            {dealertrackUpload.upload?.source_file_id ?? "none"}
          </p>
        </div>
        <button
          className="inline-flex h-11 items-center justify-center rounded-md bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={!canReconcile || isReconciling}
          type="button"
          onClick={() => void handleReconcile()}
        >
          {isReconciling ? "Reconciling..." : "Run reconciliation"}
        </button>
      </section>

      {workflowError ? <ErrorBanner message={workflowError} /> : null}

      <ResultsSection
        diagnostics={activeRunDiagnostics}
        filters={exceptionFilters}
        run={activeRun}
        isReconciling={isReconciling}
        onFiltersChange={(filters) => void handleFilterChange(filters)}
        onReviewUpdate={(exceptionId, update) =>
          void handleExceptionReviewUpdate(exceptionId, update)
        }
        reviewUpdatingId={reviewUpdatingId}
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

function UploadPanel({
  kind,
  label,
  slot,
  onFileChange,
  onUpload,
}: {
  kind: SourceKind;
  label: string;
  slot: UploadSlot;
  onFileChange: (file: File | null) => void;
  onUpload: () => void;
}) {
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    onFileChange(event.target.files?.[0] ?? null);
  }

  return (
    <div className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-950">{label}</h3>
        <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
          {kind.toUpperCase()}
        </span>
      </div>

      <input
        accept=".csv,text/csv"
        className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 file:mr-4 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-100"
        type="file"
        onChange={handleFileChange}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="inline-flex h-10 items-center justify-center rounded-md bg-cyan-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={!slot.file || slot.isUploading}
          type="button"
          onClick={onUpload}
        >
          {slot.isUploading ? "Uploading..." : "Upload"}
        </button>
        {slot.file ? <span className="text-sm text-slate-600">{slot.file.name}</span> : null}
      </div>

      {slot.upload ? <UploadReceipt upload={slot.upload} /> : null}
      {slot.error ? <ErrorBanner message={slot.error} /> : null}
    </div>
  );
}

function UploadReceipt({ upload }: { upload: UploadResponse }) {
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
      <div className="grid gap-1 sm:grid-cols-2">
        <p>
          <span className="font-medium">source_file_id:</span> {upload.source_file_id}
        </p>
        <p>
          <span className="font-medium">filename:</span> {upload.filename}
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
  );
}

function ValidationErrors({ errors }: { errors: UploadValidationError[] }) {
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-amber-200 bg-white">
      <table className="min-w-full divide-y divide-amber-100 text-left text-sm">
        <thead className="bg-amber-50 text-amber-950">
          <tr>
            <th className="px-3 py-2 font-semibold">Row</th>
            <th className="px-3 py-2 font-semibold">Field</th>
            <th className="px-3 py-2 font-semibold">Message</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-amber-100">
          {errors.map((error, index) => (
            <tr key={`${error.row ?? "file"}-${error.field ?? "field"}-${index}`}>
              <td className="px-3 py-2">{error.row ?? "file"}</td>
              <td className="px-3 py-2">{error.field ?? "file"}</td>
              <td className="px-3 py-2">{error.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  diagnostics,
  filters,
  run,
  isReconciling,
  onFiltersChange,
  onReviewUpdate,
  reviewUpdatingId,
}: {
  diagnostics: VinPresenceDiagnostics | null;
  filters: ReconciliationRunFilters;
  run: ReconciliationRunDetail | null;
  isReconciling: boolean;
  onFiltersChange: (filters: ReconciliationRunFilters) => void;
  onReviewUpdate: (exceptionId: number, update: ReconciliationExceptionReviewUpdate) => void;
  reviewUpdatingId: number | null;
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
          <h2 className="text-lg font-semibold text-slate-950">View reconciliation results</h2>
          {run ? (
            <p className="text-sm text-slate-600">
              Run #{run.reconciliation_run_id} from {formatDateTime(run.created_at)}
            </p>
          ) : null}
        </div>
        {exportUrl ? (
          <a
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-700"
            download
            href={exportUrl}
          >
            Export Exceptions CSV
          </a>
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
            <Metric label="Matched" value={run.matched_count} />
            <Metric label="Exceptions" value={run.exception_count} />
            <Metric label="Duplicates" value={run.duplicate_count} />
            <Metric label="Run ID" value={run.reconciliation_run_id} />
          </div>

          <ExceptionBreakdown run={run} />
          <VinPresenceDiagnosticsPanel diagnostics={diagnostics} />
          <MatchGroupsTable run={run} />
          <ExceptionsTable
            filters={filters}
            run={run}
            onFiltersChange={onFiltersChange}
            onReviewUpdate={onReviewUpdate}
            reviewUpdatingId={reviewUpdatingId}
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
        <h3 className="text-base font-semibold text-slate-950">Exception breakdown</h3>
        <p className="mt-1 text-sm text-slate-600">
          BOA-only rows are missing in Dealertrack; Dealertrack-only rows are missing in BOA.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="BOA-only exceptions" value={breakdown.boaOnly} />
        <Metric label="Dealertrack-only exceptions" value={breakdown.dealertrackOnly} />
        <Metric label="Duplicate exceptions" value={breakdown.duplicates} />
      </div>
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
}: {
  filters: ReconciliationRunFilters;
  run: ReconciliationRunDetail;
  onFiltersChange: (filters: ReconciliationRunFilters) => void;
  onReviewUpdate: (
    exceptionId: number,
    update: ReconciliationExceptionReviewUpdate,
  ) => void;
  reviewUpdatingId: number | null;
}) {
  const exportUrl = getReconciliationExceptionsCsvUrl(run.reconciliation_run_id, filters);
  const categoryCounts = getExceptionCategoryCounts(run);
  const reviewStatusCounts = getReviewStatusCounts(run);

  return (
    <div className="grid gap-2">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">Exceptions</h3>
          <p className="mt-1 text-sm text-slate-600">
            Showing {run.exceptions.length} of {run.exception_count}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {reviewStatusCounts.map(([status, count]) => (
              <span className={reviewStatusBadgeClassName(status)} key={status}>
                {formatReason(status)}: {count}
              </span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {categoryCounts.length === 0 ? (
              <span className="text-sm text-slate-600">No unresolved exception categories.</span>
            ) : (
              categoryCounts.map(([category, count]) => (
                <span className={categoryBadgeClassName(category)} key={category}>
                  {formatReason(category)}: {count}
                </span>
              ))
            )}
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
              <option value="missing_in_dealertrack">Missing in Dealertrack</option>
              <option value="missing_in_boa">Missing in BOA</option>
              <option value="duplicate_transaction">Duplicate</option>
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
            Export Exceptions CSV
          </a>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Review</th>
              <th className="px-3 py-2 font-semibold">Assigned</th>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold">Stock</th>
              <th className="px-3 py-2 font-semibold">VIN</th>
              <th className="px-3 py-2 font-semibold">Amount</th>
              <th className="px-3 py-2 font-semibold">Reason</th>
              <th className="px-3 py-2 font-semibold">Note</th>
              <th className="px-3 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {run.exceptions.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-slate-600" colSpan={11}>
                  No exceptions.
                </td>
              </tr>
            ) : (
              run.exceptions.map((exception) => (
                <tr
                  className={exceptionRowClassName(exception.status, exception.reason)}
                  key={exception.exception_id}
                >
                  <td className="px-3 py-2 font-medium">
                    <div className="flex flex-col gap-1">
                      <span>{formatReason(exception.exception_type)}</span>
                      {exception.status === "unresolved" ? (
                        <span className={categoryBadgeClassName(exception.exception_category)}>
                          {formatReason(exception.exception_category)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={statusBadgeClassName(exception.status)}>
                      {formatReason(exception.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100 disabled:bg-slate-100"
                      disabled={reviewUpdatingId === exception.exception_id}
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
                      disabled={reviewUpdatingId === exception.exception_id}
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
                  <td className="px-3 py-2">{exception.transaction.vin ?? "n/a"}</td>
                  <td className="px-3 py-2">{formatAmount(exception.transaction)}</td>
                  <td className="px-3 py-2">{exception.reason}</td>
                  <td className="min-w-56 px-3 py-2">
                    <input
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100 disabled:bg-slate-100"
                      defaultValue={exception.review_notes}
                      disabled={reviewUpdatingId === exception.exception_id}
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
                          reviewUpdatingId === exception.exception_id
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
                          reviewUpdatingId === exception.exception_id
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
                <td className="px-3 py-3 text-slate-600" colSpan={9}>
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
                    {run.reconciliation_run_id}
                  </td>
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

function Metric({ label, value }: { label: string; value: number }) {
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function exceptionRowClassName(status: string, reason: string) {
  if (status === "resolved") {
    return "bg-emerald-50 text-emerald-950";
  }
  if (status === "ignored") {
    return "bg-slate-50 text-slate-500";
  }
  return isDuplicateException(reason) ? "bg-amber-50 text-amber-950" : "";
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

function categoryBadgeClassName(category: string) {
  const base = "inline-flex w-fit rounded-md px-2 py-1 text-xs font-semibold";
  if (category === "amount_mismatch" || category === "sign_mismatch") {
    return `${base} bg-red-100 text-red-900`;
  }
  if (category === "possible_timing_issue") {
    return `${base} bg-cyan-100 text-cyan-900`;
  }
  if (category === "duplicate_or_one_to_many") {
    return `${base} bg-amber-100 text-amber-900`;
  }
  if (category === "unclassified") {
    return `${base} bg-slate-200 text-slate-700`;
  }
  return `${base} bg-violet-100 text-violet-900`;
}

function isDuplicateException(reason: string) {
  return reason.toLowerCase().includes("duplicate");
}

function getExceptionBreakdown(run: ReconciliationRunDetail) {
  return run.exceptions.reduce(
    (totals, exception) => {
      if (exception.exception_type === "missing_in_dealertrack") {
        totals.boaOnly += 1;
      } else if (exception.exception_type === "missing_in_boa") {
        totals.dealertrackOnly += 1;
      } else if (
        exception.exception_type === "duplicate_transaction" ||
        isDuplicateException(exception.reason)
      ) {
        totals.duplicates += 1;
      }
      return totals;
    },
    { boaOnly: 0, dealertrackOnly: 0, duplicates: 0 },
  );
}

function getExceptionCategoryCounts(run: ReconciliationRunDetail) {
  const counts = new Map<string, number>();
  for (const exception of run.exceptions) {
    if (exception.review_status === "resolved" || exception.review_status === "ignored") {
      continue;
    }
    counts.set(exception.exception_category, (counts.get(exception.exception_category) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
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
