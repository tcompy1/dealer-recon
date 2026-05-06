import { API_BASE_URL, apiGet, getErrorMessage } from "./client";
import type { SourceFileSummary, SourceType, UploadResponse } from "../types/sourceFile";

type UploadSourceFileInput = {
  sourceType: SourceType;
  file: File;
};

export async function uploadSourceFile({
  sourceType,
  file,
}: UploadSourceFileInput): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("source_type", sourceType);
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

export async function listSourceFiles(sourceType?: SourceType): Promise<SourceFileSummary[]> {
  const query = sourceType ? `?source_type=${encodeURIComponent(sourceType)}` : "";
  return apiGet<SourceFileSummary[]>(`/source-files${query}`);
}

export const uploadTransactions = uploadSourceFile;
