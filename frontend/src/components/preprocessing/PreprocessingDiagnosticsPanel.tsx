import { useMemo, useState } from "react";

import type {
  PreprocessingDiagnostic,
  SourceType,
  UploadPreprocessingMetadata,
} from "../../types/sourceFile";
import {
  computeHeadlineMetrics,
  describeAmountColumnChoice,
  groupDiagnostics,
  labelForKind,
  type DiagnosticGroup,
  type DiagnosticHeadlineMetrics,
} from "./groupDiagnostics";
import { canRepairVinForDiagnosticKind } from "./vinEnrichmentMatching";
import { VinEnrichmentModal } from "./VinEnrichmentModal";

type Props = {
  preprocessing: UploadPreprocessingMetadata | null | undefined;
  /** "BOA" / "Dealertrack" — used in the heading. */
  sourceLabel: string;
  /** Source file id corresponding to this preprocessing run. */
  sourceFileId?: number | null;
  /** Source type for the upload (used to gate the repair action). */
  sourceType?: SourceType | null;
  /** Notifies the parent that the user successfully enriched a VIN. */
  onVinEnriched?: () => void;
};

export function PreprocessingDiagnosticsPanel({
  preprocessing,
  sourceLabel,
  sourceFileId = null,
  sourceType = null,
  onVinEnriched,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!preprocessing) {
    return null;
  }

  if (preprocessing.unsupported_reason) {
    return (
      <section className="forge-notice forge-notice-danger">
        <h4 className="text-sm font-semibold">{sourceLabel} upload could not be processed</h4>
        <p className="mt-1">{preprocessing.unsupported_reason}</p>
        <FormatLine preprocessing={preprocessing} />
      </section>
    );
  }

  if (preprocessing.legacy_csv_path) {
    return (
      <section className="forge-notice forge-notice-info">
        <h4 className="text-sm font-semibold text-slate-950">
          {sourceLabel} upload processed (legacy CSV path)
        </h4>
        <p className="mt-1">
          File came in as plain CSV, so the preprocessing trust panel is not available for this
          upload. Reconciliation will still run.
        </p>
        <FormatLine preprocessing={preprocessing} />
      </section>
    );
  }

  const metrics = computeHeadlineMetrics(preprocessing);
  const groups = groupDiagnostics(preprocessing.diagnostics ?? []);
  const amountColumnNote = describeAmountColumnChoice(preprocessing);
  const canRepairVin = sourceType === "dealertrack" && typeof sourceFileId === "number";

  return (
    <section className="forge-panel forge-panel-muted grid gap-3 text-sm text-slate-800">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left transition hover:bg-white/60"
        type="button"
      >
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-semibold text-slate-950">
            What the system did with this {sourceLabel} file
          </h4>
          <p className="forge-copy">
            {isExpanded ? "Click to collapse details" : "Click to expand preprocessing details"}
          </p>
        </div>
        <svg
          className={`h-5 w-5 flex-shrink-0 text-slate-600 transition-transform ${isExpanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded ? (
        <div className="grid gap-3 px-3 pb-3">
          <FormatLine preprocessing={preprocessing} />
          <HeadlineMetrics metrics={metrics} />

          {amountColumnNote ? (
            <div className="forge-task-band text-sm font-medium text-slate-800">
              {amountColumnNote}
            </div>
          ) : null}

          <div className="grid gap-3">
            {groups.map((group) => (
              <DiagnosticGroupCard
                group={group}
                key={group.id}
                repairSourceFileId={canRepairVin ? sourceFileId : null}
                onVinEnriched={onVinEnriched}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="px-3 pb-3">
          <HeadlineMetrics metrics={metrics} />
        </div>
      )}
    </section>
  );
}

function FormatLine({ preprocessing }: { preprocessing: UploadPreprocessingMetadata }) {
  return (
    <p className="text-xs text-slate-600">
      Detected format: <span className="font-mono">{preprocessing.detected_format}</span>{" "}
      ({preprocessing.detection_confidence}). Parser route:{" "}
      <span className="font-mono">{preprocessing.parser_route}</span>.
      {preprocessing.detection_reason ? ` ${preprocessing.detection_reason}` : ""}
    </p>
  );
}

function HeadlineMetrics({ metrics }: { metrics: DiagnosticHeadlineMetrics }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <MetricChip label="Rows scanned" value={metrics.rows_scanned ?? "—"} />
      <MetricChip label="Rows accepted" value={metrics.rows_accepted ?? "—"} tone="positive" />
      <MetricChip label="Rows removed" value={metrics.rows_removed_total ?? "—"} tone="calm" />
      <MetricChip
        label="Need manual VIN"
        value={metrics.rows_requiring_manual_enrichment}
        tone={metrics.rows_requiring_manual_enrichment > 0 ? "urgent" : "neutral"}
      />
      <MetricChip
        label="Straightline removed"
        value={metrics.rows_removed_straightline ?? "—"}
        tone="calm"
      />
      <MetricChip
        label="Zero-balance removed"
        value={metrics.rows_removed_zero_balance ?? "—"}
        tone="calm"
      />
      <MetricChip
        label="Dirty/untrusted VIN"
        value={metrics.untrusted_vin_count}
        tone={metrics.untrusted_vin_count > 0 ? "attention" : "neutral"}
      />
      <MetricChip
        label="Duplicate VIN6"
        value={metrics.duplicate_vin6_count ?? "—"}
        tone={
          metrics.duplicate_vin6_count && metrics.duplicate_vin6_count > 0 ? "attention" : "neutral"
        }
      />
    </div>
  );
}

function MetricChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "positive" | "calm" | "attention" | "urgent";
}) {
  const toneClass =
    tone === "urgent"
      ? "border-red-300 bg-red-50 text-red-900"
      : tone === "attention"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : tone === "positive"
          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
          : tone === "calm"
            ? "border-slate-300 bg-white text-slate-700"
            : "border-slate-300 bg-white text-slate-800";
  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function DiagnosticGroupCard({
  group,
  repairSourceFileId,
  onVinEnriched,
}: {
  group: DiagnosticGroup;
  repairSourceFileId: number | null;
  onVinEnriched?: () => void;
}) {
  const toneClass =
    group.tone === "urgent"
      ? "border-red-300 bg-red-50"
      : group.tone === "attention"
        ? "border-amber-300 bg-amber-50"
        : group.tone === "calm"
          ? "border-slate-200 bg-white"
          : "border-slate-200 bg-white";
  const headingClass =
    group.tone === "urgent"
      ? "text-red-950"
      : group.tone === "attention"
        ? "text-amber-950"
        : "text-slate-950";
  const isEmphasized = group.tone === "urgent" && group.diagnostics.length > 0;

  return (
    <section
      className={`rounded-md border p-3 ${toneClass} ${
        isEmphasized ? "ring-2 ring-red-300" : ""
      }`}
      data-testid={`diagnostic-group-${group.id}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h5 className={`text-sm font-semibold ${headingClass}`}>
          {group.title}
          <span className="ml-2 text-xs font-medium text-slate-600">
            {group.diagnostics.length}
          </span>
        </h5>
      </div>
      <p className="mt-1 text-xs text-slate-600">{group.blurb}</p>
      {group.diagnostics.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">None.</p>
      ) : (
        <DiagnosticList
          diagnostics={group.diagnostics}
          repairSourceFileId={repairSourceFileId}
          onVinEnriched={onVinEnriched}
        />
      )}
    </section>
  );
}

