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

    CREATE TABLE IF NOT EXISTS dealer_groups (
      id SERIAL PRIMARY KEY,
      dealership_id INTEGER NOT NULL REFERENCES dealerships(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS dealership_stores (
      id SERIAL PRIMARY KEY,
      dealership_id INTEGER NOT NULL REFERENCES dealerships(id) ON DELETE RESTRICT,
      dealer_group_id INTEGER NULL REFERENCES dealer_groups(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO dealer_groups (id, dealership_id, name)
    VALUES (1, 1, 'Hiley Mazda Group')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO dealership_stores (id, dealership_id, dealer_group_id, name)
    VALUES
      (1, 1, 1, 'Hiley Mazda of Hurst'),
      (2, 1, 1, 'Hiley Mazda of Arlington')
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
      dealership_store_id INTEGER NULL,
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
    ALTER TABLE source_files ADD COLUMN IF NOT EXISTS dealership_store_id INTEGER NULL;
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
      dealership_store_id INTEGER NULL,
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
      review_status VARCHAR(30) NOT NULL DEFAULT 'unreviewed',
      assigned_to TEXT NULL,
      review_notes TEXT NOT NULL DEFAULT '',
      reviewed_at TIMESTAMPTZ NULL,
      reviewed_by TEXT NULL,
      dealership_id INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reconciliation_run_inputs (
      id SERIAL PRIMARY KEY,
      reconciliation_run_id INTEGER NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
      side VARCHAR(20) NOT NULL,
      source_type VARCHAR(20) NOT NULL,
      source_file_id INTEGER NOT NULL REFERENCES source_files(id) ON DELETE RESTRICT,
      parser_version TEXT NOT NULL,
      parser_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      engine_version TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (reconciliation_run_id, side)
    );

    CREATE TABLE IF NOT EXISTS reconciliation_run_input_transactions (
      id SERIAL PRIMARY KEY,
      reconciliation_run_input_id INTEGER NOT NULL REFERENCES reconciliation_run_inputs(id) ON DELETE CASCADE,
      original_transaction_id INTEGER NOT NULL,
      transaction_order INTEGER NOT NULL,
      transaction_data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (reconciliation_run_input_id, original_transaction_id)
    );

    CREATE OR REPLACE FUNCTION next_run_at_for_cadence(cadence_value text)
    RETURNS timestamptz AS $$
    BEGIN
      IF cadence_value = 'daily' THEN
        RETURN NOW() + INTERVAL '1 day';
      ELSIF cadence_value = 'weekly' THEN
        RETURN NOW() + INTERVAL '7 days';
      ELSE
        RETURN NOW() + INTERVAL '1 month';
      END IF;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TABLE IF NOT EXISTS scheduled_reconciliation_jobs (
      id SERIAL PRIMARY KEY,
      dealership_id INTEGER NOT NULL REFERENCES dealerships(id) ON DELETE RESTRICT,
      dealership_store_id INTEGER NULL REFERENCES dealership_stores(id) ON DELETE RESTRICT,
      cadence VARCHAR(20) NOT NULL,
      expected_source_types TEXT[] NOT NULL DEFAULT ARRAY['boa','dealertrack'],
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      auto_run_on_pair BOOLEAN NOT NULL DEFAULT FALSE,
      last_run_at TIMESTAMPTZ NULL,
      next_run_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ingestion_events (
      id SERIAL PRIMARY KEY,
      dealership_id INTEGER NOT NULL REFERENCES dealerships(id) ON DELETE RESTRICT,
      dealership_store_id INTEGER NULL REFERENCES dealership_stores(id) ON DELETE SET NULL,
      source_file_id INTEGER NULL REFERENCES source_files(id) ON DELETE SET NULL,
      reconciliation_run_id INTEGER NULL REFERENCES reconciliation_runs(id) ON DELETE SET NULL,
      source_type VARCHAR(20) NULL,
      state VARCHAR(30) NOT NULL,
      message TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS operational_events (
      id SERIAL PRIMARY KEY,
      dealership_id INTEGER NOT NULL REFERENCES dealerships(id) ON DELETE RESTRICT,
      dealership_store_id INTEGER NULL REFERENCES dealership_stores(id) ON DELETE SET NULL,
      reconciliation_run_id INTEGER NULL REFERENCES reconciliation_runs(id) ON DELETE SET NULL,
      event_type VARCHAR(80) NOT NULL,
      severity VARCHAR(20) NOT NULL,
      message TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE reconciliation_exceptions
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'unresolved';
    ALTER TABLE reconciliation_exceptions
      ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
    ALTER TABLE reconciliation_exceptions
      ADD COLUMN IF NOT EXISTS review_status VARCHAR(30) NOT NULL DEFAULT 'unreviewed';
    ALTER TABLE reconciliation_exceptions
      ADD COLUMN IF NOT EXISTS assigned_to TEXT NULL;
    ALTER TABLE reconciliation_exceptions
      ADD COLUMN IF NOT EXISTS review_notes TEXT NOT NULL DEFAULT '';
    ALTER TABLE reconciliation_exceptions
      ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ NULL;
    ALTER TABLE reconciliation_exceptions
      ADD COLUMN IF NOT EXISTS reviewed_by TEXT NULL;
    ALTER TABLE reconciliation_runs ADD COLUMN IF NOT EXISTS dealership_id INTEGER NULL;
    ALTER TABLE reconciliation_runs ADD COLUMN IF NOT EXISTS dealership_store_id INTEGER NULL;
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

    UPDATE source_files
    SET dealership_store_id = 1
    WHERE dealership_store_id IS NULL;

    UPDATE reconciliation_runs
    SET dealership_store_id = source_files.dealership_store_id
    FROM source_files
    WHERE reconciliation_runs.boa_source_file_id = source_files.id
      AND reconciliation_runs.dealership_store_id IS NULL;

    UPDATE reconciliation_runs
    SET dealership_store_id = 1
    WHERE dealership_store_id IS NULL;

    UPDATE reconciliation_exceptions
    SET dealership_id = reconciliation_runs.dealership_id
    FROM reconciliation_runs
    WHERE reconciliation_exceptions.reconciliation_run_id = reconciliation_runs.id
      AND reconciliation_exceptions.dealership_id IS NULL;

    UPDATE reconciliation_exceptions
    SET dealership_id = 1
    WHERE dealership_id IS NULL;

    UPDATE reconciliation_exceptions
    SET review_status = CASE
      WHEN status = 'resolved' THEN 'resolved'
      WHEN status = 'ignored' THEN 'ignored'
      ELSE review_status
    END;

    UPDATE reconciliation_exceptions
    SET review_notes = note
    WHERE review_notes = '' AND note <> '';
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
    ALTER TABLE source_files ALTER COLUMN dealership_store_id SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN source_file_id SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN dealership_id SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN source_type SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN amount_cents SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN account_type SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN account_identifier SET NOT NULL;
    ALTER TABLE reconciliation_runs ALTER COLUMN dealership_id SET NOT NULL;
    ALTER TABLE reconciliation_runs ALTER COLUMN dealership_store_id SET NOT NULL;
    ALTER TABLE reconciliation_exceptions ALTER COLUMN dealership_id SET NOT NULL;
  `);

  addConstraint(
    pgm,
    "source_files_dealership_id_fkey",
    "ALTER TABLE source_files ADD CONSTRAINT source_files_dealership_id_fkey FOREIGN KEY (dealership_id) REFERENCES dealerships(id) ON DELETE RESTRICT",
  );
  addConstraint(
    pgm,
    "source_files_dealership_store_id_fkey",
    "ALTER TABLE source_files ADD CONSTRAINT source_files_dealership_store_id_fkey FOREIGN KEY (dealership_store_id) REFERENCES dealership_stores(id) ON DELETE RESTRICT",
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
    "reconciliation_runs_dealership_store_id_fkey",
    "ALTER TABLE reconciliation_runs ADD CONSTRAINT reconciliation_runs_dealership_store_id_fkey FOREIGN KEY (dealership_store_id) REFERENCES dealership_stores(id) ON DELETE RESTRICT",
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
  addConstraint(
    pgm,
    "reconciliation_exceptions_review_status_check",
    "ALTER TABLE reconciliation_exceptions ADD CONSTRAINT reconciliation_exceptions_review_status_check CHECK (review_status IN ('unreviewed', 'investigating', 'resolved', 'ignored'))",
  );

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS ix_source_files_source_type ON source_files (source_type);
    CREATE INDEX IF NOT EXISTS ix_source_files_dealership_id ON source_files (dealership_id);
    CREATE INDEX IF NOT EXISTS ix_source_files_dealership_store_id ON source_files (dealership_store_id);
    DROP INDEX IF EXISTS ux_source_files_source_type_file_hash;
    DROP INDEX IF EXISTS ux_source_files_dealership_source_type_file_hash;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_source_files_dealership_source_type_file_hash
      ON source_files (dealership_id, dealership_store_id, source_type, file_hash);
    CREATE INDEX IF NOT EXISTS ix_source_files_created_at ON source_files (created_at);
    CREATE INDEX IF NOT EXISTS ix_transactions_source_file_id ON transactions (source_file_id);
    CREATE INDEX IF NOT EXISTS ix_transactions_dealership_id ON transactions (dealership_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_runs_dealership_id ON reconciliation_runs (dealership_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_runs_dealership_store_id ON reconciliation_runs (dealership_store_id);
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
    CREATE INDEX IF NOT EXISTS ix_reconciliation_exceptions_review_status
      ON reconciliation_exceptions (review_status);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_exceptions_assigned_to
      ON reconciliation_exceptions (assigned_to);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_run_inputs_run_id
      ON reconciliation_run_inputs (reconciliation_run_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_run_input_transactions_input_id
      ON reconciliation_run_input_transactions (reconciliation_run_input_id);
    CREATE INDEX IF NOT EXISTS ix_scheduled_reconciliation_jobs_dealership_id
      ON scheduled_reconciliation_jobs (dealership_id);
    CREATE INDEX IF NOT EXISTS ix_scheduled_reconciliation_jobs_store_id
      ON scheduled_reconciliation_jobs (dealership_store_id);
    CREATE INDEX IF NOT EXISTS ix_scheduled_reconciliation_jobs_next_run_at
      ON scheduled_reconciliation_jobs (next_run_at);
    CREATE INDEX IF NOT EXISTS ix_ingestion_events_dealership_id
      ON ingestion_events (dealership_id);
    CREATE INDEX IF NOT EXISTS ix_ingestion_events_store_id
      ON ingestion_events (dealership_store_id);
    CREATE INDEX IF NOT EXISTS ix_ingestion_events_created_at
      ON ingestion_events (created_at);
    CREATE INDEX IF NOT EXISTS ix_operational_events_dealership_id
      ON operational_events (dealership_id);
    CREATE INDEX IF NOT EXISTS ix_operational_events_store_id
      ON operational_events (dealership_store_id);
    CREATE INDEX IF NOT EXISTS ix_operational_events_created_at
      ON operational_events (created_at);
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

  pgm.sql(`
    CREATE OR REPLACE FUNCTION prevent_reconciliation_snapshot_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'reconciliation input snapshots are immutable';
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS reconciliation_run_inputs_immutable ON reconciliation_run_inputs;
    CREATE TRIGGER reconciliation_run_inputs_immutable
      BEFORE UPDATE OR DELETE ON reconciliation_run_inputs
      FOR EACH ROW EXECUTE FUNCTION prevent_reconciliation_snapshot_mutation();

    DROP TRIGGER IF EXISTS reconciliation_run_input_transactions_immutable ON reconciliation_run_input_transactions;
    CREATE TRIGGER reconciliation_run_input_transactions_immutable
      BEFORE UPDATE OR DELETE ON reconciliation_run_input_transactions
      FOR EACH ROW EXECUTE FUNCTION prevent_reconciliation_snapshot_mutation();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS reconciliation_match_group_transactions;
    DROP TABLE IF EXISTS reconciliation_match_groups;
    DROP TABLE IF EXISTS reconciliation_exceptions;
    DROP TABLE IF EXISTS reconciliation_run_input_transactions;
    DROP TABLE IF EXISTS reconciliation_run_inputs;
    DROP TABLE IF EXISTS operational_events;
    DROP TABLE IF EXISTS ingestion_events;
    DROP TABLE IF EXISTS scheduled_reconciliation_jobs;
    DROP TABLE IF EXISTS reconciliation_runs;
    DROP TABLE IF EXISTS transactions;
    DROP TABLE IF EXISTS source_files;
    DROP TABLE IF EXISTS dealership_stores;
    DROP TABLE IF EXISTS dealer_groups;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS dealerships;
    DROP FUNCTION IF EXISTS prevent_reconciliation_snapshot_mutation();
    DROP FUNCTION IF EXISTS next_run_at_for_cadence(text);
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
