import { API_BASE_URL, apiGet } from "./client";
import { ApiError, readApiError } from "./errorMessage";
import type {
  RooftopFailureDetails,
  SourceFileSummary,
  SourceType,
  UploadPreprocessingMetadata,
  UploadResponse,
} from "../types/sourceFile";

export type UploadSourceFileInput = {
  sourceType: SourceType;
  file: File;
  dealershipStoreId: number;
  accountingMonth: string;
};

export class UploadError extends ApiError {
  readonly preprocessing: UploadPreprocessingMetadata | null;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string | null;
      details?: RooftopFailureDetails | null;
      preprocessing?: UploadPreprocessingMetadata | null;
    },
  ) {
    super(message, options);
    this.name = "UploadError";
    this.preprocessing = options.preprocessing ?? null;
  }
}

export async function uploadSourceFile({
  sourceType,
  file,
  dealershipStoreId,
  accountingMonth,
}: UploadSourceFileInput): Promise<UploadResponse> {
  return sendUpload({ sourceType, file, dealershipStoreId, accountingMonth });
}

async function sendUpload({
  sourceType,
  file,
  dealershipStoreId,
  accountingMonth,
}: {
  sourceType: SourceType;
  file: File;
  dealershipStoreId?: number | null;
  accountingMonth?: string;
}): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("source_type", sourceType);
  if (dealershipStoreId !== undefined && dealershipStoreId !== null) {
    formData.append("store_id", String(dealershipStoreId));
  }
  if (accountingMonth !== undefined) {
    formData.append("accounting_month", accountingMonth);
  }
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!response.ok) {
    const apiError = await readApiError(response.clone(), "Upload failed");
    const preprocessing = await readUploadPreprocessing(response);
    throw new UploadError(apiError.message, {
      status: apiError.status,
      code: apiError.code,
      details: apiError.details,
      preprocessing,
    });
  }

  return response.json() as Promise<UploadResponse>;
}

async function readUploadPreprocessing(response: Response): Promise<UploadPreprocessingMetadata | null> {
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
    let preprocessing: UploadPreprocessingMetadata | null = null;
    if (body.preprocessing && typeof body.preprocessing === "object") {
      preprocessing = body.preprocessing;
    } else if (
      body.error?.details?.preprocessing &&
      typeof body.error.details.preprocessing === "object"
    ) {
      preprocessing = body.error.details.preprocessing;
    }

    return preprocessing;
  } catch {
    return null;
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

export function uploadTransactions(input: {
  sourceType: SourceType;
  file: File;
  dealershipStoreId?: number | null;
  accountingMonth?: string;
}): Promise<UploadResponse> {
  return sendUpload(input);
}
