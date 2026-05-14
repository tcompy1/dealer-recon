import { API_BASE_URL, apiGet, apiPatch, apiPost } from "./client";
import type {
  ReconcileSourceFilesInput,
  ReconciliationExceptionReviewUpdate,
  ReconciliationRunDetailException,
  ReconciliationRunFilters,
  ReconciliationResponse,
  ReconciliationRunDetail,
  ReconciliationRunListItem,
} from "../types/reconciliation";

export async function reconcileSourceFiles({
  boaSourceFileId,
  dealertrackSourceFileId,
}: ReconcileSourceFilesInput): Promise<ReconciliationResponse> {
  return apiPost<ReconciliationResponse>("/reconcile", {
    boa_source_file_id: boaSourceFileId,
    dealertrack_source_file_id: dealertrackSourceFileId,
  });
}

export async function listReconciliationRuns(): Promise<ReconciliationRunListItem[]> {
  return apiGet<ReconciliationRunListItem[]>("/reconciliation-runs");
}

export async function getReconciliationRun(
  reconciliationRunId: number,
  filters: ReconciliationRunFilters = {},
): Promise<ReconciliationRunDetail> {
  return apiGet<ReconciliationRunDetail>(
    `/reconciliation-runs/${reconciliationRunId}${toRunFilterQuery(filters)}`,
  );
}

export function getReconciliationExceptionsCsvUrl(
  reconciliationRunId: number,
  filters: ReconciliationRunFilters = {},
): string {
  return `${API_BASE_URL}/reconciliation-runs/${reconciliationRunId}/exceptions.csv${toRunFilterQuery(
    filters,
  )}`;
}

export async function updateReconciliationExceptionReview({
  reconciliationRunId,
  exceptionId,
  update,
}: {
  reconciliationRunId: number;
  exceptionId: number;
  update: ReconciliationExceptionReviewUpdate;
}): Promise<ReconciliationRunDetailException> {
  return apiPatch<ReconciliationRunDetailException>(
    `/reconciliation-runs/${reconciliationRunId}/exceptions/${exceptionId}`,
    update,
  );
}

export async function runReconciliation(): Promise<ReconciliationResponse> {
  throw new Error("Choose BOA and Dealertrack uploads before running reconciliation.");
}

function toRunFilterQuery(filters: ReconciliationRunFilters): string {
  const params = new URLSearchParams();
  if (filters.sourceType) {
    params.set("source_type", filters.sourceType);
  }
  if (filters.exceptionType) {
    params.set("exception_type", filters.exceptionType);
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.reviewStatus) {
    params.set("review_status", filters.reviewStatus);
  }
  const assignedTo = filters.assignedTo?.trim();
  if (assignedTo) {
    params.set("assigned_to", assignedTo);
  }
  const search = filters.search?.trim();
  if (search) {
    params.set("search", search);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
