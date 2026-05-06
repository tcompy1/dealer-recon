import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
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
  const app = createApp(
    repository,
    config.corsOrigins,
    config.defaultDealershipId,
    async () => {
      await assertDatabaseReady(pool);
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

async function assertDatabaseReady(pool: ReturnType<typeof createPool>): Promise<void> {
  await pool.query("SELECT 1");
}

main().catch((error) => {
  logError("server_start_failed", serializeError(error));
  process.exitCode = 1;
});
