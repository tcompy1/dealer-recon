import request from "supertest";
import { describe, expect, test } from "vitest";

import { createApp } from "../app.js";
import { PostgresAuthRepository } from "../auth.js";
import { migrate } from "./migrate.js";
import { seedDemoAuthUser } from "./seedDemoAuth.js";
import {
  createPool,
  PostgresTransactionRepository,
} from "../repositories/postgresTransactionRepository.js";
import { withDatabaseTestLock } from "../testUtils/databaseTestLock.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

const DEMO_EMAIL = "demo@dealer-recon.local";
const DEMO_PASSWORD = "dealer-recon-demo";

const boaCsvRow = (stockNumber: string, vin: string, amount: string, reference: string) =>
  `,,,9/26/2025,${reference},,${stockNumber},,${vin},,"${amount}",`;

describeIfDatabase("explicit local demo auth seed", () => {
  test("logs in, returns /me, has store 1 access, and can upload", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for demo auth tests.");
    }

    await withDatabaseTestLock(databaseUrl, async () => {
      await migrate(databaseUrl);

      const pool = createPool(databaseUrl);
      try {
        await seedDemoAuthUser(pool, { nodeEnv: "test" });
        const repository = new PostgresTransactionRepository(pool);
        const authRepository = new PostgresAuthRepository(pool);
        const app = createApp(repository, [], 1, async () => undefined, {
          authRepository,
          sessionSecret: "test-session-secret-with-enough-length",
          nodeEnv: "test",
          allowDevDealershipFallback: false,
        });
        const agent = request.agent(app);

        const loginResponse = await agent
          .post("/login")
          .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
        expect(loginResponse.status).toBe(200);
        expect(loginResponse.body.user).toMatchObject({
          email: DEMO_EMAIL,
          dealership_id: 1,
        });
        expect(loginResponse.body.user.store_ids).toContain(1);

        const meResponse = await agent.get("/me");
        expect(meResponse.status).toBe(200);
        expect(meResponse.body.user).toMatchObject({
          email: DEMO_EMAIL,
          dealership_id: 1,
        });
        expect(meResponse.body.user.store_ids).toContain(1);

        const storesResponse = await agent.get("/stores");
        expect(storesResponse.status).toBe(200);
        expect(storesResponse.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 1, name: "Hiley Mazda of Hurst" }),
          ]),
        );

        const unique = `${Date.now()}-${Math.random()}`;
        const csv = boaCsvRow("M40101", "1HGCM82633A004352", "$401.00", `40101-${unique}`);
        const uploadResponse = await agent
          .post("/upload")
          .field("source_type", "boa")
          .field("store_id", "1")
          .attach("file", Buffer.from(csv), `demo-auth-${unique}.csv`);
        expect(uploadResponse.status).toBe(200);
        expect(uploadResponse.body).toMatchObject({
          source_type: "boa",
          dealership_store_id: 1,
        });
      } finally {
        await pool.end();
      }
    });
  });

  test("seeds the demo user with bcrypt hash and store 1 assignment", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for demo auth tests.");
    }

    await withDatabaseTestLock(databaseUrl, async () => {
      await migrate(databaseUrl);

      const pool = createPool(databaseUrl);
      try {
        await seedDemoAuthUser(pool, { nodeEnv: "test" });
        const userResult = await pool.query<{
          id: number;
          password_hash: string;
          dealership_id: number;
        }>(
          "SELECT id, password_hash, dealership_id FROM users WHERE lower(email) = lower($1)",
          [DEMO_EMAIL],
        );
        expect(userResult.rows).toHaveLength(1);
        const seededUser = userResult.rows[0];
        expect(seededUser.dealership_id).toBe(1);
        expect(seededUser.password_hash.startsWith("$2")).toBe(true);

        const assignmentResult = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM user_store_assignments
           WHERE user_id = $1 AND dealership_store_id = 1`,
          [seededUser.id],
        );
        expect(Number(assignmentResult.rows[0].count)).toBe(1);
      } finally {
        await pool.end();
      }
    });
  });

  test("refuses to seed the demo user outside development and test", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for demo auth tests.");
    }

    await withDatabaseTestLock(databaseUrl, async () => {
      await migrate(databaseUrl);

      const pool = createPool(databaseUrl);
      try {
        await expect(
          seedDemoAuthUser(pool, { nodeEnv: "production" }),
        ).rejects.toThrow("only allowed in development or test");
      } finally {
        await pool.end();
      }
    });
  });

});
