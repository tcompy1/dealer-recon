import { randomBytes } from "node:crypto";

import { createPool } from "../repositories/postgresTransactionRepository.js";

const DISPOSABLE_DATABASE_PREFIX = "dealer_recon_task10_";
const DISPOSABLE_DATABASE_NAME = /^dealer_recon_task10_[a-z0-9_]+$/;
const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "db"]);

export async function withDisposablePostgresDatabase<T>(
  baseDatabaseUrl: string,
  callback: (databaseUrl: string, databaseName: string) => Promise<T>,
): Promise<T> {
  const baseUrl = validatedLocalTestDatabaseUrl(baseDatabaseUrl);
  const databaseName = disposableDatabaseName();
  const quotedDatabaseName = quoteDisposableDatabaseName(databaseName);
  const adminPool = createPool(baseUrl.toString());
  let created = false;
  let result: T | undefined;
  let operationError: unknown;

  try {
    await adminPool.query(`CREATE DATABASE ${quotedDatabaseName}`);
    created = true;

    const disposableUrl = new URL(baseUrl);
    disposableUrl.pathname = `/${databaseName}`;
    result = await callback(disposableUrl.toString(), databaseName);
  } catch (error) {
    operationError = error;
  }

  let cleanupError: unknown;
  if (created) {
    try {
      await adminPool.query(`DROP DATABASE ${quotedDatabaseName} WITH (FORCE)`);
      const remaining = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM pg_database WHERE datname = $1",
        [databaseName],
      );
      if (Number(remaining.rows[0]!.count) !== 0) {
        throw new Error(`Disposable PostgreSQL database ${databaseName} was not removed.`);
      }
    } catch (error) {
      cleanupError = error;
    }
  }

  try {
    await adminPool.end();
  } catch (error) {
    cleanupError ??= error;
  }

  if (cleanupError) {
    throw cleanupError;
  }
  if (operationError) {
    throw operationError;
  }
  return result as T;
}

function validatedLocalTestDatabaseUrl(value: string): URL {
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  const isTestProcess = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

  if (
    !isTestProcess ||
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    !LOCAL_DATABASE_HOSTS.has(url.hostname) ||
    databaseName.length === 0 ||
    databaseName.startsWith(DISPOSABLE_DATABASE_PREFIX)
  ) {
    throw new Error("Disposable PostgreSQL databases require a local, non-disposable test database URL.");
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
