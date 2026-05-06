exports.shorthands = undefined;

exports.up = (pgm) => {
  const defaultDealershipId = Number(process.env.DEFAULT_DEALERSHIP_ID ?? 1);
  if (!Number.isInteger(defaultDealershipId) || defaultDealershipId <= 0) {
    throw new Error("DEFAULT_DEALERSHIP_ID must be a positive integer.");
  }

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS dealerships (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO dealerships (id, name)
    VALUES (1, 'Default Dealership')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO dealerships (id, name)
    VALUES (${defaultDealershipId}, 'Configured Dealership')
    ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      dealership_id INTEGER NOT NULL REFERENCES dealerships(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS source_files (
      id SERIAL PRIMARY KEY,
      source_type VARCHAR(20) NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NULL,
      file_hash TEXT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      validation_error_count INTEGER NOT NULL DEFAULT 0,
      dealership_id INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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
      account_type VARCHAR(100) NULL,
      account_identifier VARCHAR(100) NULL,
      stock_number VARCHAR(100) NULL,
      vin VARCHAR(32) NULL,
      dealership_id INTEGER NULL,
      raw_data JSONB NOT NULL
    );

    ALTER TABLE source_files ADD COLUMN IF NOT EXISTS file_hash TEXT NULL;
    ALTER TABLE source_files ADD COLUMN IF NOT EXISTS dealership_id INTEGER NULL;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_file_id INTEGER NULL;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount_cents BIGINT NULL;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS dealership_id INTEGER NULL;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_type VARCHAR(100) NULL;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_identifier VARCHAR(100) NULL;

    CREATE TABLE IF NOT EXISTS reconciliation_runs (
      id SERIAL PRIMARY KEY,
      boa_source_file_id INTEGER NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
      dealertrack_source_file_id INTEGER NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
      matched_count INTEGER NOT NULL DEFAULT 0,
      exception_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL,
      dealership_id INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reconciliation_match_groups (
      id SERIAL PRIMARY KEY,
      reconciliation_run_id INTEGER NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
      match_type VARCHAR(100) NOT NULL,
      confidence NUMERIC(5, 2) NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reconciliation_match_group_transactions (
      match_group_id INTEGER NOT NULL
        REFERENCES reconciliation_match_groups(id)
        ON DELETE CASCADE,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      side VARCHAR(20) NOT NULL,
      source_type VARCHAR(20) NOT NULL,
      PRIMARY KEY (match_group_id, transaction_id, side)
    );

    CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
      id SERIAL PRIMARY KEY,
      reconciliation_run_id INTEGER NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      source_type VARCHAR(20) NOT NULL,
      reason TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'unresolved',
      note TEXT NOT NULL DEFAULT '',
      dealership_id INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE reconciliation_exceptions
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'unresolved';
    ALTER TABLE reconciliation_exceptions
      ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
    ALTER TABLE reconciliation_runs ADD COLUMN IF NOT EXISTS dealership_id INTEGER NULL;
    ALTER TABLE reconciliation_exceptions ADD COLUMN IF NOT EXISTS dealership_id INTEGER NULL;

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

    UPDATE source_files
    SET file_hash = 'legacy-source-file-' || id::text
    WHERE file_hash IS NULL OR file_hash = '';

    UPDATE source_files
    SET dealership_id = 1
    WHERE dealership_id IS NULL;

    INSERT INTO source_files (
      source_type,
      original_filename,
      stored_filename,
      file_hash,
      row_count,
      validation_error_count,
      dealership_id
    )
    SELECT
      transactions.source_type,
      'legacy-' || transactions.source_type || '-transactions.csv',
      NULL,
      'legacy-' || transactions.source_type || '-unscoped-transactions',
      COUNT(*),
      0,
      1
    FROM transactions
    WHERE source_file_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM source_files
        WHERE source_files.source_type = transactions.source_type
          AND source_files.file_hash = 'legacy-' || transactions.source_type || '-unscoped-transactions'
      )
    GROUP BY transactions.source_type;

    UPDATE transactions
    SET source_file_id = source_files.id
    FROM source_files
    WHERE transactions.source_file_id IS NULL
      AND source_files.source_type = transactions.source_type
      AND source_files.file_hash = 'legacy-' || transactions.source_type || '-unscoped-transactions';

    UPDATE transactions
    SET dealership_id = source_files.dealership_id
    FROM source_files
    WHERE transactions.source_file_id = source_files.id
      AND transactions.dealership_id IS NULL;

    UPDATE transactions
    SET dealership_id = 1
    WHERE dealership_id IS NULL;

    UPDATE transactions
    SET account_type = CASE
      WHEN source_type IN ('boa', 'dealertrack') THEN 'floorplan'
      ELSE source_type
    END
    WHERE account_type IS NULL OR account_type = '';

    UPDATE transactions
    SET account_identifier = COALESCE(
      NULLIF(account, ''),
      CASE WHEN source_type IN ('boa', 'dealertrack') THEN 'floorplan' ELSE 'unassigned' END
    )
    WHERE account_identifier IS NULL OR account_identifier = '';

    UPDATE reconciliation_runs
    SET dealership_id = source_files.dealership_id
    FROM source_files
    WHERE reconciliation_runs.boa_source_file_id = source_files.id
      AND reconciliation_runs.dealership_id IS NULL;

    UPDATE reconciliation_runs
    SET dealership_id = 1
    WHERE dealership_id IS NULL;

    UPDATE reconciliation_exceptions
    SET dealership_id = reconciliation_runs.dealership_id
    FROM reconciliation_runs
    WHERE reconciliation_exceptions.reconciliation_run_id = reconciliation_runs.id
      AND reconciliation_exceptions.dealership_id IS NULL;

    UPDATE reconciliation_exceptions
    SET dealership_id = 1
    WHERE dealership_id IS NULL;
  `);

  addConstraint(
    pgm,
    "transactions_source_file_id_fkey",
    "ALTER TABLE transactions ADD CONSTRAINT transactions_source_file_id_fkey FOREIGN KEY (source_file_id) REFERENCES source_files(id) ON DELETE CASCADE",
  );

  pgm.sql(`
    ALTER TABLE transactions ALTER COLUMN transaction_date DROP NOT NULL;
    ALTER TABLE source_files ALTER COLUMN file_hash SET NOT NULL;
    ALTER TABLE source_files ALTER COLUMN dealership_id SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN source_file_id SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN dealership_id SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN source_type SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN amount_cents SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN account_type SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN account_identifier SET NOT NULL;
    ALTER TABLE reconciliation_runs ALTER COLUMN dealership_id SET NOT NULL;
    ALTER TABLE reconciliation_exceptions ALTER COLUMN dealership_id SET NOT NULL;
  `);

  addConstraint(
    pgm,
    "source_files_dealership_id_fkey",
    "ALTER TABLE source_files ADD CONSTRAINT source_files_dealership_id_fkey FOREIGN KEY (dealership_id) REFERENCES dealerships(id) ON DELETE RESTRICT",
  );
  addConstraint(
    pgm,
    "transactions_dealership_id_fkey",
    "ALTER TABLE transactions ADD CONSTRAINT transactions_dealership_id_fkey FOREIGN KEY (dealership_id) REFERENCES dealerships(id) ON DELETE RESTRICT",
  );
  addConstraint(
    pgm,
    "reconciliation_runs_dealership_id_fkey",
    "ALTER TABLE reconciliation_runs ADD CONSTRAINT reconciliation_runs_dealership_id_fkey FOREIGN KEY (dealership_id) REFERENCES dealerships(id) ON DELETE RESTRICT",
  );
  addConstraint(
    pgm,
    "reconciliation_exceptions_dealership_id_fkey",
    "ALTER TABLE reconciliation_exceptions ADD CONSTRAINT reconciliation_exceptions_dealership_id_fkey FOREIGN KEY (dealership_id) REFERENCES dealerships(id) ON DELETE RESTRICT",
  );
  addConstraint(
    pgm,
    "source_files_file_hash_not_empty",
    "ALTER TABLE source_files ADD CONSTRAINT source_files_file_hash_not_empty CHECK (length(file_hash) > 0)",
  );
  addConstraint(
    pgm,
    "source_files_source_type_check",
    "ALTER TABLE source_files ADD CONSTRAINT source_files_source_type_check CHECK (source_type IN ('bank', 'boa', 'dealertrack', 'dms', 'gl', 'oem'))",
  );
  addConstraint(
    pgm,
    "source_files_row_count_check",
    "ALTER TABLE source_files ADD CONSTRAINT source_files_row_count_check CHECK (row_count >= 0)",
  );
  addConstraint(
    pgm,
    "source_files_validation_error_count_check",
    "ALTER TABLE source_files ADD CONSTRAINT source_files_validation_error_count_check CHECK (validation_error_count >= 0)",
  );
  addConstraint(
    pgm,
    "transactions_source_type_check",
    "ALTER TABLE transactions ADD CONSTRAINT transactions_source_type_check CHECK (source_type IN ('bank', 'boa', 'dealertrack', 'dms', 'gl', 'oem'))",
  );
  addConstraint(
    pgm,
    "transactions_amount_cents_nonzero",
    "ALTER TABLE transactions ADD CONSTRAINT transactions_amount_cents_nonzero CHECK (amount_cents <> 0)",
  );
  addConstraint(
    pgm,
    "reconciliation_exceptions_status_check",
    "ALTER TABLE reconciliation_exceptions ADD CONSTRAINT reconciliation_exceptions_status_check CHECK (status IN ('unresolved', 'ignored', 'resolved'))",
  );

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS ix_source_files_source_type ON source_files (source_type);
    CREATE INDEX IF NOT EXISTS ix_source_files_dealership_id ON source_files (dealership_id);
    DROP INDEX IF EXISTS ux_source_files_source_type_file_hash;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_source_files_dealership_source_type_file_hash
      ON source_files (dealership_id, source_type, file_hash);
    CREATE INDEX IF NOT EXISTS ix_source_files_created_at ON source_files (created_at);
    CREATE INDEX IF NOT EXISTS ix_transactions_source_file_id ON transactions (source_file_id);
    CREATE INDEX IF NOT EXISTS ix_transactions_dealership_id ON transactions (dealership_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_runs_dealership_id ON reconciliation_runs (dealership_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_runs_boa_source_file_id ON reconciliation_runs (boa_source_file_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_runs_dealertrack_source_file_id ON reconciliation_runs (dealertrack_source_file_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_runs_created_at ON reconciliation_runs (created_at);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_match_groups_run_id
      ON reconciliation_match_groups (reconciliation_run_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_match_group_transactions_transaction_id
      ON reconciliation_match_group_transactions (transaction_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_exceptions_run_id
      ON reconciliation_exceptions (reconciliation_run_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_exceptions_dealership_id
      ON reconciliation_exceptions (dealership_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_exceptions_transaction_id
      ON reconciliation_exceptions (transaction_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_exceptions_status
      ON reconciliation_exceptions (status);
    CREATE INDEX IF NOT EXISTS ix_transactions_source_type ON transactions (source_type);
    CREATE INDEX IF NOT EXISTS ix_transactions_transaction_date ON transactions (transaction_date);
    CREATE INDEX IF NOT EXISTS ix_transactions_amount_cents ON transactions (amount_cents);
    CREATE INDEX IF NOT EXISTS ix_transactions_reference_number ON transactions (reference_number);
    CREATE INDEX IF NOT EXISTS ix_transactions_account ON transactions (account);
    CREATE INDEX IF NOT EXISTS ix_transactions_account_identifier ON transactions (account_identifier);
    CREATE INDEX IF NOT EXISTS ix_transactions_account_type ON transactions (account_type);
    CREATE INDEX IF NOT EXISTS ix_transactions_stock_number ON transactions (stock_number);
    CREATE INDEX IF NOT EXISTS ix_transactions_vin ON transactions (vin);
    DROP INDEX IF EXISTS ix_transactions_amount;
    ALTER TABLE transactions DROP COLUMN IF EXISTS amount;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS reconciliation_match_group_transactions;
    DROP TABLE IF EXISTS reconciliation_match_groups;
    DROP TABLE IF EXISTS reconciliation_exceptions;
    DROP TABLE IF EXISTS reconciliation_runs;
    DROP TABLE IF EXISTS transactions;
    DROP TABLE IF EXISTS source_files;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS dealerships;
  `);
};

function addConstraint(pgm, name, sql) {
  pgm.sql(`
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
