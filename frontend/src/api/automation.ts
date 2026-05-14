import { apiGet, apiPatch, apiPost } from "./client";
import type {
  IngestionEvent,
  OperationalEvent,
  OperationalMetrics,
  ScheduledReconciliationCadence,
  ScheduledReconciliationJob,
  StoreAutomationStatus,
} from "../types/automation";
import type { SourceType } from "../types/sourceFile";

export async function listScheduledJobs(
  dealershipStoreId?: number | null,
): Promise<ScheduledReconciliationJob[]> {
  const query = dealershipStoreId ? `?store_id=${dealershipStoreId}` : "";
  return apiGet<ScheduledReconciliationJob[]>(`/automation/scheduled-jobs${query}`);
}

export async function createScheduledJob(input: {
  dealership_store_id?: number | null;
  cadence: ScheduledReconciliationCadence;
  expected_source_types: SourceType[];
  enabled?: boolean;
  auto_run_on_pair?: boolean;
}): Promise<ScheduledReconciliationJob> {
  return apiPost<ScheduledReconciliationJob>("/automation/scheduled-jobs", input);
}

export async function updateScheduledJob(
  jobId: number,
  update: Partial<Pick<ScheduledReconciliationJob, "enabled" | "auto_run_on_pair">>,
): Promise<ScheduledReconciliationJob> {
  return apiPatch<ScheduledReconciliationJob>(`/automation/scheduled-jobs/${jobId}`, update);
}

export async function listIngestionEvents(
  dealershipStoreId?: number | null,
): Promise<IngestionEvent[]> {
  const query = dealershipStoreId ? `?store_id=${dealershipStoreId}` : "";
  return apiGet<IngestionEvent[]>(`/automation/ingestion-events${query}`);
}

export async function listOperationalEvents(
  dealershipStoreId?: number | null,
): Promise<OperationalEvent[]> {
  const query = dealershipStoreId ? `?store_id=${dealershipStoreId}` : "";
  return apiGet<OperationalEvent[]>(`/automation/events${query}`);
}

export async function getAutomationStatus(): Promise<StoreAutomationStatus[]> {
  return apiGet<StoreAutomationStatus[]>("/automation/status");
}

export async function getOperationalMetrics(): Promise<OperationalMetrics> {
  return apiGet<OperationalMetrics>("/automation/metrics");
}
