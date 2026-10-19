import pg from "pg";
import { afterEach, describe, expect, test, vi } from "vitest";
import { attachPoolErrorReporting } from "./databasePoolLifecycle.js";

afterEach(() => vi.restoreAllMocks());
describe("idle pool error reporting", () => {
  test("reports only an allowlisted code, never connection, message, SQL or client", () => {
    const pool = new pg.Pool();
    const report = vi.fn(); const detach = attachPoolErrorReporting(pool, report);
    pool.emit("error", Object.assign(new Error("private connection and SQL"), {code: "57P01", detail: "secret"}), {password: "secret"});
    expect(report.mock.calls).toEqual([[{event: "postgres_idle_client_error", code: "57P01"}]]);
    pool.emit("error", {code: "private attacker text"});
    expect(report).toHaveBeenLastCalledWith({event: "postgres_idle_client_error", code: "UNKNOWN"});
    detach(); expect(pool.listenerCount("error")).toBe(0);
  });
  test("keeps an observable safe fallback when the reporter throws", () => {
    const pool = new pg.Pool(); const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    attachPoolErrorReporting(pool, () => { throw new Error("private reporter failure"); });
    expect(() => pool.emit("error", {code: "ECONNRESET"})).not.toThrow();
    expect(stderr).toHaveBeenCalledWith('{"level":"error","message":"postgres_idle_client_error","code":"ECONNRESET","reporter_failed":true}');
  });
});
