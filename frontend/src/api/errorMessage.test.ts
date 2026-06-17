import { describe, expect, test } from "vitest";

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
