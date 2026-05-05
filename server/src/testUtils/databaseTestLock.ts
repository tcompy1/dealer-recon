import { createPool } from "../repositories/postgresTransactionRepository.js";

const DATABASE_TEST_LOCK_ID = 762733002;

export async function withDatabaseTestLock<T>(
  databaseUrl: string,
  callback: () => Promise<T>,
): Promise<T> {
  const pool = createPool(databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [DATABASE_TEST_LOCK_ID]);
    return await callback();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [DATABASE_TEST_LOCK_ID]);
    client.release();
    await pool.end();
  }
}
