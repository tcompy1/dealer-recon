import { computeVin6, extractVin6FromDescription } from "../domain/vin6.js";
import type {
  ReconciliationExceptionCarryForward,
  ReconciliationRunDetail,
  SourceType,
} from "../domain/types.js";

export type DetailException = ReconciliationRunDetail["exceptions"][number];

export type PriorExceptionRecord = {
  exception_id: number;
  reconciliation_run_id: number;
  dealership_store_id: number | null;
  source_type: SourceType;
  amount_cents: number;
  vin: string | null;
  stock_number: string | null;
  reference_number: string | null;
  description: string | null;
  boa_notes: string;
  gl_notes: string;
  review_notes: string;
  created_at: string;
};

export type CarryForwardKey = string;

// Stable key used to detect that an unresolved unmatched item from a previous
// run is the same item that has just shown up again. The clerk works one
// dealership/store at a time, so we never match across stores. We prefer
// VIN/VIN6 because that's how the workbook is read; stock number is a strong
// fallback for cases where the parser couldn't extract a VIN; the trailing
// amount_cents prevents two different vehicles at the same descriptor from
// collapsing into one carry-forward chain.
export function buildCarryForwardKey(args: {
  dealership_store_id: number | null;
  source_type: SourceType;
  vin: string | null;
  stock_number: string | null;
  reference_number: string | null;
  description: string | null;
  amount_cents: number;
}): CarryForwardKey | null {
  const side = sideFromSource(args.source_type);
  if (!side) {
    return null;
  }
  const identifier = identifierFor(args);
  if (!identifier) {
    return null;
  }
  const storeKey = args.dealership_store_id === null ? "null" : String(args.dealership_store_id);
  return [storeKey, side, identifier, String(args.amount_cents)].join("|");
}

function sideFromSource(sourceType: SourceType): "boa" | "gl" | null {
  if (sourceType === "boa") {
    return "boa";
  }
  if (sourceType === "dealertrack" || sourceType === "dms" || sourceType === "gl") {
    return "gl";
  }
  return null;
}

function identifierFor(args: {
  vin: string | null;
  stock_number: string | null;
  reference_number: string | null;
  description: string | null;
}): string | null {
  const vin = (args.vin ?? "").trim().toUpperCase();
  if (vin) {
    const vin6 = computeVin6(vin);
    return vin6 ? `vin6:${vin6}` : `vin:${vin}`;
  }
  const stock = (args.stock_number ?? "").trim().toUpperCase();
  if (stock) {
    return `stock:${stock}`;
  }
  const fromDescription = extractVin6FromDescription(args.description);
  if (fromDescription) {
    return `vin6:${fromDescription}`;
  }
  const reference = (args.reference_number ?? "").trim().toUpperCase();
  if (reference) {
    return `ref:${reference}`;
  }
  return null;
}

export function carryForwardKeyForDetailException(
  exception: DetailException,
  dealershipStoreId: number | null,
): CarryForwardKey | null {
  return buildCarryForwardKey({
    dealership_store_id: dealershipStoreId,
    source_type: exception.source_type,
    vin: exception.transaction.vin,
    stock_number: exception.transaction.stock_number,
    reference_number: exception.transaction.reference_number,
    description: exception.transaction.description,
    amount_cents: exception.transaction.amount_cents,
  });
}

export function carryForwardKeyForPrior(
  record: PriorExceptionRecord,
): CarryForwardKey | null {
  return buildCarryForwardKey({
    dealership_store_id: record.dealership_store_id,
    source_type: record.source_type,
    vin: record.vin,
    stock_number: record.stock_number,
    reference_number: record.reference_number,
    description: record.description,
    amount_cents: record.amount_cents,
  });
}

// Groups prior records by carry-forward key. Records should be supplied
// already filtered to a single store and to exceptions that were unresolved at
// the time of their run (status='unresolved'/review_status not 'resolved' or
// 'ignored') and that were not the current run.
export function groupPriorExceptionsByKey(
  priors: PriorExceptionRecord[],
): Map<CarryForwardKey, PriorExceptionRecord[]> {
  const grouped = new Map<CarryForwardKey, PriorExceptionRecord[]>();
  for (const prior of priors) {
    const key = carryForwardKeyForPrior(prior);
    if (!key) {
      continue;
    }
    const list = grouped.get(key) ?? [];
    list.push(prior);
    grouped.set(key, list);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) =>
      left.reconciliation_run_id === right.reconciliation_run_id
        ? left.exception_id - right.exception_id
        : left.reconciliation_run_id - right.reconciliation_run_id,
    );
  }
  return grouped;
}

export function computeCarryForward(
  exception: DetailException,
  dealershipStoreId: number | null,
  priorsByKey: Map<CarryForwardKey, PriorExceptionRecord[]>,
): ReconciliationExceptionCarryForward {
  const key = carryForwardKeyForDetailException(exception, dealershipStoreId);
  const priors = key ? priorsByKey.get(key) ?? [] : [];
  if (priors.length === 0) {
    return {
      carried_forward: false,
      previous_run_id: null,
      previous_exception_id: null,
      first_seen_run_id: null,
      first_seen_at: null,
      last_seen_run_id: null,
      last_seen_at: null,
      occurrence_count: 1,
      prior_boa_notes: "",
      prior_gl_notes: "",
    };
  }
  const firstSeen = priors[0];
  const lastSeen = priors[priors.length - 1];
  const priorBoaNotes = priors
    .map((prior) => prior.boa_notes || (prior.source_type === "boa" ? prior.review_notes : ""))
    .filter((value) => value && value.trim().length > 0);
  const priorGlNotes = priors
    .map((prior) =>
      prior.gl_notes ||
      (prior.source_type === "dealertrack" || prior.source_type === "dms" || prior.source_type === "gl"
        ? prior.review_notes
        : ""),
    )
    .filter((value) => value && value.trim().length > 0);

  return {
    carried_forward: true,
    previous_run_id: lastSeen.reconciliation_run_id,
    previous_exception_id: lastSeen.exception_id,
    first_seen_run_id: firstSeen.reconciliation_run_id,
    first_seen_at: firstSeen.created_at,
    last_seen_run_id: lastSeen.reconciliation_run_id,
    last_seen_at: lastSeen.created_at,
    occurrence_count: priors.length + 1,
    prior_boa_notes: dedupeJoin(priorBoaNotes),
    prior_gl_notes: dedupeJoin(priorGlNotes),
  };
}

export function applyCarryForwardToDetail(
  detail: ReconciliationRunDetail,
  priors: PriorExceptionRecord[],
): ReconciliationRunDetail {
  const priorsByKey = groupPriorExceptionsByKey(priors);
  return {
    ...detail,
    exceptions: detail.exceptions.map((exception) => ({
      ...exception,
      carry_forward: computeCarryForward(exception, detail.dealership_store_id, priorsByKey),
    })),
  };
}

function dedupeJoin(values: string[]): string {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered.join(" | ");
}
