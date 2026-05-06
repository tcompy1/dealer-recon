import { describe, expect, test } from "vitest";

import { createPool } from "../repositories/postgresTransactionRepository.js";
import { withDatabaseTestLock } from "../testUtils/databaseTestLock.js";
import { migrate } from "./migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase("migrate", () => {
  test("can run twice and leaves import scoping columns in place", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for migration tests.");
    }

    await withDatabaseTestLock(databaseUrl, async () => {
      await migrate(databaseUrl);
      await migrate(databaseUrl);

      const pool = createPool(databaseUrl);
      try {
        const tableResult = await pool.query<{
          source_files: string;
          transactions: string;
          reconciliation_runs: string;
          reconciliation_match_groups: string;
        reconciliation_match_group_transactions: string;
        reconciliation_exceptions: string;
        dealerships: string;
        users: string;
        }>(
          `SELECT
            to_regclass('public.source_files')::text AS source_files,
            to_regclass('public.transactions')::text AS transactions,
            to_regclass('public.reconciliation_runs')::text AS reconciliation_runs,
            to_regclass('public.reconciliation_match_groups')::text AS reconciliation_match_groups,
            to_regclass('public.reconciliation_match_group_transactions')::text AS reconciliation_match_group_transactions,
            to_regclass('public.reconciliation_exceptions')::text AS reconciliation_exceptions,
            to_regclass('public.dealerships')::text AS dealerships,
            to_regclass('public.users')::text AS users`,
        );
        expect(tableResult.rows[0]).toEqual({
          source_files: "source_files",
          transactions: "transactions",
          reconciliation_runs: "reconciliation_runs",
          reconciliation_match_groups: "reconciliation_match_groups",
          reconciliation_match_group_transactions: "reconciliation_match_group_transactions",
          reconciliation_exceptions: "reconciliation_exceptions",
          dealerships: "dealerships",
          users: "users",
        });

        const columnResult = await pool.query<{ column_name: string }>(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'transactions'
          AND column_name IN ('source_file_id', 'amount_cents', 'account_type', 'account_identifier')`,
        );
        expect(columnResult.rows).toHaveLength(4);
        const amountColumnResult = await pool.query<{ data_type: string }>(
          `SELECT data_type
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'transactions'
             AND column_name = 'amount_cents'`,
        );
        expect(amountColumnResult.rows[0].data_type).toBe("bigint");
        const legacyAmountColumnResult = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'transactions'
             AND column_name = 'amount'`,
        );
        expect(Number(legacyAmountColumnResult.rows[0].count)).toBe(0);

      const fkResult = await pool.query<{ confdeltype: string }>(
        `SELECT confdeltype
         FROM pg_constraint
         WHERE conname = 'transactions_source_file_id_fkey'`,
      );
      expect(fkResult.rows[0].confdeltype).toBe("c");
      const dealershipColumnResult = await pool.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND column_name = 'dealership_id'
           AND table_name IN (
             'source_files',
             'transactions',
             'reconciliation_runs',
             'reconciliation_exceptions',
             'users'
           )`,
      );
      expect(dealershipColumnResult.rows).toHaveLength(5);
      const dealershipFkResult = await pool.query<{ conname: string }>(
        `SELECT conname
         FROM pg_constraint
         WHERE conname IN (
           'source_files_dealership_id_fkey',
           'transactions_dealership_id_fkey',
           'reconciliation_runs_dealership_id_fkey',
           'reconciliation_exceptions_dealership_id_fkey'
         )`,
      );
      expect(dealershipFkResult.rows).toHaveLength(4);
        const exceptionColumnResult = await pool.query<{ column_name: string }>(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'reconciliation_exceptions'
             AND column_name IN ('status', 'note')`,
        );
        expect(exceptionColumnResult.rows).toHaveLength(2);
      } finally {
        await pool.end();
      }
    });
  });

  test("enforces transaction constraints and source file cascade delete", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for migration tests.");
    }

    await withDatabaseTestLock(databaseUrl, async () => {
      await migrate(databaseUrl);

      const pool = createPool(databaseUrl);
      try {
        const sourceFileResult = await pool.query<{ id: number }>(
          `INSERT INTO source_files (
            dealership_id,
            source_type,
            original_filename,
            stored_filename,
            file_hash,
            row_count,
            validation_error_count
          ) VALUES (1, 'boa', 'constraint-test.csv', NULL, $1, 1, 0)
          RETURNING id`,
          [`constraint-test-${Date.now()}`],
        );
        const sourceFileId = sourceFileResult.rows[0].id;

        await expect(
          pool.query(
            `INSERT INTO transactions (
              source_file_id,
              dealership_id,
              source_type,
              transaction_date,
              post_date,
              amount_cents,
              reference_number,
              description,
              account,
              account_type,
              account_identifier,
              stock_number,
              vin,
              raw_data
            ) VALUES ($1, 1, 'boa', '2026-04-30', NULL, 0, NULL, NULL, NULL, 'floorplan', 'floorplan', 'M10001', NULL, '{}'::jsonb)`,
            [sourceFileId],
          ),
        ).rejects.toThrow();

        const transactionResult = await pool.query<{ id: number }>(
          `INSERT INTO transactions (
            source_file_id,
            dealership_id,
            source_type,
            transaction_date,
            post_date,
            amount_cents,
            reference_number,
            description,
            account,
            account_type,
            account_identifier,
            stock_number,
            vin,
            raw_data
          ) VALUES ($1, 1, 'boa', '2026-04-30', NULL, 10000, NULL, NULL, NULL, 'floorplan', 'floorplan', 'M10001', NULL, '{}'::jsonb)
          RETURNING id`,
          [sourceFileId],
        );

        await pool.query("DELETE FROM source_files WHERE id = $1", [sourceFileId]);
        const transactionCount = await pool.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM transactions WHERE id = $1",
          [transactionResult.rows[0].id],
        );
        expect(Number(transactionCount.rows[0].count)).toBe(0);
      } finally {
        await pool.end();
      }
    });
  });
});
