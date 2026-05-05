export type AppConfig = {
  appName: string;
  appVersion: string;
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
};

export function loadConfig(): AppConfig {
  return {
    appName: "Dealer Recon API",
    appVersion: "0.1.0",
    port: Number(process.env.PORT ?? 8000),
    databaseUrl: normalizeDatabaseUrl(
      process.env.DATABASE_URL ??
        "postgresql://dealer_recon:dealer_recon@localhost:5432/dealer_recon",
    ),
    corsOrigins: (process.env.BACKEND_CORS_ORIGINS ?? "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

export function normalizeDatabaseUrl(databaseUrl: string): string {
  return databaseUrl.replace("postgresql+psycopg://", "postgresql://");
}
