import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { PostgresAuthRepository } from "./auth.js";
import { logError, logInfo, serializeError } from "./logger.js";
import {
  createPool,
  PostgresTransactionRepository,
} from "./repositories/postgresTransactionRepository.js";

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  await assertDatabaseReady(pool);

  const repository = new PostgresTransactionRepository(pool);
  const authRepository = new PostgresAuthRepository(pool);
  const app = createApp(
    repository,
    config.corsOrigins,
    config.defaultDealershipId,
    async () => {
      await assertDatabaseReady(pool);
    },
    {
      authRepository,
      sessionSecret: config.sessionSecret,
      nodeEnv: config.nodeEnv,
      allowDevDealershipFallback: false,
    },
  );

  const server = app.listen(config.port, "0.0.0.0", () => {
    logInfo("server_started", {
      app_name: config.appName,
      app_version: config.appVersion,
      node_env: config.nodeEnv,
      port: config.port,
    });
  });

  process.on("SIGTERM", async () => {
    logInfo("server_shutdown_started", { signal: "SIGTERM" });
    server.close();
    await pool.end();
    process.exit(0);
  });
}

const requiredReadyTables = [
  "pgmigrations",
  "dealerships",
  "dealership_stores",
  "users",
  "source_files",
  "source_file_upload_contents",
  "transactions",
  "reconciliation_runs",
  "reconciliation_artifacts",
] as const;

export async function assertDatabaseReady(pool: ReturnType<typeof createPool>): Promise<void> {
  await pool.query("SELECT 1");
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [requiredReadyTables],
  );
  const present = new Set(result.rows.map((row) => row.table_name));
  const missing = requiredReadyTables.filter((table) => !present.has(table));
  if (missing.length > 0) {
    throw new Error(`Database migrations are not ready; missing tables: ${missing.join(", ")}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logError("server_start_failed", serializeError(error));
    process.exitCode = 1;
  });
}
