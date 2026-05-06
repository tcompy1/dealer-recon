import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("loadConfig", () => {
  test("validates production DATABASE_URL", () => {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    process.env.SESSION_SECRET = "production-session-secret-with-enough-length";

    expect(() => loadConfig()).toThrow("DATABASE_URL is required");
  });

  test("validates production SESSION_SECRET", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://dealer_recon:dealer_recon@db:5432/dealer_recon";
    delete process.env.SESSION_SECRET;

    expect(() => loadConfig()).toThrow("SESSION_SECRET is required");
  });

  test("validates integer config values", () => {
    process.env.PORT = "not-a-port";

    expect(() => loadConfig()).toThrow("PORT must be a positive integer.");
  });

  test("validates CORS origins", () => {
    process.env.BACKEND_CORS_ORIGINS = "not-a-url";

    expect(() => loadConfig()).toThrow("BACKEND_CORS_ORIGINS contains an invalid URL");
  });
});
