exports.shorthands = undefined;

const artifactTypeCheck = `
  artifact_type IN (
    'RAW_BOA',
    'RAW_DEALERTRACK',
    'CLEANED_BOA',
    'CLEANED_DEALERTRACK',
    'MERGED_FLOORPLAN',
    'FP_REC'
  )
`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS source_file_upload_contents (
      source_file_id INTEGER PRIMARY KEY REFERENCES source_files(id) ON DELETE CASCADE,
      dealership_id INTEGER NOT NULL REFERENCES dealerships(id) ON DELETE RESTRICT,
      dealership_store_id INTEGER NULL REFERENCES dealership_stores(id) ON DELETE RESTRICT,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      file_size_bytes BIGINT NOT NULL,
      content BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reconciliation_artifacts (
      id SERIAL PRIMARY KEY,
      reconciliation_run_id INTEGER NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
      dealership_id INTEGER NOT NULL REFERENCES dealerships(id) ON DELETE RESTRICT,
      dealership_store_id INTEGER NULL REFERENCES dealership_stores(id) ON DELETE RESTRICT,
      accounting_month TEXT NOT NULL,
      uploaded_by_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      artifact_type VARCHAR(40) NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      file_size_bytes BIGINT NOT NULL,
      content BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (reconciliation_run_id, artifact_type)
    );

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'source_file_upload_contents_file_size_check'
      ) THEN
        ALTER TABLE source_file_upload_contents
          ADD CONSTRAINT source_file_upload_contents_file_size_check
          CHECK (file_size_bytes >= 0);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'reconciliation_artifacts_type_check'
      ) THEN
        ALTER TABLE reconciliation_artifacts
          ADD CONSTRAINT reconciliation_artifacts_type_check
          CHECK (${artifactTypeCheck});
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'reconciliation_artifacts_file_size_check'
      ) THEN
        ALTER TABLE reconciliation_artifacts
          ADD CONSTRAINT reconciliation_artifacts_file_size_check
          CHECK (file_size_bytes >= 0);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'reconciliation_artifacts_accounting_month_check'
      ) THEN
        ALTER TABLE reconciliation_artifacts
          ADD CONSTRAINT reconciliation_artifacts_accounting_month_check
          CHECK (accounting_month ~ '^[0-9]{4}-[0-9]{2}$');
      END IF;
    END
    $$;

    CREATE INDEX IF NOT EXISTS ix_source_file_upload_contents_dealership_id
      ON source_file_upload_contents (dealership_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_artifacts_run_id
      ON reconciliation_artifacts (reconciliation_run_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_artifacts_dealership_id
      ON reconciliation_artifacts (dealership_id);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_artifacts_store_month
      ON reconciliation_artifacts (dealership_store_id, accounting_month);
    CREATE INDEX IF NOT EXISTS ix_reconciliation_artifacts_type
      ON reconciliation_artifacts (artifact_type);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS reconciliation_artifacts;
    DROP TABLE IF EXISTS source_file_upload_contents;
  `);
};
