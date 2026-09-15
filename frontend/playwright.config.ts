import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalTimeout: 10 * 60_000,
  timeout: 60_000,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: "http://127.0.0.1:5174",
  },
  webServer: [
    {
      command: "npm run dev:e2e",
      cwd: "../server",
      url: "http://127.0.0.1:8001/health",
      reuseExistingServer: false,
    },
    {
      command:
        "VITE_API_BASE_URL=http://127.0.0.1:8001 npm run dev -- --host 127.0.0.1 --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
    },
  ],
});
