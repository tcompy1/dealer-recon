type ApiErrorBody = {
  detail?: unknown;
  error?: {
    message?: unknown;
  } | null;
};

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

function isObject(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null;
}
