import { useState } from "react";

import { runReconciliation } from "../api/reconciliation";
import type { ReconciliationResponse } from "../types/reconciliation";

export function ReconciliationSummary() {
  const [result, setResult] = useState<ReconciliationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);

  async function handleReconcile() {
    setError(null);
    setIsReconciling(true);

    try {
      setResult(await runReconciliation());
    } catch (reconciliationError) {
      setError(
        reconciliationError instanceof Error
          ? reconciliationError.message
          : "Reconciliation failed.",
      );
    } finally {
      setIsReconciling(false);
    }
  }

  return (
    <section className="w-full max-w-5xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-normal text-slate-950">
            BOA / Dealertrack reconciliation
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Matches by VIN first, then stock number plus absolute amount, then lower-confidence
            amount and context.
          </p>
        </div>

        <button
          className="inline-flex h-11 items-center justify-center rounded-md bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={isReconciling}
          type="button"
          onClick={handleReconcile}
        >
          {isReconciling ? "Reconciling..." : "Run reconciliation"}
        </button>
      </div>

      {result ? (
        <div className="mt-6 grid gap-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Matched" value={result.matched_count} />
            <Metric label="Exceptions" value={result.exception_count} />
            <Metric label="Duplicates" value={result.duplicate_count} />
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Matched items
            </h3>
            <div className="mt-3 grid gap-3">
              {result.match_groups.map((group, index) => (
                <div
                  className="rounded-md border border-slate-200 bg-slate-50 p-4"
                  key={`${group.match_reason}-${index}`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded bg-cyan-100 px-2 py-1 font-medium text-cyan-900">
                      {formatReason(group.match_reason)}
                    </span>
                    <span className="text-slate-500">
                      Confidence {Math.round(group.confidence_score * 100)}%
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {group.transactions.map((transaction) => (
                      <TransactionLine key={transaction.id} transaction={transaction} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Exceptions
            </h3>
            <div className="mt-3 grid gap-2">
              {result.exceptions.map((exception, index) => (
                <div
                  className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
                  key={`${exception.exception_type}-${exception.transaction.id}-${index}`}
                >
                  <p className="font-semibold">{formatReason(exception.exception_type)}</p>
                  <p className="mt-1 text-amber-900">{exception.description}</p>
                  <p className="mt-2 text-amber-900">
                    {exception.source_type.toUpperCase()} stock{" "}
                    {exception.transaction.stock_number ?? "n/a"} amount{" "}
                    {formatAmount(exception.transaction.amount)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-950">
          {error}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function TransactionLine({
  transaction,
}: {
  transaction: ReconciliationResponse["match_groups"][number]["transactions"][number];
}) {
  return (
    <div className="rounded-md bg-white p-3 text-sm text-slate-700">
      <p className="font-semibold text-slate-950">{transaction.source_type.toUpperCase()}</p>
      <p className="mt-1">Stock {transaction.stock_number ?? "n/a"}</p>
      <p>VIN {transaction.vin ?? "n/a"}</p>
      <p>Amount {formatAmount(transaction.amount)}</p>
    </div>
  );
}

function formatReason(value: string) {
  return value.replace(/_/g, " ");
}

function formatAmount(value: string | number) {
  return Number(value).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}
