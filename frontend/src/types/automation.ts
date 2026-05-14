import type { SourceType } from "./sourceFile";

export type ScheduledReconciliationCadence = "daily" | "weekly" | "monthly";

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

export type IngestionEvent = {
  id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  source_file_id: number | null;
  reconciliation_run_id: number | null;
  source_type: SourceType | null;
  state: "uploaded" | "validated" | "normalized" | "reconciled" | "failed";
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type OperationalEvent = {
  id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  reconciliation_run_id: number | null;
  event_type:
    | "reconciliation_completed"
    | "reconciliation_failed"
    | "new_unresolved_exception_spike"
    | "recurring_exception_threshold_exceeded"
    | "stale_store_activity"
    | "missing_expected_file"
    | "duplicate_upload_warning";
  severity: "info" | "warning" | "critical";
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

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
