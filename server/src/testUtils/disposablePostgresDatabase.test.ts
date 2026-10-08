import { beforeEach, describe, expect, test, vi } from "vitest";

const { createPoolMock } = vi.hoisted(() => ({
  createPoolMock: vi.fn(),
}));

vi.mock("../repositories/postgresTransactionRepository.js", () => ({
  createPool: createPoolMock,
}));

import {
  validateDisposablePostgresBaseUrl,
  withDisposablePostgresDatabase,
} from "./disposablePostgresDatabase.js";

const VALIDATION_ERROR =
  "Disposable PostgreSQL databases require an exact local test database URL.";
const unsafeTargets = [
  [
    "a host query override",
    "postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon?host=prod.example.com",
  ],
  [
    "an encoded host query override",
    "postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon?%68ost=prod.example.com",
  ],
  [
    "a hostaddr query override",
    "postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon?hostaddr=203.0.113.10",
  ],
  [
    "a service query override",
    "postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon?service=production",
  ],
  [
    "a socket query override",
    "postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon?host=%2Fvar%2Frun%2Fpostgresql",
  ],
  [
    "a URL fragment",
    "postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon#host=prod.example.com",
  ],
  [
    "an encoded query in the database path",
    "postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon%3Fhost%3Dprod.example.com",
  ],
  [
    "a remote authority",
    "postgresql://dealer_recon:dealer_recon@prod.example.com:5433/dealer_recon",
  ],
  [
    "an unsafe database name",
    "postgresql://dealer_recon:dealer_recon@localhost:5433/production",
  ],
  [
    "an unsafe maintenance database",
    "postgresql://dealer_recon:dealer_recon@localhost:5433/postgres",
  ],
  [
    "an omitted port",
    "postgresql://dealer_recon:dealer_recon@localhost/dealer_recon",
  ],
  [
    "an unapproved local port",
    "postgresql://dealer_recon:dealer_recon@localhost:5432/dealer_recon",
  ],
  [
    "an IPv6 authority",
    "postgresql://dealer_recon:dealer_recon@[::1]:5433/dealer_recon",
  ],
] as const;

describe("disposable PostgreSQL database target validation", () => {
  beforeEach(() => {
    createPoolMock.mockReset();
    createPoolMock.mockImplementation(() => {
      throw new Error("network access was attempted");
    });
  });

  test.each(unsafeTargets)("rejects %s before opening a pool", async (_case, databaseUrl) => {
    await expect(
      withDisposablePostgresDatabase(databaseUrl, async () => undefined),
    ).rejects.toThrow(VALIDATION_ERROR);
    expect(createPoolMock).not.toHaveBeenCalled();
  });

  test.each([
    ["localhost", "postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon"],
    ["IPv4 loopback", "postgresql://dealer_recon:dealer_recon@127.0.0.1:5433/dealer_recon"],
    ["the Compose database service", "postgresql://dealer_recon:dealer_recon@db:5432/dealer_recon"],
  ] as const)("accepts %s as an exact supported target", (_case, supportedUrl) => {
    expect(validateDisposablePostgresBaseUrl(supportedUrl).toString()).toBe(supportedUrl);
    expect(createPoolMock).not.toHaveBeenCalled();
  });
});

describe("disposable cleanup failures", () => {
  const url = "postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon";
  function admin(leaked = 0, dropError?: Error) {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("DROP") && dropError) throw dropError;
      return { rows: [{ count: sql.includes("pg_stat_activity") ? String(leaked) : "0" }] };
    });
    const pool = { query, end: vi.fn(async () => undefined), on: vi.fn() };
    createPoolMock.mockReturnValue(pool);
    return pool;
  }
  test("normal cleanup detects remaining sessions without force terminating them", async () => {
    const pool = admin(1);
    await expect(withDisposablePostgresDatabase(url, async () => undefined)).rejects.toThrow("Leaked PostgreSQL sessions");
    expect(pool.query.mock.calls.some(([sql]) => sql.startsWith("DROP"))).toBe(false);
  });
  test("normal drop never uses FORCE", async () => {
    const pool = admin();
    await withDisposablePostgresDatabase(url, async () => undefined);
    const drops = pool.query.mock.calls.filter(([sql]) => sql.startsWith("DROP"));
    expect(drops).toHaveLength(1);
    expect(drops[0][0]).not.toContain("FORCE");
  });
  test("operation and cleanup failures both survive with the operation as cause", async () => {
    const operation = new Error("original operation failure"), cleanup = new Error("cleanup failure");
    admin(0, cleanup);
    const error = await withDisposablePostgresDatabase(url, async () => { throw operation; }).catch(e => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.cause).toBe(operation);
    expect(error.errors).toEqual([operation, cleanup]);
  });
});
