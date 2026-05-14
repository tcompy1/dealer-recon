import type { SourceType } from "./sourceFile";

export type ReconciledTransaction = {
  id: number;
  source_type: SourceType;
  transaction_date: string | null;
  post_date: string | null;
  amount: string | number;
  amount_cents: number;
  reference_number: string | null;
  description: string | null;
  account: string | null;
  account_type?: string;
  account_identifier?: string;
  stock_number: string | null;
  vin: string | null;
};

export type MatchGroup = {
  match_reason: string;
  confidence_score: number;
  transactions: ReconciledTransaction[];
};

export type ReconciliationException = {
  exception_type: string;
  source_type: SourceType;
  transaction: ReconciledTransaction;
  description: string;
};

export type VinPresenceDiagnosticReason =
  | "amount_mismatch"
  | "sign_mismatch_or_absolute_amount_issue"
  | "row_filtered_before_matching"
  | "weak_match_consumed_stronger_vin_match"
  | "stock_number_mismatch"
  | "duplicate_or_one_to_many_transaction_structure"
  | "missing_parsed_vin";

export type VinPresenceDiagnosticEntry = {
  vin: string;
  stored_vin_count: number;
  extracted_vin_count: number;
  transaction_ids: number[];
};

export type VinPresenceTransactionUnmatchedEntry = {
  vin: string;
  likely_reason: VinPresenceDiagnosticReason;
  boa_transaction_ids: number[];
  dealertrack_transaction_ids: number[];
  unmatched_boa_transaction_ids: number[];
  unmatched_dealertrack_transaction_ids: number[];
};

export type VinPresenceDiagnostics = {
  extracted_vin_sets: {
    boa: VinPresenceDiagnosticEntry[];
    dealertrack: VinPresenceDiagnosticEntry[];
  };
  vin_presence_exceptions: {
    dealertrack_not_in_boa: string[];
    boa_not_in_dealertrack: string[];
  };
  transaction_unmatched_shared_vins: VinPresenceTransactionUnmatchedEntry[];
};

export type ReconciliationResponse = {
  reconciliation_run_id: number;
  matched_count: number;
  exception_count: number;
  duplicate_count: number;
  match_groups: MatchGroup[];
  exceptions: ReconciliationException[];
  vin_presence_diagnostics: VinPresenceDiagnostics;
};

export type ReconcileSourceFilesInput = {
  boaSourceFileId: number;
  dealertrackSourceFileId: number;
};

export type ReconciliationRunListItem = {
  reconciliation_run_id: number;
  boa_source_file_id: number;
  dealertrack_source_file_id: number;
  boa_filename: string;
  dealertrack_filename: string;
  matched_count: number;
  exception_count: number;
  duplicate_count: number;
  status: string;
  created_at: string;
};

export type SourceFileSummary = {
  source_file_id: number;
  source_type: SourceType;
  filename: string;
  row_count: number;
  validation_error_count: number;
  created_at: string;
};

export type ReconciliationRunDetailMatchGroup = {
  match_group_id: number;
  match_type: string;
  confidence: number;
  reason: string;
  created_at: string;
  transactions: Array<{
    side: string;
    source_type: SourceType;
    transaction: ReconciledTransaction;
  }>;
};

export type ReconciliationRunDetailException = {
  exception_id: number;
  exception_type: ReconciliationException["exception_type"];
  status: ReconciliationExceptionStatus;
  note: string;
  source_type: SourceType;
  reason: string;
  created_at: string;
  transaction: ReconciledTransaction;
};

export type ReconciliationRunDetail = ReconciliationRunListItem & {
  boa_source_file: SourceFileSummary;
  dealertrack_source_file: SourceFileSummary;
  match_groups: ReconciliationRunDetailMatchGroup[];
  exceptions: ReconciliationRunDetailException[];
};

export type ReconciliationRunFilters = {
  sourceType?: SourceType | "";
  exceptionType?: ReconciliationException["exception_type"] | "";
  status?: ReconciliationExceptionStatus | "";
  search?: string;
};

export type ReconciliationExceptionStatus = "unresolved" | "ignored" | "resolved";

export type ReconciliationExceptionReviewUpdate = {
  status?: ReconciliationExceptionStatus;
  note?: string;
};
