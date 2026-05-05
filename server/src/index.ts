import { loadConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { createApp } from "./app.js";
import {
  createPool,
  PostgresTransactionRepository,
} from "./repositories/postgresTransactionRepository.js";

async function main() {
  const config = loadConfig();
  await migrate(config.databaseUrl);

  const pool = createPool(config.databaseUrl);
  const repository = new PostgresTransactionRepository(pool);
  const app = createApp(repository, config.corsOrigins, config.defaultDealershipId);

  app.listen(config.port, "0.0.0.0", () => {
    console.log(`${config.appName} ${config.appVersion} listening on ${config.port}`);
  });

  process.on("SIGTERM", async () => {
    await pool.end();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
