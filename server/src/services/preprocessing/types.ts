/**
 * Shared types for the deterministic floorplan preprocessing layer.
 *
 * The preprocessing layer mirrors the Hiley office-manager Excel workflow:
 *   1. parse the raw BOA / Dealertrack export
 *   2. apply deterministic, replayable transformations (banner removal,
 *      zero-balance removal, Straightline removal, VIN6 enrichment, etc.)
 *   3. emit normalized transactions + a structured diagnostics record
 *      that fully explains every transformed, removed, or enriched row.
 *
 * The diagnostics record is the audit trail. It is intentionally kept
 * small so we can stash it inside the existing source-file ingestion
 * event metadata without requiring a DB schema change.
 */

import type { NewTransaction, ValidationError } from "../../domain/types.js";

export const PREPROCESSING_VERSION = "preprocessing-v1";

export type PreprocessingSourceKind = "boa" | "dealertrack";

export type RowLineageStage =
  | "raw_parsed"
  | "banner_skipped"
  | "header_detected"
  | "zero_balance_removed"
  | "straightline_removed"
  | "amount_resolved"
  | "vin_extracted"
  | "vin6_computed"
  | "vin_enrichment_required"
  | "vin_enriched"
  | "maturity_date_attached"
  | "stock_normalized"
  | "duplicate_vin_observed"
  | "sorted";

export type RowLineageEntry = {
  stage: RowLineageStage;
  detail?: string;
};

export type PreprocessingDiagnosticKind =
  | "banner_row_removed"
  | "header_row_detected"
  | "zero_balance_row_removed"
  | "straightline_row_removed"
  | "missing_amount"
  | "missing_vin"
  | "duplicate_vin"
  | "untrusted_vin"
  | "manual_enrichment_required"
  | "manual_enrichment_applied"
  | "row_skipped_unknown_structure"
  | "row_skipped_malformed"
  | "maturity_date_attached"
  | "ambiguous_amount_column"
  | "parser_warning"
  | "sort_applied";

export type PreprocessingDiagnostic = {
  kind: PreprocessingDiagnosticKind;
  message: string;
  /**
   * 1-based original row number from the raw parsed table. May be null for
   * file-level diagnostics (e.g. sort applied, parser warning).
   */
  source_row_number: number | null;
  /** Optional sample VIN6 / stock number for operator triage. */
  vin6?: string | null;
  stock_number?: string | null;
  /** Optional structured details (no raw cell content). */
  details?: Record<string, string | number | boolean | null>;
};

export type PreprocessingSummary = {
  source_kind: PreprocessingSourceKind;
  preprocessing_version: string;
  parser_version: string | null;
  parser_format: string | null;
  rows_scanned: number;
  rows_accepted: number;
  rows_removed_zero_balance: number;
  rows_removed_straightline: number;
  rows_removed_banner: number;
  rows_skipped_unknown: number;
  rows_requiring_manual_enrichment: number;
  duplicate_vin6_count: number;
  /** ISO timestamp of preprocessing completion. Useful for debugging. */
  preprocessed_at: string;
};

export type PreprocessingResult = {
  transactions: NewTransaction[];
  validationErrors: ValidationError[];
  diagnostics: PreprocessingDiagnostic[];
  summary: PreprocessingSummary;
};

/**
 * Lineage block embedded into each NewTransaction.raw_data under the
 * reserved `__lineage` key. Keeps lineage attached to the transaction
 * through DB persistence without requiring a schema change.
 */
export type RawDataLineage = {
  source_kind: PreprocessingSourceKind;
  preprocessing_version: string;
  /** 1-based row number from the raw parsed table this transaction came from. */
  source_row_number: number;
  /** Header column name -> raw cell value, snapshot of the row pre-transform. */
  raw_row_snapshot: Record<string, string>;
  /** Ordered list of transformations applied to this row. */
  transformations: RowLineageEntry[];
  /**
   * Reason the row was kept rather than removed. Useful when diffing two
   * preprocessing runs against each other.
   */
  retained_reason: string;
  vin_provenance: VinProvenance | null;
  maturity_date: string | null;
};

export type VinProvenanceSource =
  | "raw_vin_column"
  | "description_extraction"
  | "stock_number_lookup"
  | "manual_enrichment"
  | "dms_assisted_reconstruction"
  | "untrusted";

export type VinProvenance = {
  source: VinProvenanceSource;
  vin: string | null;
  vin6: string | null;
  trusted: boolean;
  /** Optional free text — kept short and structured (no PII). */
  note: string | null;
};

export const LINEAGE_RAW_DATA_KEY = "__lineage" as const;

/**
 * Pulls the lineage block out of a transaction's raw_data if present.
 * Returns null when the transaction was ingested by a pre-preprocessing
 * code path.
 */
export function readLineage(rawData: Record<string, unknown>): RawDataLineage | null {
  const block = rawData[LINEAGE_RAW_DATA_KEY];
  if (!block || typeof block !== "object") {
    return null;
  }
  return block as RawDataLineage;
}
