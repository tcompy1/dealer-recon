export type SourceType = "bank" | "boa" | "dealertrack" | "dms" | "gl" | "oem";

export type UploadValidationError = {
  row: number | null;
  field: string | null;
  message: string;
};

export type UploadResponse = {
  source_file_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  source_type: SourceType;
  filename: string;
  transaction_count: number;
  validation_errors: UploadValidationError[];
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
