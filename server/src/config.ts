export type AppConfig = {
  appName: string;
  appVersion: string;
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  defaultDealershipId: number;
  sessionSecret: string;
};

const LOCAL_DEV_SESSION_SECRET = "local-dev-session-secret-change-before-production";
const LOCAL_DEV_CORS_ORIGIN = "http://localhost:5173";

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isLocalEnv = nodeEnv === "development" || nodeEnv === "test";

  const databaseUrl = process.env.DATABASE_URL;
  if (!isLocalEnv && !databaseUrl) {
    throw new Error(`DATABASE_URL is required when NODE_ENV=${nodeEnv}.`);
  }
  const port = parsePositiveInteger(process.env.PORT ?? "8000", "PORT");
  const defaultDealershipId = parsePositiveInteger(
    process.env.DEFAULT_DEALERSHIP_ID ?? "1",
    "DEFAULT_DEALERSHIP_ID",
  );

  const rawCorsOrigins = process.env.BACKEND_CORS_ORIGINS;
  if (!isLocalEnv && (rawCorsOrigins === undefined || rawCorsOrigins.trim() === "")) {
    throw new Error(
      `BACKEND_CORS_ORIGINS must list explicit allowed origins when NODE_ENV=${nodeEnv}.`,
    );
  }
  const corsOrigins = parseCorsOrigins(rawCorsOrigins ?? LOCAL_DEV_CORS_ORIGIN);
  if (!isLocalEnv && corsOrigins.length === 0) {
    throw new Error(
      `BACKEND_CORS_ORIGINS must list at least one allowed origin when NODE_ENV=${nodeEnv}.`,
    );
  }

  const providedSessionSecret = process.env.SESSION_SECRET;
  if (!isLocalEnv && !providedSessionSecret) {
    throw new Error(`SESSION_SECRET is required when NODE_ENV=${nodeEnv}.`);
  }
  const sessionSecret = providedSessionSecret ?? LOCAL_DEV_SESSION_SECRET;
  if (!isLocalEnv && sessionSecret === LOCAL_DEV_SESSION_SECRET) {
    throw new Error(
      `SESSION_SECRET must not use the local development default when NODE_ENV=${nodeEnv}.`,
    );
  }
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }

  return {
    appName: "Dealer Recon API",
    appVersion: "0.1.0",
    nodeEnv,
    port,
    databaseUrl: normalizeDatabaseUrl(
      databaseUrl ??
        "postgresql://dealer_recon:dealer_recon@localhost:5432/dealer_recon",
    ),
    corsOrigins,
    defaultDealershipId,
    sessionSecret,
  };
}

export function normalizeDatabaseUrl(databaseUrl: string): string {
  return databaseUrl.replace("postgresql+psycopg://", "postgresql://");
}

function parsePositiveInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseCorsOrigins(value: string): string[] {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of origins) {
    try {
      new URL(origin);
    } catch {
      throw new Error(`BACKEND_CORS_ORIGINS contains an invalid URL: ${origin}`);
    }
  }

  return origins;
}
