import type { ReconciliationRunDetailException, ReconciliationRunListItem } from "./reconciliation";
import type { SourceType } from "./sourceFile";

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

export type AccountTransaction = {
  id: number;
  source_type: SourceType;
  transaction_date: string | null;
  post_date: string | null;
  amount: string;
  amount_cents: number;
  reference_number: string | null;
  description: string | null;
  account: string | null;
  account_type: string;
  account_identifier: string;
  stock_number: string | null;
  vin: string | null;
};

export type AccountDetail = AccountSummary & {
  transactions_by_source_type: Partial<Record<SourceType, AccountTransaction[]>>;
  related_reconciliation_runs: ReconciliationRunListItem[];
  unresolved_exceptions: ReconciliationRunDetailException[];
};
