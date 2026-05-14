import { API_BASE_URL, apiGet, getErrorMessage } from "./client";
import type { SourceFileSummary, SourceType, UploadResponse } from "../types/sourceFile";

type UploadSourceFileInput = {
  sourceType: SourceType;
  file: File;
  dealershipStoreId?: number | null;
};

export async function uploadSourceFile({
  sourceType,
  file,
  dealershipStoreId,
}: UploadSourceFileInput): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("source_type", sourceType);
  if (dealershipStoreId) {
    formData.append("store_id", String(dealershipStoreId));
  }
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Upload failed"));
  }

  return response.json() as Promise<UploadResponse>;
}

export async function listSourceFiles(
  sourceType?: SourceType,
  dealershipStoreId?: number | null,
): Promise<SourceFileSummary[]> {
  const params = new URLSearchParams();
  if (sourceType) {
    params.set("source_type", sourceType);
  }
  if (dealershipStoreId) {
    params.set("store_id", String(dealershipStoreId));
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiGet<SourceFileSummary[]>(`/source-files${query}`);
}

export const uploadTransactions = uploadSourceFile;
