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
  exception_category: ReconciliationExceptionCategory;
  source_type: SourceType;
  transaction: ReconciledTransaction;
  description: string;
};

export type ReconciliationExceptionCategory =
  | "missing_in_boa"
  | "missing_in_dealertrack"
  | "amount_mismatch"
  | "sign_mismatch"
  | "duplicate_or_one_to_many"
  | "stock_number_mismatch"
  | "vin_missing_but_reference_match"
  | "possible_timing_issue"
  | "vin6_match_amount_mismatch"
  | "amount_only_review"
  | "unclassified";

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
  dealershipStoreId?: number | null;
};

export type ReconciliationRunListItem = {
  reconciliation_run_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  dealer_group_id: number | null;
  dealer_group_name: string | null;
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
  dealership_store_id: number | null;
  store_name: string | null;
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

export type ReconciliationExceptionCarryForward = {
  carried_forward: boolean;
  previous_run_id: number | null;
  previous_exception_id: number | null;
  first_seen_run_id: number | null;
  first_seen_at: string | null;
  last_seen_run_id: number | null;
  last_seen_at: string | null;
  occurrence_count: number;
  prior_boa_notes: string;
  prior_gl_notes: string;
};

export type ReconciliationRunDetailException = {
  exception_id: number;
  exception_type: ReconciliationException["exception_type"];
  exception_category: ReconciliationExceptionCategory;
  status: ReconciliationExceptionStatus;
  note: string;
  review_status: ReconciliationExceptionReviewStatus;
  assigned_to: string | null;
  review_notes: string;
  boa_notes: string;
  gl_notes: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  source_type: SourceType;
  reason: string;
  created_at: string;
  transaction: ReconciledTransaction;
  carry_forward?: ReconciliationExceptionCarryForward;
};

export type ReconciliationRunDetail = ReconciliationRunListItem & {
  boa_source_file: SourceFileSummary;
  dealertrack_source_file: SourceFileSummary;
  match_groups: ReconciliationRunDetailMatchGroup[];
  exceptions: ReconciliationRunDetailException[];
};

export type ReconciliationRunMetrics = {
  total_matched_transactions: number;
  total_exception_count: number;
  unresolved_count: number;
  match_rate_percent: number;
  category_distribution: Partial<Record<ReconciliationExceptionCategory, number>>;
  average_time_to_resolution_hours: number | null;
};

export type ReconciliationRunComparison = {
  current_run_id: number;
  previous_run_id: number | null;
  newly_resolved_exception_ids: number[];
  newly_created_exception_ids: number[];
  recurring_exception_ids: number[];
  category_delta_summary: Array<{
    exception_category: ReconciliationExceptionCategory;
    current_count: number;
    previous_count: number;
    delta: number;
  }>;
  reviewer_workload_trends: Array<{
    reviewer: string;
    current_count: number;
    previous_count: number;
    delta: number;
  }>;
  run_comparison_summary: {
    current: ReconciliationRunMetrics;
    previous: ReconciliationRunMetrics | null;
    matched_count_delta: number | null;
    unresolved_count_delta: number | null;
    match_rate_delta_percent: number | null;
    newly_resolved_count: number;
    newly_created_count: number;
    recurring_count: number;
  };
};

export type ReconciliationReplayResponse = {
  reconciliation_run_id: number;
  results_changed: boolean;
  original: {
    matched_count: number;
    exception_count: number;
  };
  replayed: {
    matched_count: number;
    exception_count: number;
  };
  matched_count_delta: number;
  exception_count_delta: number;
  newly_matched: string[];
  newly_unmatched: string[];
  engine_version_difference: {
    original: string;
    current: string;
    differs: boolean;
  };
  parser_version_difference: Array<{
    side: "boa" | "dealertrack";
    original: string;
    current: string;
    differs: boolean;
  }>;
};

export type ReconciliationRunFilters = {
  sourceType?: SourceType | "";
  exceptionType?: ReconciliationException["exception_type"] | "";
  status?: ReconciliationExceptionStatus | "";
  reviewStatus?: ReconciliationExceptionReviewStatus | "";
  assignedTo?: string;
  search?: string;
};

export type ReconciliationExceptionStatus = "unresolved" | "ignored" | "resolved";

export type ReconciliationExceptionReviewStatus =
  | "unreviewed"
  | "investigating"
  | "resolved"
  | "ignored";

export type ReconciliationExceptionReviewUpdate = {
  status?: ReconciliationExceptionStatus;
  note?: string;
  review_status?: ReconciliationExceptionReviewStatus;
  assigned_to?: string | null;
  review_notes?: string;
  boa_notes?: string;
  gl_notes?: string;
  reviewed_by?: string | null;
};
