/**
 * Manual VIN enrichment service.
 *
 * After preprocessing, rows that lack a trustworthy VIN are flagged as
 * `manual_enrichment_required` or `untrusted_vin`. The Hiley title-clerk
 * workflow resolves those by looking the stock number up in the DMS,
 * pulling the full VIN, and stamping the row.
 *
 * This module is the deterministic, audit-friendly representation of
 * that step. It does not own DB writes — the caller is expected to
 * persist the returned `EnrichedTransaction.raw_data` and `vin` fields
 * via whatever transaction-update API exists (today there is none; this
 * is documented in the report and left for follow-up).
 *
 * Keeping the operation pure makes it trivially testable and replayable:
 * the same (transaction, enrichment_input) pair always produces the same
 * (vin, vin6, lineage) tuple.
 */

import { computeVin6 } from "../../domain/vin6.js";
import type { Transaction } from "../../domain/types.js";
import {
  LINEAGE_RAW_DATA_KEY,
  PREPROCESSING_VERSION,
  type RawDataLineage,
  type VinProvenance,
  type VinProvenanceSource,
} from "./types.js";

const VIN_FULL_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

export type ManualVinEnrichmentInput = {
  vin: string;
  /** Where the VIN came from. */
  source: Extract<VinProvenanceSource, "manual_enrichment" | "dms_assisted_reconstruction" | "stock_number_lookup">;
  /** Operator / system identifier (e.g. user email, "dms:reynolds"). */
  enriched_by: string;
  /** Free-text justification kept on the lineage trail. */
  note?: string;
  /** ISO timestamp. Caller may inject for deterministic tests. */
  enriched_at?: string;
};

export type ManualVinEnrichmentResult =
  | {
      ok: true;
      vin: string;
      vin6: string;
      raw_data: Record<string, unknown>;
      vin_provenance: VinProvenance;
    }
  | {
      ok: false;
      reason: "invalid_vin" | "no_change";
    };

export type ManualVinEnrichmentCandidate = {
  transaction_id: number;
  source_type: Transaction["source_type"];
  stock_number: string | null;
  vin: string | null;
  vin6: string | null;
  source_row_number: number | null;
  reason: "missing_vin" | "untrusted_vin";
  current_provenance: VinProvenance | null;
};

export function applyManualVinEnrichment(
  transaction: Transaction,
  input: ManualVinEnrichmentInput,
): ManualVinEnrichmentResult {
  const cleanedVin = (input.vin ?? "").trim().toUpperCase();
  if (!VIN_FULL_RE.test(cleanedVin)) {
    return { ok: false, reason: "invalid_vin" };
  }
  if (transaction.vin && transaction.vin.toUpperCase() === cleanedVin) {
    return { ok: false, reason: "no_change" };
  }

  const vin6 = computeVin6(cleanedVin);
  if (!vin6) {
    return { ok: false, reason: "invalid_vin" };
  }

  const enrichedAt = input.enriched_at ?? new Date().toISOString();
  const provenance: VinProvenance = {
    source: input.source,
    vin: cleanedVin,
    vin6,
    trusted: true,
    note: buildProvenanceNote(input.enriched_by, input.note, enrichedAt),
  };

  const existingRawData = (transaction.raw_data ?? {}) as Record<string, unknown>;
  const existingLineage = (existingRawData[LINEAGE_RAW_DATA_KEY] ?? null) as
    | RawDataLineage
    | null;

  const transformations =
    existingLineage?.transformations ? [...existingLineage.transformations] : [];
  transformations.push({
    stage: "vin_enriched",
    detail: `${input.source}:${input.enriched_by}`,
  });

  const updatedLineage: RawDataLineage = existingLineage
    ? {
        ...existingLineage,
        transformations,
        vin_provenance: provenance,
      }
    : {
        source_kind: transaction.source_type === "dealertrack" ? "dealertrack" : "boa",
        preprocessing_version: PREPROCESSING_VERSION,
        source_row_number: 0,
        raw_row_snapshot: stripLineage(existingRawData),
        transformations,
        retained_reason: "manually_enriched",
        vin_provenance: provenance,
        maturity_date: null,
      };

  return {
    ok: true,
    vin: cleanedVin,
    vin6,
    vin_provenance: provenance,
    raw_data: {
      ...stripLineage(existingRawData),
      [LINEAGE_RAW_DATA_KEY]: updatedLineage,
    },
  };
}

export function collectEnrichmentCandidates(
  transactions: Transaction[],
): ManualVinEnrichmentCandidate[] {
  const candidates: ManualVinEnrichmentCandidate[] = [];
  for (const transaction of transactions) {
    const lineage = ((transaction.raw_data ?? {}) as Record<string, unknown>)[
      LINEAGE_RAW_DATA_KEY
    ] as RawDataLineage | null;
    const provenance = lineage?.vin_provenance ?? null;
    const trusted = provenance?.trusted ?? Boolean(transaction.vin);
    if (trusted) {
      continue;
    }
    candidates.push({
      transaction_id: transaction.id,
      source_type: transaction.source_type,
      stock_number: transaction.stock_number,
      vin: transaction.vin,
      vin6: provenance?.vin6 ?? null,
      source_row_number: lineage?.source_row_number ?? null,
      reason: provenance?.source === "description_extraction" ? "untrusted_vin" : "missing_vin",
      current_provenance: provenance,
    });
  }
  return candidates;
}

function buildProvenanceNote(
  enrichedBy: string,
  note: string | undefined,
  enrichedAt: string,
): string {
  const base = `enriched_by=${enrichedBy} at=${enrichedAt}`;
  if (!note) {
    return base;
  }
  return `${base} note=${note}`;
}

function stripLineage(rawData: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawData)) {
    if (key === LINEAGE_RAW_DATA_KEY) {
      continue;
    }
    if (typeof value === "string") {
      out[key] = value;
    } else if (value !== null && value !== undefined) {
      out[key] = String(value);
    }
  }
  return out;
}
