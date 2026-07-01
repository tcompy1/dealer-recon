import { API_BASE_URL, apiGet } from "./client";
import type {
  SourceFileSummary,
  SourceType,
  UploadPreprocessingMetadata,
  UploadResponse,
} from "../types/sourceFile";

type UploadSourceFileInput = {
  sourceType: SourceType;
  file: File;
  dealershipStoreId?: number | null;
};

export class UploadError extends Error {
  readonly status: number;
  readonly preprocessing: UploadPreprocessingMetadata | null;

  constructor(
    message: string,
    options: { status: number; preprocessing?: UploadPreprocessingMetadata | null },
  ) {
    super(message);
    this.name = "UploadError";
    this.status = options.status;
    this.preprocessing = options.preprocessing ?? null;
  }
}

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
    const { detail, preprocessing } = await readUploadErrorBody(response);
    throw new UploadError(detail, { status: response.status, preprocessing });
  }

  return response.json() as Promise<UploadResponse>;
}

async function readUploadErrorBody(
  response: Response,
): Promise<{ detail: string; preprocessing: UploadPreprocessingMetadata | null }> {
  try {
    const body = (await response.json()) as {
      detail?: unknown;
      preprocessing?: UploadPreprocessingMetadata | null;
      error?: {
        message?: unknown;
        details?: {
          preprocessing?: UploadPreprocessingMetadata | null;
        } | null;
      };
    };
    let detail = `Upload failed: ${response.status}`;
    if (typeof body.detail === "string") {
      detail = body.detail;
    } else if (typeof body.error?.message === "string") {
      detail = body.error.message;
    }

    let preprocessing: UploadPreprocessingMetadata | null = null;
    if (body.preprocessing && typeof body.preprocessing === "object") {
      preprocessing = body.preprocessing;
    } else if (
      body.error?.details?.preprocessing &&
      typeof body.error.details.preprocessing === "object"
    ) {
      preprocessing = body.error.details.preprocessing;
    }

    return { detail, preprocessing };
  } catch {
    return { detail: `Upload failed: ${response.status}`, preprocessing: null };
  }
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
