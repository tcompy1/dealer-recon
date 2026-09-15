import type { Server } from "node:http";
import { pathToFileURL } from "node:url";

import { createApp } from "../app.js";
import { MemoryTransactionRepository } from "../repositories/transactionRepository.js";

const E2E_HOST = "127.0.0.1";
const E2E_PORT = 8001;

export async function startE2eServer(): Promise<Server> {
  const repository = new MemoryTransactionRepository();
  await repository.createDealershipStore(1, {
    name: "Hiley Acura",
    dealer_group_id: 1,
  });
  const app = createApp(repository, [], 1, async () => undefined, {
    nodeEnv: "test",
    allowDevDealershipFallback: true,
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(E2E_PORT, E2E_HOST);
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startE2eServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
