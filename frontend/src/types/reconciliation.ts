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

export type ReconciliationResponse = {
  reconciliation_run_id: number;
  matched_count: number;
  exception_count: number;
  duplicate_count: number;
  match_groups: MatchGroup[];
  exceptions: ReconciliationException[];
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
