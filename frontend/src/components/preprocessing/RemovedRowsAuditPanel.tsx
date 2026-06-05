/**
 * RemovedRowsAuditPanel
 *
 * Displays every row excluded from a source file during preprocessing so the
 * accounting user can confirm the system removed exactly what was expected.
 * Every transformation is auditable — nothing is dropped silently.
 */

import type { RemovedRow, UploadPreprocessingMetadata } from "../../types/sourceFile";

type Props = {
  boaPreprocessing: UploadPreprocessingMetadata | null | undefined;
  dealertrackPreprocessing: UploadPreprocessingMetadata | null | undefined;
};

export function RemovedRowsAuditPanel({ boaPreprocessing, dealertrackPreprocessing }: Props) {
  const boaRows = boaPreprocessing?.removed_rows ?? [];
  const dtRows = dealertrackPreprocessing?.removed_rows ?? [];
  const totalRemoved = boaRows.length + dtRows.length;

  if (totalRemoved === 0 && !boaPreprocessing && !dealertrackPreprocessing) {
    return null;
  }

  return (
    <section className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-950">Removed rows audit</h2>
        <p className="text-sm text-slate-600">
          Every row excluded from this upload is listed below with its source file, original row
          number, and the reason it was removed. Use this to confirm the system handled each file the
          same way you would.
        </p>
      </div>

      {totalRemoved === 0 ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
          No rows were removed — all rows in both files passed validation.
        </p>
      ) : (
        <div className="grid gap-4">
          {boaRows.length > 0 && (
            <RemovedRowsTable
              label="BOA"
              rows={boaRows}
            />
          )}
          {dtRows.length > 0 && (
            <RemovedRowsTable
              label="Dealertrack"
              rows={dtRows}
            />
          )}
        </div>
      )}
    </section>
  );
}

function RemovedRowsTable({ label, rows }: { label: string; rows: RemovedRow[] }) {
  const PREVIEW = 10;
  const preview = rows.slice(0, PREVIEW);
  const overflow = rows.slice(PREVIEW);

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline gap-3">
        <h3 className="text-sm font-semibold text-slate-950">{label} removed rows</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
          {rows.length}
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Row #</th>
              <th className="px-3 py-2 font-semibold">Removal reason</th>
              <th className="px-3 py-2 font-semibold">Key values</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {preview.map((row, index) => (
              <RemovedRowTableRow key={index} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      {overflow.length > 0 && (
        <details className="rounded-md border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">
            Show {overflow.length} more removed {label} rows
          </summary>
          <div className="overflow-x-auto border-t border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <tbody className="divide-y divide-slate-200 bg-white">
                {overflow.map((row, index) => (
                  <RemovedRowTableRow key={`overflow-${index}`} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function RemovedRowTableRow({ row }: { row: RemovedRow }) {
  const rowLabel =
    row.source_row_number !== null ? `Row ${row.source_row_number}` : "File-level";

  // Build a concise key-values display, excluding the verbose "message" field
  // unless it is the only value available.
  const keyEntries = Object.entries(row.key_values).filter(
    ([key]) => key !== "message",
  );
  const displayEntries =
    keyEntries.length > 0 ? keyEntries : Object.entries(row.key_values).slice(0, 3);

  return (
    <tr className="align-top">
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-700">{rowLabel}</td>
      <td className="px-3 py-2 text-slate-800">{row.removal_reason}</td>
      <td className="px-3 py-2">
        {displayEntries.length > 0 ? (
          <dl className="flex flex-wrap gap-x-4 gap-y-0.5">
            {displayEntries.map(([key, value]) => (
              <div key={key} className="flex gap-1 text-xs">
                <dt className="font-semibold text-slate-600">{key}:</dt>
                <dd className="font-mono text-slate-800">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <span className="text-xs text-slate-500">—</span>
        )}
      </td>
    </tr>
  );
}
