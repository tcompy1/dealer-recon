import { afterEach, describe, expect, test, vi } from "vitest";

import { apiGet, apiPatch, apiPost } from "./client";
import { ApiError, readApiError } from "./errorMessage";

describe("readApiError", () => {
  test("preserves the structured rooftop error code, details, and recovery", async () => {
    const details = {
      source: "boa" as const,
      accounting_month: "2026-03",
      rooftop_profile_id: "acura-v1",
      evidence: { explicit_month: "2026-04" },
      recovery: "Select April 2026 and upload the BOA file again.",
    };
    const response = jsonResponse(
      {
        error: {
          code: "SOURCE_PERIOD_MISMATCH",
          message: "The BOA statement period does not match the selected accounting month.",
          details,
        },
      },
      422,
    );

    const error = await readApiError(response, "Upload failed");

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: "The BOA statement period does not match the selected accounting month.",
      status: 422,
      code: "SOURCE_PERIOD_MISMATCH",
      details,
    });
  });

  test("preserves legacy detail responses without fabricating structured fields", async () => {
    const error = await readApiError(
      jsonResponse({ detail: "Invalid store_id." }, 422),
      "API request failed",
    );

    expect(error).toMatchObject({
      message: "Invalid store_id.",
      status: 422,
      code: null,
      details: null,
    });
  });

  test("falls back to status when the response body is not JSON", async () => {
    const error = await readApiError(new Response("not-json", { status: 500 }), "API request failed");

    expect(error).toMatchObject({
      message: "API request failed: 500",
      status: 500,
      code: null,
      details: null,
    });
  });
});

describe("API client error propagation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("apiGet throws the structured ApiError returned by the backend", async () => {
    const details = {
      source: null,
      accounting_month: "2026-04",
      rooftop_profile_id: null,
      recovery: "Select an enabled rooftop.",
    };
    const fetchMock = mockFetch({
      error: {
        code: "ROOFTOP_PROFILE_UNSUPPORTED",
        message: "Not authorized for this store.",
        details,
      },
    }, 403);

    await expect(apiGet("/source-files")).rejects.toMatchObject({
      message: "Not authorized for this store.",
      status: 403,
      code: "ROOFTOP_PROFILE_UNSUPPORTED",
      details,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/source-files",
      { credentials: "include" },
    );
  });

  test("apiPost surfaces legacy detail responses", async () => {
    const fetchMock = mockFetch({ detail: "Invalid dealership_store_id." }, 422);

    await expect(apiPost("/reconcile", { dealership_store_id: "bad" })).rejects.toThrow(
      "Invalid dealership_store_id.",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/reconcile",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ dealership_store_id: "bad" }),
      }),
    );
  });

  test("apiPatch surfaces backend error.message responses", async () => {
    const fetchMock = mockFetch({ error: { message: "Read-only users cannot update exceptions." } }, 403);

    await expect(apiPatch("/reconciliation-runs/1/exceptions/1", { review_status: "reviewed" }))
      .rejects.toThrow("Read-only users cannot update exceptions.");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/reconciliation-runs/1/exceptions/1",
      expect.objectContaining({ method: "PATCH", credentials: "include" }),
    );
  });
});

function mockFetch(body: unknown, status: number) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body, status));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
