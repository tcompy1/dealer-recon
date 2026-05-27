import { useMemo } from "react";

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
  if (!preprocessing) {
    return null;
  }

  if (preprocessing.unsupported_reason) {
    return (
      <section className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-950">
        <h4 className="text-sm font-semibold">{sourceLabel} upload could not be processed</h4>
        <p className="mt-1">{preprocessing.unsupported_reason}</p>
        <FormatLine preprocessing={preprocessing} />
      </section>
    );
  }

  if (preprocessing.legacy_csv_path) {
    return (
      <section className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
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
    <section className="grid gap-3 rounded-md border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-950">
      <header className="flex flex-col gap-1">
        <h4 className="text-base font-semibold text-slate-950">
          What the system did with this {sourceLabel} file
        </h4>
        <p className="text-sm text-slate-700">
          Plain-language summary of preprocessing. Use this to confirm the system handled the file
          the way you would have.
        </p>
        <FormatLine preprocessing={preprocessing} />
      </header>

      <HeadlineMetrics metrics={metrics} />

      {amountColumnNote ? (
        <div className="rounded-md border border-cyan-300 bg-white px-3 py-2 text-sm font-medium text-slate-800">
          {amountColumnNote}
        </div>
      ) : null}

      <div className="grid gap-3">
        {groups.map((group) => (
          <DiagnosticGroupCard
            group={group}
            key={group.id}
            sourceFileId={canRepairVin ? sourceFileId : null}
            onVinEnriched={onVinEnriched}
          />
        ))}
      </div>
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
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function DiagnosticGroupCard({
  group,
  sourceFileId,
  onVinEnriched,
}: {
  group: DiagnosticGroup;
  sourceFileId: number | null;
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
          sourceFileId={group.id === "vin_cleanup" ? sourceFileId : null}
          onVinEnriched={onVinEnriched}
        />
      )}
    </section>
  );
}

function DiagnosticList({
  diagnostics,
  sourceFileId,
  onVinEnriched,
}: {
  diagnostics: PreprocessingDiagnostic[];
  sourceFileId: number | null;
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
            sourceFileId={sourceFileId}
            onVinEnriched={onVinEnriched}
          />
        ))}
      </ul>
      {remaining.length > 0 ? (
        <details className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
            Show {remaining.length} more
          </summary>
          <ul className="mt-2 grid gap-1">
            {remaining.map((diagnostic, index) => (
              <DiagnosticRow
                diagnostic={diagnostic}
                key={`extra-${diagnostic.kind}-${index}`}
                sourceFileId={sourceFileId}
                onVinEnriched={onVinEnriched}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

const VIN_CLEANUP_KINDS = new Set([
  "untrusted_vin",
  "duplicate_vin",
  "manual_enrichment_applied",
]);

function DiagnosticRow({
  diagnostic,
  sourceFileId,
  onVinEnriched,
}: {
  diagnostic: PreprocessingDiagnostic;
  sourceFileId: number | null;
  onVinEnriched?: () => void;
}) {
  const canRepair =
    sourceFileId !== null &&
    VIN_CLEANUP_KINDS.has(diagnostic.kind) &&
    diagnostic.source_row_number !== null;
  const rowLabel =
    diagnostic.source_row_number === null
      ? "File-level"
      : `Row ${diagnostic.source_row_number}`;
  return (
    <li className="rounded-md bg-white px-3 py-2 text-sm shadow-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
          {rowLabel}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
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
      {canRepair && sourceFileId !== null ? (
        <RepairVinButton
          diagnostic={diagnostic}
          sourceFileId={sourceFileId}
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
  if (kind === "duplicate_vin") {
    return "Duplicate VIN6 on this file";
  }
  if (kind === "manual_enrichment_applied") {
    return "Manual VIN enrichment already applied";
  }
  return "Needs VIN review";
}
