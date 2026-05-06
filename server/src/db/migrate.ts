import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(
  databaseUrl = loadConfig().databaseUrl,
  defaultDealershipId = loadConfig().defaultDealershipId,
  direction: "up" | "down" = "up",
): Promise<void> {
  const compiledMigrationsDir = path.resolve(__dirname, "migrations");
  const sourceMigrationsDir = path.resolve(__dirname, "../../src/db/migrations");
  const migrationsDir = existsSync(compiledMigrationsDir)
    ? compiledMigrationsDir
    : sourceMigrationsDir;
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = [
    "node-pg-migrate",
    direction,
    "--migrations-dir",
    migrationsDir,
    "--database-url-var",
    "DATABASE_URL",
    "--migrations-table",
    "pgmigrations",
  ];

  await run(command, args, {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DEFAULT_DEALERSHIP_ID: String(defaultDealershipId),
  });
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      shell: false,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Migration command failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate(undefined, undefined, process.argv[2] === "down" ? "down" : "up").catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
