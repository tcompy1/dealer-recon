import { useEffect, useState, type FormEvent } from "react";

import {
  applyVinEnrichment,
  listSourceFileTransactions,
  type SourceFileTransaction,
  type VinEnrichmentSource,
} from "../../api/vinEnrichment";
import {
  matchDiagnosticToTransaction,
  UNSAFE_DIAGNOSTIC_MATCH_MESSAGE,
} from "./vinEnrichmentMatching";

const VIN_FULL_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

type Props = {
  sourceFileId: number;
  sourceRowNumber: number | null;
  stockNumber: string | null;
  currentVin6: string | null;
  currentVinStatus: string;
  onSuccess?: () => void;
};

export function VinEnrichmentModal({
  sourceFileId,
  sourceRowNumber,
  stockNumber,
  currentVin6,
  currentVinStatus,
  onSuccess,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [vin, setVin] = useState("");
  const [source, setSource] = useState<VinEnrichmentSource>("manual_enrichment");
  const [reason, setReason] = useState("");
  const [dmsReference, setDmsReference] = useState("");
  const [transactions, setTransactions] = useState<SourceFileTransaction[] | null>(null);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let cancelled = false;
    setTransactionsError(null);
    listSourceFileTransactions(sourceFileId)
      .then((rows) => {
        if (!cancelled) {
          setTransactions(rows);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTransactionsError(
            error instanceof Error ? error.message : "Could not load transactions.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, sourceFileId]);

  const matchResult = transactions
    ? matchDiagnosticToTransaction(transactions, sourceRowNumber, stockNumber)
    : null;
  const matchedTransaction =
    matchResult && matchResult.status === "matched" ? matchResult.transaction : null;
  const isMatchUnsafe = matchResult !== null && matchResult.status !== "matched";
  const trimmedVin = vin.trim().toUpperCase();
  const isVinValid = VIN_FULL_RE.test(trimmedVin);
  const isReasonProvided = reason.trim().length > 0;

  function close() {
    setIsOpen(false);
    setSubmitError(null);
    setSuccessMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    if (!matchedTransaction) {
      setSubmitError(UNSAFE_DIAGNOSTIC_MATCH_MESSAGE);
      return;
    }
    if (!isVinValid) {
      setSubmitError("VIN must be 17 alphanumeric characters (no I, O, or Q).");
      return;
    }
    if (!isReasonProvided) {
      setSubmitError("A reason is required.");
      return;
    }
    setIsSubmitting(true);
    try {
      await applyVinEnrichment(matchedTransaction.id, {
        vin: trimmedVin,
        source,
        reason: reason.trim(),
        dms_reference: dmsReference.trim() || null,
      });
      setSuccessMessage(
        "VIN repaired. Re-run reconciliation to apply the corrected VIN.",
      );
      onSuccess?.();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to apply VIN repair.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return (
      <div className="mt-2">
        <button
          type="button"
          className="inline-flex items-center rounded-md border border-cyan-300 bg-white px-2.5 py-1 text-xs font-semibold text-cyan-800 shadow-sm hover:bg-cyan-50"
          onClick={() => {
            setIsOpen(true);
            setSuccessMessage(null);
          }}
        >
          Repair VIN
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Repair VIN"
    >
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-950">Repair VIN</h3>
            <p className="text-xs text-slate-600">
              Manual VIN enrichment for a Dealertrack row. Reconciliation will not auto-rerun.
            </p>
          </div>
          <button
            type="button"
            className="text-sm font-semibold text-slate-500 hover:text-slate-900"
            onClick={close}
          >
            ✕
          </button>
        </header>

        <dl className="mt-4 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <div className="flex justify-between gap-2">
            <dt className="font-semibold">Source row</dt>
            <dd>{sourceRowNumber ?? "n/a"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="font-semibold">Stock / control</dt>
            <dd>{stockNumber ?? "n/a"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="font-semibold">Current VIN6</dt>
            <dd>{currentVin6 ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="font-semibold">Current status</dt>
            <dd>{currentVinStatus}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="font-semibold">Matched transaction id</dt>
            <dd>
              {matchedTransaction
                ? matchedTransaction.id
                : transactions === null
                  ? "loading…"
                  : "not safely identified"}
            </dd>
          </div>
        </dl>

        {transactionsError ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900">
            {transactionsError}
          </p>
        ) : null}

        {isMatchUnsafe ? (
          <p
            className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900"
            data-testid="unsafe-match-notice"
          >
            {UNSAFE_DIAGNOSTIC_MATCH_MESSAGE}
          </p>
        ) : null}

        {successMessage ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            {successMessage}
          </div>
        ) : null}

        {!successMessage ? (
          <form className="mt-4 grid gap-3" onSubmit={handleSubmit}>
            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-slate-800">Corrected VIN (17 chars)</span>
              <input
                type="text"
                value={vin}
                maxLength={17}
                onChange={(event) => setVin(event.target.value.toUpperCase())}
                className="rounded-md border border-slate-300 px-2 py-1 font-mono uppercase"
                aria-invalid={vin.length > 0 && !isVinValid}
                data-testid="vin-input"
              />
              {vin.length > 0 && !isVinValid ? (
                <span className="text-xs text-red-700" data-testid="vin-error">
                  VIN must be 17 alphanumeric characters (no I, O, or Q).
                </span>
              ) : null}
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-slate-800">Source</span>
              <select
                value={source}
                onChange={(event) => setSource(event.target.value as VinEnrichmentSource)}
                className="rounded-md border border-slate-300 px-2 py-1"
                data-testid="source-select"
              >
                <option value="manual_enrichment">Manual entry (clerk)</option>
                <option value="dms_assisted_reconstruction">DMS-assisted</option>
                <option value="stock_number_lookup">Stock number lookup</option>
              </select>
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-slate-800">Reason / note</span>
              <textarea
                value={reason}
                rows={3}
                onChange={(event) => setReason(event.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1"
                data-testid="reason-input"
                placeholder="What did you verify, and where?"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-slate-800">DMS reference (optional)</span>
              <input
                type="text"
                value={dmsReference}
                onChange={(event) => setDmsReference(event.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1"
                placeholder="e.g. Reynolds deal #123"
              />
            </label>

            {submitError ? (
              <p
                className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900"
                data-testid="submit-error"
              >
                {submitError}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  !isVinValid ||
                  !isReasonProvided ||
                  matchedTransaction === null
                }
                className="rounded-md bg-cyan-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isSubmitting ? "Applying…" : "Apply VIN repair"}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={close}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

