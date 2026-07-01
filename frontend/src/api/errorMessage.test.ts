import { afterEach, describe, expect, test, vi } from "vitest";

import { apiGet, apiPatch, apiPost } from "./client";
import { messageFromApiErrorBody } from "./errorMessage";

describe("messageFromApiErrorBody", () => {
  test("surfaces backend error.message responses", () => {
    expect(
      messageFromApiErrorBody(
        { error: { message: "Not authorized for this store." } },
        403,
        "API request failed",
      ),
    ).toBe("Not authorized for this store.");
  });

  test("preserves legacy detail responses", () => {
    expect(
      messageFromApiErrorBody(
        { detail: "Invalid store_id." },
        422,
        "API request failed",
      ),
    ).toBe("Invalid store_id.");
  });

  test("falls back to status when the body has no concrete message", () => {
    expect(messageFromApiErrorBody({}, 500, "API request failed")).toBe(
      "API request failed: 500",
    );
  });
});

describe("API client error propagation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("apiGet surfaces backend error.message responses", async () => {
    const fetchMock = mockFetch({ error: { message: "Not authorized for this store." } }, 403);

    await expect(apiGet("/source-files")).rejects.toThrow("Not authorized for this store.");
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
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
