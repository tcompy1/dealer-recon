import { type ChangeEvent, useEffect, useMemo, useState } from "react";

import {
  getReconciliationRun,
  listReconciliationRuns,
  reconcileSourceFiles,
} from "../api/reconciliation";
import { listSourceFiles, uploadSourceFile } from "../api/uploads";
import type {
  ReconciledTransaction,
  ReconciliationRunDetail,
  ReconciliationRunListItem,
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
  const [isReconciling, setIsReconciling] = useState(false);
  const [historyLoadingId, setHistoryLoadingId] = useState<number | null>(null);
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
      const detail = await getReconciliationRun(result.reconciliation_run_id);
      setActiveRun(detail);
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
      setActiveRun(await getReconciliationRun(reconciliationRunId));
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Run detail could not be loaded.");
    } finally {
      setHistoryLoadingId(null);
    }
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate-950">Upload source files</h2>
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

      <ResultsSection run={activeRun} isReconciling={isReconciling} />

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
  run,
  isReconciling,
}: {
  run: ReconciliationRunDetail | null;
  isReconciling: boolean;
}) {
  if (!run && !isReconciling) {
    return null;
  }

  return (
    <section className="grid gap-5 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-950">Results</h2>
        {run ? (
          <p className="text-sm text-slate-600">
            Run #{run.reconciliation_run_id} from {formatDateTime(run.created_at)}
          </p>
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

          <MatchGroupsTable run={run} />
          <ExceptionsTable run={run} />
        </>
      ) : null}
    </section>
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

function ExceptionsTable({ run }: { run: ReconciliationRunDetail }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-base font-semibold text-slate-950">Exceptions</h3>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold">Stock</th>
              <th className="px-3 py-2 font-semibold">VIN</th>
              <th className="px-3 py-2 font-semibold">Amount</th>
              <th className="px-3 py-2 font-semibold">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {run.exceptions.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-slate-600" colSpan={6}>
                  No exceptions.
                </td>
              </tr>
            ) : (
              run.exceptions.map((exception) => (
                <tr
                  className={
                    isDuplicateException(exception.reason) ? "bg-amber-50 text-amber-950" : ""
                  }
                  key={exception.exception_id}
                >
                  <td className="px-3 py-2 font-medium">
                    {isDuplicateException(exception.reason) ? "Duplicate" : "Exception"}
                  </td>
                  <td className="px-3 py-2">{exception.source_type.toUpperCase()}</td>
                  <td className="px-3 py-2">{exception.transaction.stock_number ?? "n/a"}</td>
                  <td className="px-3 py-2">{exception.transaction.vin ?? "n/a"}</td>
                  <td className="px-3 py-2">{formatAmount(exception.transaction)}</td>
                  <td className="px-3 py-2">{exception.reason}</td>
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

function isDuplicateException(reason: string) {
  return reason.toLowerCase().includes("duplicate");
}
