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
    process.env.BACKEND_CORS_ORIGINS = "https://app.example.com";

    expect(() => loadConfig()).toThrow("DATABASE_URL is required");
  });

  test("validates production SESSION_SECRET", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://dealer_recon:dealer_recon@db:5432/dealer_recon";
    process.env.BACKEND_CORS_ORIGINS = "https://app.example.com";
    delete process.env.SESSION_SECRET;

    expect(() => loadConfig()).toThrow("SESSION_SECRET is required");
  });

  test("rejects the local-dev SESSION_SECRET default outside local environments", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://dealer_recon:dealer_recon@db:5432/dealer_recon";
    process.env.BACKEND_CORS_ORIGINS = "https://app.example.com";
    process.env.SESSION_SECRET = "local-dev-session-secret-change-before-production";

    expect(() => loadConfig()).toThrow("must not use the local development default");
  });

  test("requires BACKEND_CORS_ORIGINS in non-local environments", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://dealer_recon:dealer_recon@db:5432/dealer_recon";
    process.env.SESSION_SECRET = "production-session-secret-with-enough-length";
    delete process.env.BACKEND_CORS_ORIGINS;

    expect(() => loadConfig()).toThrow("BACKEND_CORS_ORIGINS must list explicit allowed origins");
  });

  test("requires BACKEND_CORS_ORIGINS in staging too", () => {
    process.env.NODE_ENV = "staging";
    process.env.DATABASE_URL = "postgresql://dealer_recon:dealer_recon@db:5432/dealer_recon";
    process.env.SESSION_SECRET = "staging-session-secret-with-enough-length-x";
    delete process.env.BACKEND_CORS_ORIGINS;

    expect(() => loadConfig()).toThrow("BACKEND_CORS_ORIGINS must list explicit allowed origins");
  });

  test("accepts a fully configured production environment", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://dealer_recon:dealer_recon@db:5432/dealer_recon";
    process.env.SESSION_SECRET = "production-session-secret-with-enough-length";
    process.env.BACKEND_CORS_ORIGINS = "https://app.example.com,https://admin.example.com";

    const config = loadConfig();
    expect(config.nodeEnv).toBe("production");
    expect(config.corsOrigins).toEqual([
      "https://app.example.com",
      "https://admin.example.com",
    ]);
  });

  test("allows the local development defaults when NODE_ENV=development", () => {
    process.env.NODE_ENV = "development";
    delete process.env.DATABASE_URL;
    delete process.env.SESSION_SECRET;
    delete process.env.BACKEND_CORS_ORIGINS;

    const config = loadConfig();
    expect(config.nodeEnv).toBe("development");
    expect(config.corsOrigins).toEqual(["http://localhost:5173"]);
    expect(config.sessionSecret.length).toBeGreaterThanOrEqual(32);
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
