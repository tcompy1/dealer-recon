import { apiGet, apiPost } from "./client";
import type {
  ReconcileSourceFilesInput,
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
): Promise<ReconciliationRunDetail> {
  return apiGet<ReconciliationRunDetail>(`/reconciliation-runs/${reconciliationRunId}`);
}

export async function runReconciliation(): Promise<ReconciliationResponse> {
  throw new Error("Choose BOA and Dealertrack uploads before running reconciliation.");
}
