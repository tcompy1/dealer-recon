export type SourceType = "bank" | "boa" | "dealertrack" | "dms" | "gl" | "oem";

export type UploadValidationError = {
  row: number | null;
  field: string | null;
  message: string;
};

export type UploadResponse = {
  source_type: SourceType;
  filename: string;
  transaction_count: number;
  validation_errors: UploadValidationError[];
};
