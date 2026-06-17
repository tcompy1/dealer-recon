import type pg from "pg";

import { hashPassword } from "../auth.js";
import { loadConfig } from "../config.js";
import { createPool } from "../repositories/postgresTransactionRepository.js";

export const DEMO_AUTH_EMAIL = "demo@dealer-recon.local";
export const DEMO_AUTH_PASSWORD = "dealer-recon-demo";

type SeedDemoAuthOptions = {
  nodeEnv?: string;
  dealershipId?: number;
  storeId?: number;
  email?: string;
  password?: string;
};

export async function seedDemoAuthUser(
  pool: pg.Pool,
  options: SeedDemoAuthOptions = {},
): Promise<void> {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  if (nodeEnv !== "development" && nodeEnv !== "test") {
    throw new Error("Demo auth seeding is only allowed in development or test environments.");
  }

  const dealershipId = options.dealershipId ?? 1;
  const storeId = options.storeId ?? 1;
  const email = (options.email ?? DEMO_AUTH_EMAIL).toLowerCase();
  const passwordHash = await hashPassword(options.password ?? DEMO_AUTH_PASSWORD);

  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO dealerships (id, name)
       VALUES ($1, 'Configured Dealership')
       ON CONFLICT (id) DO NOTHING`,
      [dealershipId],
    );

    await pool.query(
      `INSERT INTO users (email, password_hash, dealership_id, role)
       SELECT $1, $2, $3, 'accounting_user'
       WHERE NOT EXISTS (
         SELECT 1 FROM users WHERE lower(email) = lower($1)
       )`,
      [email, passwordHash, dealershipId],
    );

    await pool.query(
      `UPDATE users
       SET password_hash = $2,
           dealership_id = $3,
           role = COALESCE(role, 'accounting_user')
       WHERE lower(email) = lower($1)`,
      [email, passwordHash, dealershipId],
    );

    await pool.query(
      `INSERT INTO user_store_assignments (user_id, dealership_store_id)
       SELECT u.id, $2
       FROM users u
       WHERE lower(u.email) = lower($1)
         AND EXISTS (SELECT 1 FROM dealership_stores WHERE id = $2)
       ON CONFLICT (user_id, dealership_store_id) DO NOTHING`,
      [email, storeId],
    );

    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  seedDemoAuthUser(pool, {
    nodeEnv: config.nodeEnv,
    dealershipId: config.defaultDealershipId,
  })
    .then(() => {
      console.log(`Seeded local demo auth user ${DEMO_AUTH_EMAIL}.`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
