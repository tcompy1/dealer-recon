export const sourceTypes = ["bank", "boa", "dealertrack", "dms", "gl", "oem"] as const;

export type SourceType = (typeof sourceTypes)[number];

export type ValidationError = {
  row: number | null;
  field: string | null;
  message: string;
};

export const userRoles = [
  "platform_admin",
  "dealer_group_admin",
  "store_manager",
  "accounting_user",
  "read_only_auditor",
] as const;

export type UserRole = (typeof userRoles)[number];

export type AuditEvent = {
  id: number;
  dealership_id: number;
  actor_user_id: number | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  timestamp: string;
};

export type NewAuditEvent = Omit<AuditEvent, "id" | "dealership_id" | "timestamp">;

export type Transaction = {
  id: number;
  dealership_id: number;
  source_file_id: number | null;
  source_type: SourceType;
  transaction_date: string | null;
  post_date: string | null;
  amount_cents: number;
  reference_number: string | null;
  description: string | null;
  account: string | null;
  account_type: string;
  account_identifier: string;
  stock_number: string | null;
  vin: string | null;
  raw_data: Record<string, unknown>;
};

export type DealerGroup = {
  id: number;
  dealership_id: number;
  name: string;
  created_at: string;
};

export type DealershipStore = {
  id: number;
  dealership_id: number;
  dealer_group_id: number | null;
  name: string;
  created_at: string;
};

export type NewDealershipStore = {
  name: string;
  dealer_group_id?: number | null;
};

export type NewTransaction = Omit<
  Transaction,
  "id" | "dealership_id" | "account_type" | "account_identifier"
> &
  Partial<Pick<Transaction, "account_type" | "account_identifier">>;

export type SourceFile = {
  id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  store_name?: string | null;
  source_type: SourceType;
  original_filename: string;
  stored_filename: string | null;
  file_hash: string;
  row_count: number;
  validation_error_count: number;
  created_at: string;
};

export type NewSourceFile = Omit<
  SourceFile,
  "id" | "dealership_id" | "dealership_store_id" | "created_at"
> &
  Partial<Pick<SourceFile, "dealership_store_id">>;

export type SourceFileSummary = {
  source_file_id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  source_type: SourceType;
  filename: string;
  row_count: number;
  validation_error_count: number;
  created_at: string;
};

export type UploadResponse = {
  source_file_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  source_type: SourceType;
  filename: string;
  transaction_count: number;
  validation_errors: ValidationError[];
  automated_reconciliation_run_id?: number | null;
};

export const scheduledReconciliationCadences = ["daily", "weekly", "monthly"] as const;

export type ScheduledReconciliationCadence =
  (typeof scheduledReconciliationCadences)[number];

