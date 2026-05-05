import { loadConfig } from "../config.js";
import { createPool } from "../repositories/postgresTransactionRepository.js";

export async function migrate(databaseUrl = loadConfig().databaseUrl): Promise<void> {
  const pool = createPool(databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(762733001)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS source_files (
        id SERIAL PRIMARY KEY,
        source_type VARCHAR(20) NOT NULL,
        original_filename TEXT NOT NULL,
        stored_filename TEXT NULL,
        file_hash TEXT NULL,
        row_count INTEGER NOT NULL DEFAULT 0,
        validation_error_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        source_file_id INTEGER NULL REFERENCES source_files(id) ON DELETE CASCADE,
        source_type VARCHAR(20) NOT NULL,
        transaction_date DATE NULL,
        post_date DATE NULL,
        amount_cents BIGINT NULL,
        reference_number VARCHAR(100) NULL,
        description TEXT NULL,
        account VARCHAR(100) NULL,
        stock_number VARCHAR(100) NULL,
        vin VARCHAR(32) NULL,
        raw_data JSONB NOT NULL
      )
    `);
    await client.query("ALTER TABLE source_files ADD COLUMN IF NOT EXISTS file_hash TEXT NULL");
    await client.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_runs (
        id SERIAL PRIMARY KEY,
        boa_source_file_id INTEGER NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
        dealertrack_source_file_id INTEGER NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
        matched_count INTEGER NOT NULL DEFAULT 0,
        exception_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(30) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_match_groups (
        id SERIAL PRIMARY KEY,
        reconciliation_run_id INTEGER NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
        match_type VARCHAR(100) NOT NULL,
        confidence NUMERIC(5, 2) NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_match_group_transactions (
        match_group_id INTEGER NOT NULL
          REFERENCES reconciliation_match_groups(id)
          ON DELETE CASCADE,
        transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        side VARCHAR(20) NOT NULL,
        source_type VARCHAR(20) NOT NULL,
        PRIMARY KEY (match_group_id, transaction_id, side)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
        id SERIAL PRIMARY KEY,
        reconciliation_run_id INTEGER NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
        transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        source_type VARCHAR(20) NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_file_id INTEGER NULL");
    await client.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount_cents BIGINT NULL");
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'transactions'
            AND column_name = 'amount'
        ) THEN
          UPDATE transactions
          SET amount_cents = (amount * 100)::BIGINT
          WHERE amount_cents IS NULL;
        END IF;
      END
      $$;
    `);
    await client.query(`
      UPDATE source_files
      SET file_hash = 'legacy-source-file-' || id::text
      WHERE file_hash IS NULL OR file_hash = ''
    `);
    await client.query(`
      INSERT INTO source_files (
        source_type,
        original_filename,
        stored_filename,
        file_hash,
        row_count,
        validation_error_count
      )
      SELECT
        transactions.source_type,
        'legacy-' || transactions.source_type || '-transactions.csv',
        NULL,
        'legacy-' || transactions.source_type || '-unscoped-transactions',
        COUNT(*),
        0
      FROM transactions
      WHERE source_file_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM source_files
          WHERE source_files.source_type = transactions.source_type
            AND source_files.file_hash = 'legacy-' || transactions.source_type || '-unscoped-transactions'
        )
      GROUP BY transactions.source_type
    `);
    await client.query(`
      UPDATE transactions
      SET source_file_id = source_files.id
      FROM source_files
      WHERE transactions.source_file_id IS NULL
        AND source_files.source_type = transactions.source_type
        AND source_files.file_hash = 'legacy-' || transactions.source_type || '-unscoped-transactions'
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'transactions_source_file_id_fkey'
        ) THEN
          ALTER TABLE transactions
            ADD CONSTRAINT transactions_source_file_id_fkey
            FOREIGN KEY (source_file_id)
            REFERENCES source_files(id)
            ON DELETE CASCADE;
        END IF;
      END
      $$;
    `);
    await client.query("ALTER TABLE transactions ALTER COLUMN transaction_date DROP NOT NULL");
    await client.query("ALTER TABLE source_files ALTER COLUMN file_hash SET NOT NULL");
    await client.query("ALTER TABLE transactions ALTER COLUMN source_file_id SET NOT NULL");
    await client.query("ALTER TABLE transactions ALTER COLUMN source_type SET NOT NULL");
    await client.query("ALTER TABLE transactions ALTER COLUMN amount_cents SET NOT NULL");
    await addConstraint(
      client,
      "source_files_file_hash_not_empty",
      "ALTER TABLE source_files ADD CONSTRAINT source_files_file_hash_not_empty CHECK (length(file_hash) > 0)",
    );
    await addConstraint(
      client,
      "source_files_source_type_check",
      "ALTER TABLE source_files ADD CONSTRAINT source_files_source_type_check CHECK (source_type IN ('bank', 'boa', 'dealertrack', 'dms', 'gl', 'oem'))",
    );
    await addConstraint(
      client,
      "source_files_row_count_check",
      "ALTER TABLE source_files ADD CONSTRAINT source_files_row_count_check CHECK (row_count >= 0)",
    );
    await addConstraint(
      client,
      "source_files_validation_error_count_check",
      "ALTER TABLE source_files ADD CONSTRAINT source_files_validation_error_count_check CHECK (validation_error_count >= 0)",
    );
    await addConstraint(
      client,
      "transactions_source_type_check",
      "ALTER TABLE transactions ADD CONSTRAINT transactions_source_type_check CHECK (source_type IN ('bank', 'boa', 'dealertrack', 'dms', 'gl', 'oem'))",
    );
    await addConstraint(
      client,
      "transactions_amount_cents_nonzero",
      "ALTER TABLE transactions ADD CONSTRAINT transactions_amount_cents_nonzero CHECK (amount_cents <> 0)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_source_files_source_type ON source_files (source_type)",
    );
    await client.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS ux_source_files_source_type_file_hash ON source_files (source_type, file_hash)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_source_files_created_at ON source_files (created_at)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_transactions_source_file_id ON transactions (source_file_id)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_reconciliation_runs_boa_source_file_id ON reconciliation_runs (boa_source_file_id)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_reconciliation_runs_dealertrack_source_file_id ON reconciliation_runs (dealertrack_source_file_id)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_reconciliation_runs_created_at ON reconciliation_runs (created_at)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_reconciliation_match_groups_run_id ON reconciliation_match_groups (reconciliation_run_id)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_reconciliation_match_group_transactions_transaction_id ON reconciliation_match_group_transactions (transaction_id)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_reconciliation_exceptions_run_id ON reconciliation_exceptions (reconciliation_run_id)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_reconciliation_exceptions_transaction_id ON reconciliation_exceptions (transaction_id)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_transactions_source_type ON transactions (source_type)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_transactions_transaction_date ON transactions (transaction_date)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_transactions_amount_cents ON transactions (amount_cents)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_transactions_reference_number ON transactions (reference_number)",
    );
    await client.query("CREATE INDEX IF NOT EXISTS ix_transactions_account ON transactions (account)");
    await client.query(
      "CREATE INDEX IF NOT EXISTS ix_transactions_stock_number ON transactions (stock_number)",
    );
    await client.query("CREATE INDEX IF NOT EXISTS ix_transactions_vin ON transactions (vin)");
    await client.query("DROP INDEX IF EXISTS ix_transactions_amount");
    await client.query("ALTER TABLE transactions DROP COLUMN IF EXISTS amount");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function addConstraint(client: { query: (sql: string) => Promise<unknown> }, name: string, sql: string) {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = '${name}'
      ) THEN
        ${sql};
      END IF;
    END
    $$;
  `);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
