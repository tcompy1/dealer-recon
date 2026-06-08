export type SourceType = "bank" | "boa" | "dealertrack" | "dms" | "gl" | "oem";

export type UploadValidationError = {
  row: number | null;
  field: string | null;
  message: string;
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
  source_row_number: number | null;
  vin6?: string | null;
  stock_number?: string | null;
  details?: Record<string, string | number | boolean | null>;
};

export type PreprocessingSummary = {
  source_kind: "boa" | "dealertrack";
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
  preprocessed_at: string;
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

export type UploadResponse = {
  source_file_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  source_type: SourceType;
  filename: string;
  transaction_count: number;
  validation_errors: UploadValidationError[];
  automated_reconciliation_run_id?: number | null;
  preprocessing?: UploadPreprocessingMetadata | null;
};

export type SourceFileSummary = {
  source_file_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  source_type: SourceType;
  filename: string;
  row_count: number;
  validation_error_count: number;
  created_at: string;
};
