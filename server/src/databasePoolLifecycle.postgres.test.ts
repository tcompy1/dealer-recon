import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "vitest";
import { withDisposablePostgresDatabase } from "./testUtils/disposablePostgresDatabase.js";
import { attachPoolErrorReporting } from "./databasePoolLifecycle.js";
import { createTestPool } from "./testUtils/testPostgresPool.js";

const base = process.env.DATABASE_URL;
async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await check()) return; await delay(20); }
  throw new Error("bounded database lifecycle condition not reached");
}

test.skipIf(!base)("server survives an owned idle PostgreSQL termination and reconnects without hiding the error", async () => {
  await withDisposablePostgresDatabase(base!, async (url, databaseName) => {
    const admin = createTestPool(url);
    const control = createTestPool(base!);
    const listener = createServer();
    listener.listen(0, "127.0.0.1"); await once(listener, "listening");
    const address = listener.address();
    if (!address || typeof address === "string") throw new Error("no test port");
    const port = address.port; await new Promise<void>(resolve => listener.close(() => resolve()));
    const tables = ["pgmigrations", "dealerships", "dealership_stores", "users", "source_files", "source_file_upload_contents", "transactions", "reconciliation_runs", "reconciliation_artifacts"];
    for (const table of tables) await admin.query(`CREATE TABLE ${table} (id integer)`);
    const appName = `resilience-${process.pid}-${port}`;
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url, PGAPPNAME: appName, PORT: String(port), NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk.toString(); });
    child.stderr.on("data", chunk => { output += chunk.toString(); });
    try {
      await until(() => output.includes('"server_started"') || child.exitCode !== null);
      expect(child.exitCode, output).toBeNull();
      const sessions = await admin.query<{pid: number}>("SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND state = 'idle'", [appName]);
      expect(sessions.rows).toHaveLength(1);
      await admin.query("SELECT pg_terminate_backend($1)", [sessions.rows[0].pid]);
      await until(() => output.includes('"postgres_idle_client_error"') || child.exitCode !== null);
      expect(child.exitCode, output).toBeNull();
      const events = output.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({message: "postgres_idle_client_error", code: "57P01"}));
      const event = events.find(event => event.message === "postgres_idle_client_error");
      expect(Object.keys(event).sort()).toEqual(["code", "level", "message", "timestamp"]);
      expect(output).not.toContain(url);
      const response = await fetch(`http://127.0.0.1:${port}/ready`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({status: "ready"});
      const current = await admin.query<{pid: number}>("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1", [appName]);
      expect(current.rows).toHaveLength(1);
      expect(current.rows[0].pid).not.toBe(sessions.rows[0].pid);
      expect((await fetch(`http://127.0.0.1:${port}/me`)).status).toBe(401);
      // Control connection changes only this disposable database; it cannot target itself.
      await control.query(`ALTER DATABASE "${databaseName}" ALLOW_CONNECTIONS false`);
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1", [appName]);
      expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(503);
      await control.query(`ALTER DATABASE "${databaseName}" ALLOW_CONNECTIONS true`);
      expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(200);
    } finally {
      try {
        await control.query(`ALTER DATABASE "${databaseName}" ALLOW_CONNECTIONS true`);
      } finally {
        try {
          if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
          await until(async () => Number((await admin.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1", [appName])).rows[0].count) === 0);
        } finally { await Promise.all([admin.end(), control.end()]); }
      }
    }
  });
}, 25000);


test.skipIf(!base)("an interrupted checked-out transaction rejects and is never replayed", async () => {
  await withDisposablePostgresDatabase(base!, async url => {
    const pool = createTestPool(url);
    const admin = createTestPool(url);
    const errors: string[] = [];
    attachPoolErrorReporting(pool, event => errors.push(event.code));
    try {
      await admin.query("CREATE TABLE synthetic_writes (id integer PRIMARY KEY)");
      const client = await pool.connect();
      try {
        const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        await client.query("BEGIN"); await client.query("INSERT INTO synthetic_writes VALUES (1)");
        const operation = client.query("SELECT pg_sleep(20)").catch(error => error);
        await until(async () => (await admin.query("SELECT state FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.state === "active");
        await admin.query("SELECT pg_terminate_backend($1)", [pid]);
        expect(await operation).toMatchObject({code: "57P01"});
      } finally { client.release(true); }
      expect((await pool.query("SELECT count(*) FROM synthetic_writes")).rows[0].count).toBe("0");
      await pool.query("INSERT INTO synthetic_writes VALUES (2)");
      expect((await pool.query("SELECT id FROM synthetic_writes")).rows).toEqual([{id: 2}]);
      expect(errors).toEqual([]); // The operation rejection, not the idle listener, owns this failure.
    } finally { await pool.end(); await admin.end(); }
  });
}, 25000);
