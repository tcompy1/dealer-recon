import type { RooftopProfileId } from "./store";

export type SourceType = "bank" | "boa" | "dealertrack" | "dms" | "gl" | "oem";

export type UploadValidationError = {
  row: number | null;
  field: string | null;
  message: string;
};

export type RooftopFailureDetails = {
  source: "boa" | "dealertrack" | null;
  accounting_month: string | null;
  rooftop_profile_id: string | null;
  evidence?: Record<string, string | number | boolean | null>;
  recovery: string;
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
  | "current_month_maturity_payoff_review"
  | "ambiguous_amount_column"
  | "parser_warning"
  | "sort_applied"
  | "ending_balance_autosum_applied";

export type PreprocessingDiagnostic = {
  kind: PreprocessingDiagnosticKind;
  message: string;
  source_row_number: number | null;
  vin6?: string | null;
  stock_number?: string | null;
  details?: Record<string, string | number | boolean | null>;
};

export type PreprocessingSummary = {
  source_kind: "boa" | "dealertrack";
  preprocessing_version: string;
  parser_name: "boa-csv" | "boa-html-xls" | "dealertrack-csv" | "dealertrack-spreadsheetml";
  parser_version: string;
  parser_format: string | null;
  preprocessor_name: "boa-floorplan" | "dealertrack-floorplan";
  preprocessor_version: string;
  period_evidence: SourcePeriodEvidence;
  rows_scanned: number;
  rows_accepted: number;
  rows_removed_zero_balance: number;
  rows_removed_straightline: number;
  rows_removed_banner: number;
  rows_skipped_unknown: number;
  rows_requiring_manual_enrichment: number;
  duplicate_vin6_count: number;
  current_month_maturity_count?: number;
  ending_balance_autosum_cents?: number;
  ending_balance_autosum_amount?: string;
  preprocessed_at: string;
};

export type SourcePeriodEvidence = {
  source: "boa" | "dealertrack";
  selectedMonth: string;
  explicitMonths: string[];
  observedDateRange: { min: string; max: string } | null;
  filenameHint: string | null;
  status: "confirmed" | "compatible_incomplete" | "contradictory";
  safeEvidence: Record<string, string | number | boolean | null>;
};

export type RemovedRow = {
  source: "boa" | "dealertrack";
  source_row_number: number | null;
  removal_reason: string;
  key_values: Record<string, string>;
};

export type UploadPreprocessingMetadata = {
  detected_format: string;
  detection_confidence: string;
  detection_reason: string;
  parser_route: string;
  preprocessing_version: string | null;
  summary: PreprocessingSummary | null;
  diagnostics: PreprocessingDiagnostic[];
  removed_rows: RemovedRow[];
  legacy_csv_path: boolean;
  unsupported_reason: string | null;
};

type UploadResponseBase = {
  source_file_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  filename: string;
  transaction_count: number;
  stored_row_count: number;
  stored_validation_error_count: number;
  validation_errors: UploadValidationError[];
  automated_reconciliation_run_id?: number | null;
  reused_existing_file: boolean;
  source_file_health: {
    status: "healthy" | "unhealthy" | "reprocessed";
    healthy: boolean;
    reasons: string[];
    transaction_count: number;
    row_count: number;
    validation_error_count: number;
  };
  warnings?: string[];
  existing_file?: {
    source_file_id: number;
    filename: string;
    store_name: string | null;
    source_type: SourceType;
    created_at: string;
  };
  preprocessing: UploadPreprocessingMetadata;
};

export type FloorplanUploadResponse = UploadResponseBase & {
  source_type: "boa" | "dealertrack";
  accounting_month: string;
  rooftop_profile_id: RooftopProfileId;
  rooftop_profile_version: string;
  parser_name: string;
  parser_version: string;
  preprocessor_name: string;
  preprocessor_version: string;
};

export type LegacyUploadResponse = UploadResponseBase & {
  source_type: Exclude<SourceType, "boa" | "dealertrack">;
  accounting_month?: never;
  rooftop_profile_id?: never;
  rooftop_profile_version?: never;
  parser_name?: never;
  parser_version?: never;
  preprocessor_name?: never;
  preprocessor_version?: never;
};

export type UploadResponse = FloorplanUploadResponse | LegacyUploadResponse;

export type SourceFileSummary = {
  source_file_id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  source_type: SourceType;
  filename: string;
  row_count: number;
  validation_error_count: number;
  accounting_month: string | null;
  rooftop_profile_id: RooftopProfileId | null;
  rooftop_profile_version: string | null;
  parser_name: string | null;
  parser_version: string | null;
  preprocessor_name: string | null;
  preprocessor_version: string | null;
  preprocessing_metadata: UploadPreprocessingMetadata | null;
  created_at: string;
};
