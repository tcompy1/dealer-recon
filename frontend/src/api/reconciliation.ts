import { API_BASE_URL } from "./client";
import type { ReconciliationResponse } from "../types/reconciliation";

export async function runReconciliation(): Promise<ReconciliationResponse> {
  const response = await fetch(`${API_BASE_URL}/reconcile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      left_source_type: "boa",
      right_source_type: "dealertrack",
    }),
  });

  if (!response.ok) {
    throw new Error(`Reconciliation failed with status ${response.status}`);
  }

  return response.json() as Promise<ReconciliationResponse>;
}
