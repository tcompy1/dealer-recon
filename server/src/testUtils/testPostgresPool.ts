import { createPool } from "../repositories/postgresTransactionRepository.js";

/** Test-owned pools must finish socket shutdown before their database is dropped. */
export function createTestPool(databaseUrl: string): ReturnType<typeof createPool> {
  const pool = createPool(databaseUrl);
  const closing = new Set<Promise<void>>();
  pool.on("connect", (client) => {
    let closed!: () => void;
    const completion = new Promise<void>((resolve) => { closed = resolve; });
    closing.add(completion);
    client.once("end", () => {
      closing.delete(completion);
      closed();
    });
  });
  const nativeEnd = pool.end.bind(pool);
  pool.end = ((callback?: (error?: Error) => void) => {
    const completion = (async () => {
      await nativeEnd();
      // pg-pool can resolve end() before idle client shutdown callbacks complete.
      await Promise.all([...closing]);
    })();
    if (callback) {
      void completion.then(() => callback(), (error: Error) => callback(error));
      return;
    }
    return completion;
  }) as typeof pool.end;
  return pool;
}