export type ScheduledReconciliationJob = {
  id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  cadence: ScheduledReconciliationCadence;
  expected_source_types: SourceType[];
  enabled: boolean;
  auto_run_on_pair: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NewScheduledReconciliationJob = {
  dealership_store_id?: number | null;
  cadence: ScheduledReconciliationCadence;
  expected_source_types: SourceType[];
  enabled?: boolean;
  auto_run_on_pair?: boolean;
  next_run_at?: string | null;
};

export type ScheduledReconciliationJobUpdate = Partial<
  Pick<
    ScheduledReconciliationJob,
    "enabled" | "auto_run_on_pair" | "last_run_at" | "next_run_at" | "expected_source_types"
  >
> &
  Partial<Pick<ScheduledReconciliationJob, "cadence">>;

export const ingestionWorkflowStates = [
  "uploaded",
  "validated",
  "normalized",
  "reconciled",
  "failed",
] as const;

export type IngestionWorkflowState = (typeof ingestionWorkflowStates)[number];

export type IngestionEvent = {
  id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  source_file_id: number | null;
  reconciliation_run_id: number | null;
  source_type: SourceType | null;
  state: IngestionWorkflowState;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type NewIngestionEvent = Omit<
  IngestionEvent,
  "id" | "dealership_id" | "store_name" | "created_at"
>;

export const operationalEventTypes = [
  "reconciliation_completed",
  "reconciliation_failed",
  "new_unresolved_exception_spike",
  "recurring_exception_threshold_exceeded",
  "stale_store_activity",
  "missing_expected_file",
  "duplicate_upload_warning",
] as const;

export type OperationalEventType = (typeof operationalEventTypes)[number];

export type OperationalEvent = {
  id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  reconciliation_run_id: number | null;
  event_type: OperationalEventType;
  severity: "info" | "warning" | "critical";
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type NewOperationalEvent = Omit<
  OperationalEvent,
  "id" | "dealership_id" | "store_name" | "created_at"
>;

export type StoreAutomationStatus = {
  dealership_store_id: number | null;
  store_name: string;
  last_upload_at: string | null;
  last_reconciliation_at: string | null;
  missing_expected_source_types: SourceType[];
  stale_reconciliation: boolean;
  enabled_job_count: number;
  next_run_at: string | null;
};

export type OperationalMetrics = {
  average_reconciliation_completion_time_ms: number | null;
  stale_stores: StoreAutomationStatus[];
  upload_failure_trends: Array<{
    source_type: SourceType | null;
    failure_count: number;
  }>;
  auto_vs_manual_reconciliation_rates: {
    automated_count: number;
    manual_count: number;
    automated_percent: number;
  };
};

export type ReconciliationRequest = {
  boa_source_file_id?: unknown;
  dealertrack_source_file_id?: unknown;
  dealership_store_id?: unknown;
};

export type TransactionSummary = {
  id: number;
  dealership_id: number;
  source_type: SourceType;
  transaction_date: string | null;
  post_date: string | null;
  amount: string;
  amount_cents: number;
  reference_number: string | null;
  description: string | null;
  account: string | null;
  account_type?: string;
  account_identifier?: string;
  stock_number: string | null;
  vin: string | null;
};

export type AccountSourceTotal = {
  source_type: SourceType;
  amount_cents: number;
  amount: string;
  transaction_count: number;
};

export type AccountSummary = {
  account_identifier: string;
  account_type: string;
  source_totals: AccountSourceTotal[];
  net_difference_amount_cents: number;
  net_difference_amount: string;
  unresolved_exception_count: number;
};

export type MonthEndReportAccount = AccountSummary & {
  resolved_exception_count: number;
  ignored_exception_count: number;
};

export type MonthEndReport = {
  reporting_period: {
    start_date: string;
    end_date: string;
  };
  generated_at: string;
  account_summaries: MonthEndReportAccount[];
  reconciliation_runs_included: ReconciliationRunListItem[];
};

export type MatchGroup = {
  match_reason: string;
  confidence_score: number;
  transactions: TransactionSummary[];
};

export type ReconciliationException = {
  exception_type: string;
  exception_category: ReconciliationExceptionCategory;
  source_type: SourceType;
  transaction: TransactionSummary;
  description: string;
};

export const reconciliationExceptionCategories = [
  "missing_in_boa",
  "missing_in_dealertrack",
  "amount_mismatch",
  "sign_mismatch",
  "duplicate_or_one_to_many",
  "stock_number_mismatch",
  "vin_missing_but_reference_match",
  "possible_timing_issue",
  "vin6_match_amount_mismatch",
  "amount_only_review",
  "unclassified",
] as const;

export type ReconciliationExceptionCategory =
  (typeof reconciliationExceptionCategories)[number];

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
  reconciliation_run_id?: number;
  matched_count: number;
  exception_count: number;
  duplicate_count: number;
  match_groups: MatchGroup[];
  exceptions: ReconciliationException[];
  vin_presence_diagnostics: VinPresenceDiagnostics;
};

export type ReconciliationRun = {
  id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  boa_source_file_id: number;
  dealertrack_source_file_id: number;
  matched_count: number;
  exception_count: number;
  duplicate_count: number;
  status: string;
  created_at: string;
};

export type PersistReconciliationRunInput = {
  dealership_id: number;
  dealership_store_id?: number | null;
  boa_source_file_id: number;
  dealertrack_source_file_id: number;
  result: ReconciliationResponse;
  input_snapshot?: PersistReconciliationRunSnapshotInput;
  status?: string;
};

export type ReconciliationRunInputSnapshotSide = "boa" | "dealertrack";

export type ReconciliationRunInputSnapshot = {
  reconciliation_run_id: number;
  engine_version: string;
  inputs: Array<{
    side: ReconciliationRunInputSnapshotSide;
    source_type: SourceType;
    source_file_id: number;
    parser_version: string;
    parser_metadata: Record<string, unknown>;
    transactions: Transaction[];
  }>;
};

export type PersistReconciliationRunSnapshotInput = Omit<
  ReconciliationRunInputSnapshot,
  "reconciliation_run_id"
>;

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
    side: ReconciliationRunInputSnapshotSide;
    original: string;
    current: string;
    differs: boolean;
  }>;
};

