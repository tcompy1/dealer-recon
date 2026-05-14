export const sourceTypes = ["bank", "boa", "dealertrack", "dms", "gl", "oem"] as const;

export type SourceType = (typeof sourceTypes)[number];

export type ValidationError = {
  row: number | null;
  field: string | null;
  message: string;
};

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

export type NewTransaction = Omit<
  Transaction,
  "id" | "dealership_id" | "account_type" | "account_identifier"
> &
  Partial<Pick<Transaction, "account_type" | "account_identifier">>;

export type SourceFile = {
  id: number;
  dealership_id: number;
  source_type: SourceType;
  original_filename: string;
  stored_filename: string | null;
  file_hash: string;
  row_count: number;
  validation_error_count: number;
  created_at: string;
};

export type NewSourceFile = Omit<SourceFile, "id" | "dealership_id" | "created_at">;

export type SourceFileSummary = {
  source_file_id: number;
  dealership_id: number;
  source_type: SourceType;
  filename: string;
  row_count: number;
  validation_error_count: number;
  created_at: string;
};

export type UploadResponse = {
  source_file_id: number;
  source_type: SourceType;
  filename: string;
  transaction_count: number;
  validation_errors: ValidationError[];
};

export type ReconciliationRequest = {
  boa_source_file_id?: unknown;
  dealertrack_source_file_id?: unknown;
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
  source_type: SourceType;
  transaction: TransactionSummary;
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
  boa_source_file_id: number;
  dealertrack_source_file_id: number;
  result: ReconciliationResponse;
  status?: string;
};

export type ReconciliationRunListItem = {
  reconciliation_run_id: number;
  dealership_id: number;
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
  search?: string;
};

export const reconciliationExceptionStatuses = ["unresolved", "ignored", "resolved"] as const;

export type ReconciliationExceptionStatus = (typeof reconciliationExceptionStatuses)[number];

export type ReconciliationExceptionReviewUpdate = {
  status?: ReconciliationExceptionStatus;
  note?: string;
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
    status: ReconciliationExceptionStatus;
    note: string;
    source_type: SourceType;
    reason: string;
    created_at: string;
    transaction: TransactionSummary;
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
