import { randomBytes } from "node:crypto";

import { createTestPool as createPool } from "./testPostgresPool.js";

const DISPOSABLE_DATABASE_PREFIX = "dealer_recon_task10_";
const DISPOSABLE_DATABASE_NAME = /^dealer_recon_task10_[a-z0-9_]+$/;
const LOCAL_DATABASE_TARGETS = new Map([
  ["localhost", "5433"],
  ["127.0.0.1", "5433"],
  ["db", "5432"],
]);
const SAFE_BASE_DATABASE_PATH = "/dealer_recon";
const TARGET_VALIDATION_ERROR =
  "Disposable PostgreSQL databases require an exact local test database URL.";

export async function withDisposablePostgresDatabase<T>(
  baseDatabaseUrl: string,
  callback: (databaseUrl: string, databaseName: string) => Promise<T>,
): Promise<T> {
  const baseUrl = validateDisposablePostgresBaseUrl(baseDatabaseUrl);
  const databaseName = disposableDatabaseName();
  const quotedDatabaseName = quoteDisposableDatabaseName(databaseName);
  const adminPool = createPool(baseUrl.toString());
  let created = false;
  let result: T | undefined;
  let operationError: unknown;
  let operationFailed = false;

  try {
    await adminPool.query(`CREATE DATABASE ${quotedDatabaseName}`);
    created = true;

    const disposableUrl = new URL(baseUrl);
    disposableUrl.pathname = `/${databaseName}`;
    result = await callback(disposableUrl.toString(), databaseName);
  } catch (error) {
    operationError = error;
    operationFailed = true;
  }

  const cleanupErrors: unknown[] = [];
  if (created) {
    try {
      const sessions = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM pg_stat_activity WHERE datname = $1",
        [databaseName],
      );
      if (Number(sessions.rows[0]!.count) !== 0) {
        throw new Error(`Leaked PostgreSQL sessions prevent cleanup of ${databaseName}.`);
      }
      await adminPool.query(`DROP DATABASE ${quotedDatabaseName}`);
      const remaining = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM pg_database WHERE datname = $1",
        [databaseName],
      );
      if (Number(remaining.rows[0]!.count) !== 0) {
        throw new Error(`Disposable PostgreSQL database ${databaseName} was not removed.`);
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  try {
    await adminPool.end();
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (operationFailed && cleanupErrors.length) {
    throw new AggregateError([operationError, ...cleanupErrors],
      "Disposable database operation failed; cleanup also failed.", { cause: operationError });
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "Disposable database cleanup failed.");
  if (operationFailed) {
    throw operationError;
  }
  return result as T;
}

export function validateDisposablePostgresBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(TARGET_VALIDATION_ERROR);
  }
  const isTestProcess = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

  if (
    !isTestProcess ||
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    LOCAL_DATABASE_TARGETS.get(url.hostname) !== url.port ||
    url.pathname !== SAFE_BASE_DATABASE_PATH ||
    value.includes("?") ||
    value.includes("#") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(TARGET_VALIDATION_ERROR);
  }
  return url;
}

function disposableDatabaseName(): string {
  const name = [
    DISPOSABLE_DATABASE_PREFIX,
    process.pid.toString(36),
    Date.now().toString(36),
    randomBytes(4).toString("hex"),
  ].join("");
  quoteDisposableDatabaseName(name);
  return name;
}

function quoteDisposableDatabaseName(name: string): string {
  if (!DISPOSABLE_DATABASE_NAME.test(name) || name.length > 63) {
    throw new Error(`Invalid disposable PostgreSQL database name: ${name}`);
  }
  return `"${name}"`;
}
