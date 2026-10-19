import type pg from "pg";
import { logError } from "./logger.js";

type PoolErrorEvent = { event: "postgres_idle_client_error"; code: string };
const safeCodes = new Set(["57P01", "57P02", "57P03", "08003", "08006", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"]);

/** pg removes the failed idle client. Never retry a transaction or log the client. */
export function attachPoolErrorReporting(
  pool: pg.Pool,
  report: (event: PoolErrorEvent) => void = ({ event, code }) => logError(event, { code }),
): () => void {
  const onError = (error: unknown) => {
    const candidate = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
    const code = typeof candidate === "string" && safeCodes.has(candidate) ? candidate : "UNKNOWN";
    try {
      report({ event: "postgres_idle_client_error", code });
    } catch {
      // A broken reporter must remain visible without exposing its exception text.
      console.error(JSON.stringify({ level: "error", message: "postgres_idle_client_error", code, reporter_failed: true }));
    }
  };
  pool.on("error", onError);
  return () => { pool.off("error", onError); };
}
