import {ROOFTOP_PROFILES} from "../config/storeWorkflowConfig.js";
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";

import { createApp } from "../app.js";
import { MemoryTransactionRepository } from "../repositories/transactionRepository.js";

const E2E_HOST = "127.0.0.1";
const E2E_PORT = 8001;
const E2E_WEB_ORIGINS = ["http://127.0.0.1:5174"];

export async function startE2eServer(): Promise<Server> {
  const repository = new MemoryTransactionRepository();
  await repository.createDealershipStore(1, {
    name: "Hiley Acura",
    dealer_group_id: 1,
  });
  await repository.createDealershipStore(1,{name:"Hiley Cars Fort Worth",dealer_group_id:1});
  // This entry point is exclusively the in-memory browser-test server.
  const priorEnabled=ROOFTOP_PROFILES.fw.enabled;
  ROOFTOP_PROFILES.fw.enabled=true;
  const app = createApp(repository, E2E_WEB_ORIGINS, 1, async () => undefined, {
    nodeEnv: "test",
    allowDevDealershipFallback: true,
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(E2E_PORT, E2E_HOST);
    const failed=(error:Error)=>{ROOFTOP_PROFILES.fw.enabled=priorEnabled;reject(error);};
    server.once("close",()=>{ROOFTOP_PROFILES.fw.enabled=priorEnabled;});
    server.once("error", failed);
    server.once("listening", () => {
      server.off("error", failed);
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
