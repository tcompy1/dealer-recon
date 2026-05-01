import { API_BASE_URL } from "./client";
import type { SourceType, UploadResponse } from "../types/sourceFile";

type UploadTransactionsInput = {
  sourceType: SourceType;
  file: File;
};

export async function uploadTransactions({
  sourceType,
  file,
}: UploadTransactionsInput): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("source_type", sourceType);
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return response.json() as Promise<UploadResponse>;
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") {
      return body.detail;
    }
  } catch {
    return `Upload failed with status ${response.status}`;
  }

  return `Upload failed with status ${response.status}`;
}
