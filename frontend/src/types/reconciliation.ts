import type { SourceType } from "./sourceFile";

export type ReconciledTransaction = {
  id: number;
  source_type: SourceType;
  transaction_date: string | null;
  post_date: string | null;
  amount: string | number;
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
  matched_count: number;
  exception_count: number;
  duplicate_count: number;
  match_groups: MatchGroup[];
  exceptions: ReconciliationException[];
};
