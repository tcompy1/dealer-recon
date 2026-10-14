import { apiGet, apiPost } from "./client";

export type SourceFileTransaction = {
  id: number;
  source_type: string;
  source_file_id: number | null;
  stock_number: string | null;
  vin: string | null;
  source_row_number: number | null;
  dealership_store_id: number;
  vin_enrichment_revision: number;
  assessment: { flags: string[]; operatorConfirmed: boolean };
  vin_provenance?: {
    source: string;
    vin: string | null;
    vin6: string | null;
    trusted: boolean;
    note: string | null;
  } | null;
};

export async function listSourceFileTransactions(
  sourceFileId: number,
): Promise<SourceFileTransaction[]> {
  return apiGet<SourceFileTransaction[]>(
    `/source-files/${sourceFileId}/transactions`,
  );
}

export type VinEnrichmentSource =
  | "manual_enrichment"
  | "dms_assisted_reconstruction"
  | "stock_number_lookup";

export type VinEnrichmentRequest = {
  vin: string;
  expected_revision: number;
  confirmed: true;
  source?: VinEnrichmentSource | null;
  reason?: string | null;
  dms_reference?: string | null;
};

export type VinEnrichmentResponse = {
  transaction: {
    id: number;
    vin: string | null;
    source_type: string;
    [key: string]: unknown;
  };
  enrichment_applied: boolean;
  vin6: string;
  source: VinEnrichmentSource | null;
  audit_event_id: number | null;
  requires_rerun: boolean;
};

export async function applyVinEnrichment(
  transactionId: number,
  request: VinEnrichmentRequest,
): Promise<VinEnrichmentResponse> {
  return apiPost<VinEnrichmentResponse>(
    `/transactions/${transactionId}/vin-enrichment`,
    request,
  );
}

export async function getVinVerification(id: number): Promise<SourceFileTransaction> {
  return apiGet<SourceFileTransaction>(`/transactions/${id}/vin-verification`);
}