export type ReconciliationRunListItem = {
  reconciliation_run_id: number;
  dealership_id: number;
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

export type ReconciliationRunListFilters = {
  dealershipStoreId?: number;
};

export const reconciliationExceptionTypes = [
  "duplicate_transaction",
  "missing_in_boa",
  "missing_in_dealertrack",
] as const;

export type ReconciliationExceptionType = (typeof reconciliationExceptionTypes)[number];

export type ReconciliationRunDetailFilters = {
  exceptionSourceType?: SourceType;
  exceptionType?: ReconciliationExceptionType;
  exceptionStatus?: ReconciliationExceptionStatus;
  exceptionReviewStatus?: ReconciliationExceptionReviewStatus;
  assignedTo?: string;
  search?: string;
};

export const reconciliationExceptionStatuses = ["unresolved", "ignored", "resolved"] as const;

export type ReconciliationExceptionStatus = (typeof reconciliationExceptionStatuses)[number];

export const reconciliationExceptionReviewStatuses = [
  "unreviewed",
  "investigating",
  "resolved",
  "ignored",
] as const;

export type ReconciliationExceptionReviewStatus =
  (typeof reconciliationExceptionReviewStatuses)[number];

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

export type ReconciliationRunDetail = ReconciliationRunListItem & {
  boa_source_file: SourceFileSummary;
  dealertrack_source_file: SourceFileSummary;
  match_groups: Array<{
    match_group_id: number;
    match_type: string;
    confidence: number;
    reason: string;
    created_at: string;
    transactions: Array<{
      side: string;
      source_type: SourceType;
      transaction: TransactionSummary;
    }>;
  }>;
  exceptions: Array<{
    exception_id: number;
    dealership_id: number;
    exception_type: ReconciliationExceptionType;
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
    transaction: TransactionSummary;
    carry_forward?: ReconciliationExceptionCarryForward;
  }>;
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

export type DealerGroupAnalytics = {
  dealer_group_id: number | null;
  dealer_group_name: string;
  stores: Array<{
    dealership_store_id: number | null;
    store_name: string;
    run_count: number;
    unresolved_count: number;
    match_rate_percent: number;
    recurring_exception_count: number;
    reviewer_workload: Array<{
      reviewer: string;
      exception_count: number;
    }>;
  }>;
};

export type AccountDetail = AccountSummary & {
  transactions_by_source_type: Partial<Record<SourceType, TransactionSummary[]>>;
  related_reconciliation_runs: ReconciliationRunListItem[];
  unresolved_exceptions: ReconciliationRunDetail["exceptions"];
};

export function isSourceType(value: unknown): value is SourceType {
  return typeof value === "string" && sourceTypes.includes(value as SourceType);
}

export function isReconciliationExceptionType(
  value: unknown,
): value is ReconciliationExceptionType {
  return (
    typeof value === "string" &&
    reconciliationExceptionTypes.includes(value as ReconciliationExceptionType)
  );
}

export function isReconciliationExceptionStatus(
  value: unknown,
): value is ReconciliationExceptionStatus {
  return (
    typeof value === "string" &&
    reconciliationExceptionStatuses.includes(value as ReconciliationExceptionStatus)
  );
}

export function isReconciliationExceptionReviewStatus(
  value: unknown,
): value is ReconciliationExceptionReviewStatus {
  return (
    typeof value === "string" &&
    reconciliationExceptionReviewStatuses.includes(value as ReconciliationExceptionReviewStatus)
  );
}
