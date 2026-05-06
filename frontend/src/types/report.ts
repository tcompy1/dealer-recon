import type { AccountSourceTotal } from "./account";
import type { ReconciliationRunListItem } from "./reconciliation";

export type MonthEndReportAccount = {
  account_identifier: string;
  account_type: string;
  source_totals: AccountSourceTotal[];
  net_difference_amount_cents: number;
  net_difference_amount: string;
  unresolved_exception_count: number;
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
