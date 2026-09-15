import type { Server } from "node:http";

import { afterEach, describe, expect, test } from "vitest";

import { startE2eServer } from "./startE2eServer.js";

const E2E_SERVER_URL = "http://127.0.0.1:8001";
const ALLOWED_ORIGIN = "http://127.0.0.1:5174";
const DISALLOWED_ORIGIN = "http://not-allowed.example";

describe("startE2eServer", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = null;
  });

  test("uses memory state and permits only the browser test origin", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://127.0.0.1:1/e2e-must-not-connect";

    try {
      server = await startE2eServer();

      const allowedResponse = await fetch(`${E2E_SERVER_URL}/stores`, {
        headers: { Origin: ALLOWED_ORIGIN },
      });
      expect(allowedResponse.status).toBe(200);
      expect(allowedResponse.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
      expect(allowedResponse.headers.get("access-control-allow-credentials")).toBe("true");
      await expect(allowedResponse.json()).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "Hiley Acura" })]),
      );

      const disallowedResponse = await fetch(`${E2E_SERVER_URL}/stores`, {
        headers: { Origin: DISALLOWED_ORIGIN },
      });
      expect(disallowedResponse.status).toBe(200);
      expect(disallowedResponse.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });
});
