import type { PreprocessingDiagnosticKind } from "../../types/sourceFile";

/**
 * Diagnostic kinds that should expose the "Repair VIN" affordance.
 *
 * Why: Phase 1 limits manual VIN enrichment to rows that actually need
 * VIN repair. `duplicate_vin` and `manual_enrichment_applied` describe
 * file-level state that does not require clerk VIN entry and are
 * intentionally excluded.
 */
const VIN_REPAIR_KINDS: ReadonlySet<PreprocessingDiagnosticKind> = new Set<PreprocessingDiagnosticKind>([
  "untrusted_vin",
  "manual_enrichment_required",
]);

export function canRepairVinForDiagnosticKind(kind: PreprocessingDiagnosticKind): boolean {
  return VIN_REPAIR_KINDS.has(kind);
}

export type DiagnosticTransactionCandidate = {
  id: number;
  stock_number: string | null;
  source_row_number: number | null;
};

export type DiagnosticMatchResult =
  | { status: "matched"; transaction: DiagnosticTransactionCandidate }
  | { status: "ambiguous" }
  | { status: "not_found" };

/**
 * Resolve a preprocessing diagnostic to its underlying transaction.
 *
 * Phase 1 contract:
 *   1. Prefer exact match on `source_row_number` (unique per file).
 *   2. Fall back to `stock_number` only when exactly one transaction
 *      in the source file carries that stock number.
 *   3. Zero or multiple candidates → ambiguous; caller must block submit.
 */
export function matchDiagnosticToTransaction(
  transactions: ReadonlyArray<DiagnosticTransactionCandidate>,
  sourceRowNumber: number | null,
  stockNumber: string | null,
): DiagnosticMatchResult {
  if (sourceRowNumber !== null) {
    const byRow = transactions.find(
      (transaction) => transaction.source_row_number === sourceRowNumber,
    );
    if (byRow) {
      return { status: "matched", transaction: byRow };
    }
  }
  if (stockNumber) {
    const normalized = stockNumber.toLowerCase();
    const stockMatches = transactions.filter(
      (transaction) =>
        transaction.stock_number !== null &&
        transaction.stock_number.toLowerCase() === normalized,
    );
    if (stockMatches.length === 1) {
      return { status: "matched", transaction: stockMatches[0] };
    }
    if (stockMatches.length > 1) {
      return { status: "ambiguous" };
    }
  }
  return { status: "not_found" };
}

export const UNSAFE_DIAGNOSTIC_MATCH_MESSAGE =
  "Could not safely identify the transaction for this diagnostic row.";
