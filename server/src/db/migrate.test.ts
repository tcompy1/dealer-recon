import { execFile } from "node:child_process";

import { describe, expect, test } from "vitest";

import { createPool } from "../repositories/postgresTransactionRepository.js";
import { withDatabaseTestLock } from "../testUtils/databaseTestLock.js";
import { migrate } from "./migrate.js";

const DEMO_EMAIL = "demo@dealer-recon.local";
const ROLLBACK_COLLISION_ERROR =
  "Cannot roll back 1789344000000_add_rooftop_run_identity: source_files contains identities that the legacy uniqueness constraint cannot represent.";

class MigrationCommandError extends Error {
  stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.name = "MigrationCommandError";
    this.stderr = stderr;
  }
}

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase("migrate", () => {
  test("can run twice and leaves import scoping and reconciliation identity columns in place", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for migration tests.");
    }

    await withDatabaseTestLock(databaseUrl, async () => {
      const demoUserCountBefore = await countDemoUsersIfSchemaExists(databaseUrl);
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
        source_file_upload_contents: string;
        reconciliation_artifacts: string;
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
            to_regclass('public.source_file_upload_contents')::text AS source_file_upload_contents,
            to_regclass('public.reconciliation_artifacts')::text AS reconciliation_artifacts,
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
          source_file_upload_contents: "source_file_upload_contents",
          reconciliation_artifacts: "reconciliation_artifacts",
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
        const userPasswordColumnResult = await pool.query<{ column_name: string }>(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'users'
             AND column_name = 'password_hash'
             AND is_nullable = 'NO'`,
        );
        expect(userPasswordColumnResult.rows).toHaveLength(1);
        const demoUserResult = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM users
           WHERE lower(email) = lower($1)`,
          [DEMO_EMAIL],
        );
        expect(Number(demoUserResult.rows[0].count)).toBe(demoUserCountBefore ?? 0);
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
             AND column_name IN (
               'status',
               'note',
               'review_status',
               'assigned_to',
               'review_notes',
               'reviewed_at',
               'reviewed_by'
             )`,
        );
        expect(exceptionColumnResult.rows).toHaveLength(7);

        const identityColumnResult = await pool.query<{
          table_name: string;
          column_name: string;
          data_type: string;
          is_nullable: string;
        }>(
          `SELECT table_name, column_name, data_type, is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND (
               (table_name = 'source_files' AND column_name IN (
                 'accounting_month',
                 'rooftop_profile_id',
                 'rooftop_profile_version',
                 'parser_name',
                 'parser_version',
                 'preprocessor_name',
                 'preprocessor_version',
                 'preprocessing_metadata'
               ))
               OR
               (table_name = 'reconciliation_runs' AND column_name IN (
                 'accounting_month',
                 'rooftop_profile_id',
                 'rooftop_profile_version'
               ))
             )
           ORDER BY table_name, column_name`,
        );
        expect(identityColumnResult.rows).toEqual([
          {
            table_name: "reconciliation_runs",
            column_name: "accounting_month",
            data_type: "text",
            is_nullable: "YES",
          },
          {
            table_name: "reconciliation_runs",
            column_name: "rooftop_profile_id",
            data_type: "text",
            is_nullable: "YES",
          },
          {
            table_name: "reconciliation_runs",
            column_name: "rooftop_profile_version",
            data_type: "text",
            is_nullable: "YES",
          },
          {
            table_name: "source_files",
            column_name: "accounting_month",
            data_type: "text",
            is_nullable: "YES",
          },
          {
            table_name: "source_files",
            column_name: "parser_name",
            data_type: "text",
            is_nullable: "YES",
          },
          {
            table_name: "source_files",
            column_name: "parser_version",
            data_type: "text",
            is_nullable: "YES",
          },
          {
            table_name: "source_files",
            column_name: "preprocessing_metadata",
            data_type: "jsonb",
            is_nullable: "YES",
          },
          {
            table_name: "source_files",
            column_name: "preprocessor_name",
            data_type: "text",
            is_nullable: "YES",
          },
          {
            table_name: "source_files",
            column_name: "preprocessor_version",
            data_type: "text",
            is_nullable: "YES",
          },
          {
            table_name: "source_files",
            column_name: "rooftop_profile_id",
            data_type: "text",
            is_nullable: "YES",
          },
          {
            table_name: "source_files",
            column_name: "rooftop_profile_version",
            data_type: "text",
            is_nullable: "YES",
          },
        ]);

        const indexResult = await pool.query<{ indexname: string; indexdef: string }>(
          `SELECT indexname, indexdef
           FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname IN (
               'ux_source_files_dealership_source_type_file_hash',
               'ux_source_files_legacy_identity',
               'ux_source_files_reusable_identity'
             )
           ORDER BY indexname`,
        );
        expect(indexResult.rows).toEqual([
          {
            indexname: "ux_source_files_legacy_identity",
            indexdef: expect.stringContaining("accounting_month IS NULL"),
          },
          {
            indexname: "ux_source_files_reusable_identity",
            indexdef: expect.stringMatching(
              /UNIQUE INDEX ux_source_files_reusable_identity ON public\.source_files USING btree \(dealership_id, dealership_store_id, source_type, accounting_month, rooftop_profile_id, rooftop_profile_version, file_hash, parser_name, parser_version, preprocessor_name, preprocessor_version\)$/,
            ),
          },
        ]);
        for (const nullableIdentityColumn of [
          "accounting_month",
          "rooftop_profile_id",
          "rooftop_profile_version",
          "parser_name",
          "parser_version",
          "preprocessor_name",
          "preprocessor_version",
        ]) {
          expect(indexResult.rows[0].indexdef).toContain(
            `${nullableIdentityColumn} IS NULL`,
          );
        }

        const monthConstraintResult = await pool.query<{ conname: string }>(
          `SELECT conname
           FROM pg_constraint
           WHERE conname IN (
             'source_files_accounting_month_check',
             'reconciliation_runs_accounting_month_check'
           )
           ORDER BY conname`,
        );
        expect(monthConstraintResult.rows).toEqual([
          { conname: "reconciliation_runs_accounting_month_check" },
          { conname: "source_files_accounting_month_check" },
        ]);
      } finally {
        await pool.end();
      }
    });
  });

  test("advances seeded identity sequences before runtime inserts", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for migration tests.");
    }

    await withDatabaseTestLock(databaseUrl, async () => {
      await migrate(databaseUrl);

      const pool = createPool(databaseUrl);
      const unique = `${Date.now()}-${Math.random()}`;
      let dealershipId: number | null = null;
      let dealerGroupId: number | null = null;
      let dealershipStoreId: number | null = null;
      try {
        const dealership = await pool.query<{ id: number }>(
          "INSERT INTO dealerships (name) VALUES ($1) RETURNING id",
          [`Sequence test dealership ${unique}`],
        );
        dealershipId = dealership.rows[0]!.id;
        const dealerGroup = await pool.query<{ id: number }>(
          `INSERT INTO dealer_groups (dealership_id, name)
           VALUES ($1, $2)
           RETURNING id`,
          [dealershipId, `Sequence test group ${unique}`],
        );
        dealerGroupId = dealerGroup.rows[0]!.id;
        const dealershipStore = await pool.query<{ id: number }>(
          `INSERT INTO dealership_stores (dealership_id, dealer_group_id, name)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [dealershipId, dealerGroupId, `Sequence test store ${unique}`],
        );
        dealershipStoreId = dealershipStore.rows[0]!.id;

        expect(dealershipId).toBeGreaterThan(1);
        expect(dealerGroupId).toBeGreaterThan(1);
        expect(dealershipStoreId).toBeGreaterThan(2);
      } finally {
        if (dealershipStoreId !== null) {
          await pool.query("DELETE FROM dealership_stores WHERE id = $1", [dealershipStoreId]);
        }
        if (dealerGroupId !== null) {
          await pool.query("DELETE FROM dealer_groups WHERE id = $1", [dealerGroupId]);
        }
        if (dealershipId !== null) {
          await pool.query("DELETE FROM dealerships WHERE id = $1", [dealershipId]);
        }
        await pool.end();
      }
    });
  });

  test("keeps legacy identity nullable and enforces exact accounting month format", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for migration tests.");
    }

    await withDatabaseTestLock(databaseUrl, async () => {
      await migrate(databaseUrl);

      const pool = createPool(databaseUrl);
      const unique = `${Date.now()}-${Math.random()}`;
      try {
        const legacyRow = await pool.query<{
          accounting_month: string | null;
          rooftop_profile_id: string | null;
          rooftop_profile_version: string | null;
          parser_name: string | null;
          parser_version: string | null;
          preprocessor_name: string | null;
          preprocessor_version: string | null;
          preprocessing_metadata: Record<string, unknown> | null;
        }>(
          `INSERT INTO source_files (
             dealership_id,
             dealership_store_id,
             source_type,
             original_filename,
             stored_filename,
             file_hash,
             row_count,
             validation_error_count,
             created_at
           ) VALUES (1, 1, 'boa', 'legacy.csv', NULL, $1, 0, 0, '2026-04-30T23:59:59Z')
           RETURNING
             accounting_month,
             rooftop_profile_id,
             rooftop_profile_version,
             parser_name,
             parser_version,
             preprocessor_name,
             preprocessor_version,
             preprocessing_metadata`,
          [`legacy-identity-${unique}`],
        );
        expect(legacyRow.rows[0]).toEqual({
          accounting_month: null,
          rooftop_profile_id: null,
          rooftop_profile_version: null,
          parser_name: null,
          parser_version: null,
          preprocessor_name: null,
          preprocessor_version: null,
          preprocessing_metadata: null,
        });

        await expect(
          pool.query(
            `UPDATE source_files SET accounting_month = '2026-4' WHERE file_hash = $1`,
            [`legacy-identity-${unique}`],
          ),
        ).rejects.toThrow();
        await expect(
          pool.query(
            `UPDATE source_files SET accounting_month = '2026-13' WHERE file_hash = $1`,
            [`legacy-identity-${unique}`],
          ),
        ).rejects.toThrow();
        await expect(
          pool.query(
            `UPDATE source_files SET accounting_month = '0000-01' WHERE file_hash = $1`,
            [`legacy-identity-${unique}`],
          ),
        ).rejects.toThrow();

        const runSourceFiles = await pool.query<{ id: number }>(
          `INSERT INTO source_files (
             dealership_id,
             dealership_store_id,
             source_type,
             original_filename,
             stored_filename,
             file_hash,
             row_count,
             validation_error_count
           ) VALUES
             (1, 1, 'boa', 'run-boa.csv', NULL, $1, 0, 0),
             (1, 1, 'dealertrack', 'run-dealertrack.csv', NULL, $2, 0, 0)
           RETURNING id`,
          [`run-boa-${unique}`, `run-dealertrack-${unique}`],
        );
        await expect(
          pool.query(
            `INSERT INTO reconciliation_runs (
               dealership_id,
               dealership_store_id,
               boa_source_file_id,
               dealertrack_source_file_id,
               status,
               accounting_month
             ) VALUES (1, 1, $1, $2, 'completed', '2026-00')`,
            [runSourceFiles.rows[0].id, runSourceFiles.rows[1].id],
          ),
        ).rejects.toThrow();
        await expect(
          pool.query(
            `INSERT INTO reconciliation_runs (
               dealership_id,
               dealership_store_id,
               boa_source_file_id,
               dealertrack_source_file_id,
               status,
               accounting_month
             ) VALUES (1, 1, $1, $2, 'completed', '0000-01')`,
            [runSourceFiles.rows[0].id, runSourceFiles.rows[1].id],
          ),
        ).rejects.toThrow();
      } finally {
        await pool.query("DELETE FROM source_files WHERE file_hash LIKE $1", [`%${unique}`]);
        await pool.end();
      }
    });
  });

  test("refuses rollback without losing differentiated reusable source identities", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for migration tests.");
    }

    await withDatabaseTestLock(databaseUrl, async () => {
      await migrate(databaseUrl);

      const pool = createPool(databaseUrl);
      const unique = `${Date.now()}-${Math.random()}`;
      let migrationApplied = true;
      try {
        await pool.query(
          `INSERT INTO source_files (
             dealership_id,
             dealership_store_id,
             source_type,
             original_filename,
             stored_filename,
             file_hash,
             row_count,
             validation_error_count,
             accounting_month,
             rooftop_profile_id,
             rooftop_profile_version,
             parser_name,
             parser_version,
             preprocessor_name,
             preprocessor_version,
             preprocessing_metadata
           ) VALUES
             (1, 1, 'boa', 'april.csv', NULL, $1, 1, 0, '2026-04', 'acura-v1', '1', 'boa-csv', '1', 'boa-floorplan', '1', '{"removed_rows": [{"row": 2}]}'::jsonb),
             (1, 1, 'boa', 'may.csv', NULL, $1, 1, 0, '2026-05', 'acura-v1', '1', 'boa-csv', '2', 'boa-floorplan', '2', '{"removed_rows": [{"row": 3}]}'::jsonb)`,
          [`rollback-collision-${unique}`],
        );

        // Remove the later sequence-synchronization migration so this test
        // exercises the guarded identity migration it owns.
        await runMigrationDownCapturingOutput(databaseUrl);
        await expect(runMigrationDownCapturingOutput(databaseUrl)).rejects.toMatchObject({
          stderr: expect.stringContaining(ROLLBACK_COLLISION_ERROR),
        });

        const preservedRows = await pool.query<{
          accounting_month: string;
          parser_version: string;
          preprocessor_version: string;
          preprocessing_metadata: { removed_rows: Array<{ row: number }> };
        }>(
          `SELECT
             accounting_month,
             parser_version,
             preprocessor_version,
             preprocessing_metadata
           FROM source_files
           WHERE file_hash = $1
           ORDER BY accounting_month`,
          [`rollback-collision-${unique}`],
        );
        expect(preservedRows.rows).toEqual([
          {
            accounting_month: "2026-04",
            parser_version: "1",
            preprocessor_version: "1",
            preprocessing_metadata: { removed_rows: [{ row: 2 }] },
          },
          {
            accounting_month: "2026-05",
            parser_version: "2",
            preprocessor_version: "2",
            preprocessing_metadata: { removed_rows: [{ row: 3 }] },
          },
        ]);

        const appliedState = await pool.query<{
          reusable_index: string;
          legacy_index: string;
          accounting_month_column_count: string;
          migration_count: string;
        }>(
          `SELECT
             to_regclass('public.ux_source_files_reusable_identity')::text AS reusable_index,
             to_regclass('public.ux_source_files_legacy_identity')::text AS legacy_index,
             (
               SELECT COUNT(*)::text
               FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name IN ('source_files', 'reconciliation_runs')
                 AND column_name = 'accounting_month'
             ) AS accounting_month_column_count,
             (
               SELECT COUNT(*)::text
               FROM pgmigrations
               WHERE name = '1789344000000_add_rooftop_run_identity'
             ) AS migration_count`,
        );
        expect(appliedState.rows[0]).toEqual({
          reusable_index: "ux_source_files_reusable_identity",
          legacy_index: "ux_source_files_legacy_identity",
          accounting_month_column_count: "2",
          migration_count: "1",
        });
      } finally {
        const state = await pool.query<{ migration_count: string }>(
          `SELECT COUNT(*)::text AS migration_count
           FROM pgmigrations
           WHERE name = '1789344000000_add_rooftop_run_identity'`,
        );
        migrationApplied = state.rows[0].migration_count === "1";
        await pool.query("DELETE FROM source_files WHERE file_hash = $1", [
          `rollback-collision-${unique}`,
        ]);
        await pool.end();

        if (migrationApplied) {
          await runMigrationDownCapturingOutput(databaseUrl);
        }
        await migrate(databaseUrl);
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
            dealership_store_id,
            source_type,
            original_filename,
            stored_filename,
            file_hash,
            row_count,
            validation_error_count
          ) VALUES (1, 1, 'boa', 'constraint-test.csv', NULL, $1, 1, 0)
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

async function countDemoUsersIfSchemaExists(databaseUrl: string): Promise<number | null> {
  const pool = createPool(databaseUrl);
  try {
    const schemaResult = await pool.query<{ users_table: string | null }>(
      "SELECT to_regclass('public.users')::text AS users_table",
    );
    if (schemaResult.rows[0].users_table === null) {
      return null;
    }
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM users
       WHERE lower(email) = lower($1)`,
      [DEMO_EMAIL],
    );
    return Number(result.rows[0].count);
  } finally {
    await pool.end();
  }
}

function runMigrationDownCapturingOutput(databaseUrl: string): Promise<void> {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolve, reject) => {
    execFile(
      command,
      ["run", "migrate:down"],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        reject(new MigrationCommandError(error.message, stderr));
      },
    );
  });
}
