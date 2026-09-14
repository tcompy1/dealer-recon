exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE source_files
      ADD COLUMN accounting_month TEXT NULL,
      ADD COLUMN rooftop_profile_id TEXT NULL,
      ADD COLUMN rooftop_profile_version TEXT NULL,
      ADD COLUMN parser_name TEXT NULL,
      ADD COLUMN parser_version TEXT NULL,
      ADD COLUMN preprocessor_name TEXT NULL,
      ADD COLUMN preprocessor_version TEXT NULL,
      ADD COLUMN preprocessing_metadata JSONB NULL;

    ALTER TABLE reconciliation_runs
      ADD COLUMN accounting_month TEXT NULL,
      ADD COLUMN rooftop_profile_id TEXT NULL,
      ADD COLUMN rooftop_profile_version TEXT NULL;

    ALTER TABLE source_files
      ADD CONSTRAINT source_files_accounting_month_check
      CHECK (
        accounting_month IS NULL
        OR (
          accounting_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
          AND accounting_month !~ '^0000-'
        )
      );

    ALTER TABLE reconciliation_runs
      ADD CONSTRAINT reconciliation_runs_accounting_month_check
      CHECK (
        accounting_month IS NULL
        OR (
          accounting_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
          AND accounting_month !~ '^0000-'
        )
      );

    DROP INDEX IF EXISTS ux_source_files_dealership_source_type_file_hash;
    CREATE UNIQUE INDEX ux_source_files_reusable_identity
      ON source_files (
        dealership_id,
        dealership_store_id,
        source_type,
        accounting_month,
        rooftop_profile_id,
        rooftop_profile_version,
        file_hash,
        parser_name,
        parser_version,
        preprocessor_name,
        preprocessor_version
      );

    CREATE UNIQUE INDEX ux_source_files_legacy_identity
      ON source_files (
        dealership_id,
        dealership_store_id,
        source_type,
        file_hash
      )
      WHERE accounting_month IS NULL
        AND rooftop_profile_id IS NULL
        AND rooftop_profile_version IS NULL
        AND parser_name IS NULL
        AND parser_version IS NULL
        AND preprocessor_name IS NULL
        AND preprocessor_version IS NULL;
  `);
};

exports.down = async (pgm) => {
  const collisions = await pgm.db.select(`
    SELECT dealership_id, dealership_store_id, source_type, file_hash
    FROM source_files
    GROUP BY dealership_id, dealership_store_id, source_type, file_hash
    HAVING COUNT(*) > 1
    LIMIT 1
  `);
  if (collisions.length > 0) {
    throw new Error(
      "Cannot roll back 1789344000000_add_rooftop_run_identity: source_files contains identities that the legacy uniqueness constraint cannot represent.",
    );
  }
  pgm.sql(`
    DROP INDEX IF EXISTS ux_source_files_reusable_identity;
    DROP INDEX IF EXISTS ux_source_files_legacy_identity;
    ALTER TABLE source_files DROP CONSTRAINT IF EXISTS source_files_accounting_month_check;
    ALTER TABLE reconciliation_runs DROP CONSTRAINT IF EXISTS reconciliation_runs_accounting_month_check;
    ALTER TABLE source_files
      DROP COLUMN IF EXISTS accounting_month,
      DROP COLUMN IF EXISTS rooftop_profile_id,
      DROP COLUMN IF EXISTS rooftop_profile_version,
      DROP COLUMN IF EXISTS parser_name,
      DROP COLUMN IF EXISTS parser_version,
      DROP COLUMN IF EXISTS preprocessor_name,
      DROP COLUMN IF EXISTS preprocessor_version,
      DROP COLUMN IF EXISTS preprocessing_metadata;
    ALTER TABLE reconciliation_runs
      DROP COLUMN IF EXISTS accounting_month,
      DROP COLUMN IF EXISTS rooftop_profile_id,
      DROP COLUMN IF EXISTS rooftop_profile_version;
    CREATE UNIQUE INDEX ux_source_files_dealership_source_type_file_hash
      ON source_files (dealership_id, dealership_store_id, source_type, file_hash);
  `);
};
