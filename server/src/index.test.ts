import { describe, expect, test, vi } from "vitest";

import { assertDatabaseReady } from "./index.js";

describe("assertDatabaseReady", () => {
  test("rejects when required migration tables are absent", async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { table_name: "pgmigrations" },
            { table_name: "dealerships" },
          ],
        }),
    } as unknown as Parameters<typeof assertDatabaseReady>[0];

    await expect(assertDatabaseReady(pool)).rejects.toThrow(
      "Database migrations are not ready; missing tables:",
    );
  });
});
