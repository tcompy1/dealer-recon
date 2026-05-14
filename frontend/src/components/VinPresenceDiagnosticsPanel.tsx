import type { VinPresenceDiagnostics, VinPresenceTransactionUnmatchedEntry } from "../types/reconciliation";

export function VinPresenceDiagnosticsPanel({
  diagnostics,
}: {
  diagnostics: VinPresenceDiagnostics | null;
}) {
  const dealertrackOnly = diagnostics?.vin_presence_exceptions.dealertrack_not_in_boa ?? [];
  const boaOnly = diagnostics?.vin_presence_exceptions.boa_not_in_dealertrack ?? [];
  const sharedUnmatched = diagnostics?.transaction_unmatched_shared_vins ?? [];

  return (
    <div className="grid gap-3">
      <div>
        <h3 className="text-base font-semibold text-slate-950">VIN Presence Diagnostics</h3>
        <p className="mt-1 text-sm text-slate-600">
          VIN presence checks compare extracted VINs only, before transaction matching rules are applied.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <DiagnosticMetric label="Dealertrack VINs not found in BOA" value={dealertrackOnly.length} />
        <DiagnosticMetric label="BOA VINs not found in Dealertrack" value={boaOnly.length} />
        <DiagnosticMetric
          label="VINs found in both systems but not transaction-matched"
          value={sharedUnmatched.length}
        />
      </div>

      <div className="grid gap-3">
        <VinListDisclosure
          label="Dealertrack VINs not found in BOA"
          vins={dealertrackOnly}
        />
        <VinListDisclosure label="BOA VINs not found in Dealertrack" vins={boaOnly} />
        <SharedUnmatchedDisclosure entries={sharedUnmatched} />
      </div>
    </div>
  );
}

function DiagnosticMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function VinListDisclosure({ label, vins }: { label: string; vins: string[] }) {
  return (
    <details className="rounded-md border border-slate-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-950">
        {label} ({vins.length})
      </summary>
      <div className="border-t border-slate-200 px-4 py-3">
        {vins.length === 0 ? (
          <p className="text-sm text-slate-600">None</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {vins.map((vin) => (
              <span
                className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-800"
                key={vin}
              >
                {vin}
              </span>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function SharedUnmatchedDisclosure({
  entries,
}: {
  entries: VinPresenceTransactionUnmatchedEntry[];
}) {
  return (
    <details className="rounded-md border border-slate-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-950">
        VINs found in both systems but not transaction-matched ({entries.length})
      </summary>
      <div className="border-t border-slate-200">
        {entries.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-600">None</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-semibold">VIN</th>
                  <th className="px-3 py-2 font-semibold">Likely reason</th>
                  <th className="px-3 py-2 font-semibold">BOA ids</th>
                  <th className="px-3 py-2 font-semibold">Dealertrack ids</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {entries.map((entry) => (
                  <tr key={entry.vin}>
                    <td className="px-3 py-2 font-mono text-xs text-slate-800">{entry.vin}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {formatDiagnosticReason(entry.likely_reason)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {formatIds(entry.unmatched_boa_transaction_ids, entry.boa_transaction_ids)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {formatIds(
                        entry.unmatched_dealertrack_transaction_ids,
                        entry.dealertrack_transaction_ids,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}

function formatIds(unmatchedIds: number[], allIds: number[]) {
  const ids = unmatchedIds.length > 0 ? unmatchedIds : allIds;
  return ids.length > 0 ? ids.join(", ") : "None";
}

function formatDiagnosticReason(value: string) {
  return value.replace(/_/g, " ");
}
