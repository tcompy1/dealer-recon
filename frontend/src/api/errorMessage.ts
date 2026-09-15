import type { RooftopFailureDetails } from "../types/sourceFile";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: RooftopFailureDetails | null;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string | null;
      details?: RooftopFailureDetails | null;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code ?? null;
    this.details = options.details ?? null;
  }
}

export async function readApiError(response: Response, fallback: string): Promise<ApiError> {
  try {
    const body: unknown = await response.json();
    const message = messageFromApiErrorBody(body, response.status, fallback);
    const structuredError = isObject(body) && isObject(body.error) ? body.error : null;
    return new ApiError(message, {
      status: response.status,
      code: typeof structuredError?.code === "string" ? structuredError.code : null,
      details: isRooftopFailureDetails(structuredError?.details)
        ? structuredError.details
        : null,
    });
  } catch {
    return new ApiError(`${fallback}: ${response.status}`, { status: response.status });
  }
}

export function messageFromApiErrorBody(
  body: unknown,
  status: number,
  fallback: string,
): string {
  if (isObject(body)) {
    if (typeof body.detail === "string") {
      return body.detail;
    }
    const error = body.error;
    if (isObject(error) && typeof error.message === "string") {
      return error.message;
    }
  }

  return `${fallback}: ${status}`;
}

export async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    return messageFromApiErrorBody(await response.json(), response.status, fallback);
  } catch {
    return `${fallback}: ${response.status}`;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRooftopFailureDetails(value: unknown): value is RooftopFailureDetails {
  if (!isObject(value)) {
    return false;
  }

  const source = value.source;
  const accountingMonth = value.accounting_month;
  const rooftopProfileId = value.rooftop_profile_id;
  return (
    (source === "boa" || source === "dealertrack" || source === null) &&
    (typeof accountingMonth === "string" || accountingMonth === null) &&
    (typeof rooftopProfileId === "string" || rooftopProfileId === null) &&
    typeof value.recovery === "string" &&
    (value.evidence === undefined || isSafeEvidence(value.evidence))
  );
}

function isSafeEvidence(value: unknown): value is RooftopFailureDetails["evidence"] {
  return (
    isObject(value) &&
    Object.values(value).every(
      (entry) =>
        entry === null ||
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean",
    )
  );
}