function DiagnosticList({
  diagnostics,
  repairSourceFileId,
  onVinEnriched,
}: {
  diagnostics: PreprocessingDiagnostic[];
  repairSourceFileId: number | null;
  onVinEnriched?: () => void;
}) {
  const PREVIEW_COUNT = 6;
  const preview = diagnostics.slice(0, PREVIEW_COUNT);
  const remaining = diagnostics.slice(PREVIEW_COUNT);

  return (
    <div className="mt-2 grid gap-2">
      <ul className="grid gap-1">
        {preview.map((diagnostic, index) => (
          <DiagnosticRow
            diagnostic={diagnostic}
            key={`${diagnostic.kind}-${index}`}
            repairSourceFileId={repairSourceFileId}
            onVinEnriched={onVinEnriched}
          />
        ))}
      </ul>
      {remaining.length > 0 ? (
        <details className="forge-panel px-3 py-2">
          <summary className="forge-summary text-xs">
            Show {remaining.length} more
          </summary>
          <ul className="mt-2 grid gap-1">
            {remaining.map((diagnostic, index) => (
              <DiagnosticRow
                diagnostic={diagnostic}
                key={`extra-${diagnostic.kind}-${index}`}
                repairSourceFileId={repairSourceFileId}
                onVinEnriched={onVinEnriched}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function DiagnosticRow({
  diagnostic,
  repairSourceFileId,
  onVinEnriched,
}: {
  diagnostic: PreprocessingDiagnostic;
  repairSourceFileId: number | null;
  onVinEnriched?: () => void;
}) {
  const canRepair =
    repairSourceFileId !== null &&
    canRepairVinForDiagnosticKind(diagnostic.kind) &&
    diagnostic.source_row_number !== null;
  const rowLabel =
    diagnostic.source_row_number === null
      ? "File-level"
      : `Row ${diagnostic.source_row_number}`;
  return (
    <li className="rounded-sm bg-white px-3 py-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="inline-flex rounded-sm bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
          {rowLabel}
        </span>
        <span className="text-xs font-semibold uppercase text-slate-500">
          {labelForKind(diagnostic.kind)}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-800">{diagnostic.message}</p>
      {diagnostic.vin6 || diagnostic.stock_number ? (
        <p className="mt-1 text-xs text-slate-600">
          {diagnostic.stock_number ? <>Stock: {diagnostic.stock_number}</> : null}
          {diagnostic.stock_number && diagnostic.vin6 ? " / " : null}
          {diagnostic.vin6 ? <>VIN6: {diagnostic.vin6}</> : null}
        </p>
      ) : null}
      {canRepair && repairSourceFileId !== null ? (
        <RepairVinButton
          diagnostic={diagnostic}
          sourceFileId={repairSourceFileId}
          onVinEnriched={onVinEnriched}
        />
      ) : null}
    </li>
  );
}

function RepairVinButton({
  diagnostic,
  sourceFileId,
  onVinEnriched,
}: {
  diagnostic: PreprocessingDiagnostic;
  sourceFileId: number;
  onVinEnriched?: () => void;
}) {
  const initial = useMemo(
    () => ({
      sourceRowNumber: diagnostic.source_row_number,
      stockNumber: diagnostic.stock_number ?? null,
      currentVin6: diagnostic.vin6 ?? null,
    }),
    [diagnostic],
  );
  return (
    <VinEnrichmentModal
      sourceFileId={sourceFileId}
      sourceRowNumber={initial.sourceRowNumber}
      stockNumber={initial.stockNumber}
      currentVin6={initial.currentVin6}
      currentVinStatus={describeVinStatus(diagnostic.kind)}
      onSuccess={onVinEnriched}
    />
  );
}

function describeVinStatus(kind: PreprocessingDiagnostic["kind"]): string {
  if (kind === "untrusted_vin") {
    return "Untrusted / dirty VIN";
  }
  if (kind === "manual_enrichment_required") {
    return "Needs manual VIN enrichment";
  }
  return "Needs VIN review";
}
