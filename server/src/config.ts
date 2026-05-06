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

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const databaseUrl = process.env.DATABASE_URL;
  if (nodeEnv === "production" && !databaseUrl) {
    throw new Error("DATABASE_URL is required when NODE_ENV=production.");
  }
  const port = parsePositiveInteger(process.env.PORT ?? "8000", "PORT");
  const defaultDealershipId = parsePositiveInteger(
    process.env.DEFAULT_DEALERSHIP_ID ?? "1",
    "DEFAULT_DEALERSHIP_ID",
  );
  const corsOrigins = parseCorsOrigins(process.env.BACKEND_CORS_ORIGINS ?? "http://localhost:5173");
  const sessionSecret =
    process.env.SESSION_SECRET ?? "local-dev-session-secret-change-before-production";
  if (nodeEnv === "production" && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required when NODE_ENV=production.");
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
