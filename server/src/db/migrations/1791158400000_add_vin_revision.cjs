exports.up = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM transactions
        WHERE jsonb_path_exists(raw_data::jsonb, '$.**.vin_revision')
           OR jsonb_path_exists(raw_data::jsonb, '$.**.vin_enrichment_history')
           OR jsonb_path_exists(raw_data::jsonb, '$.**.vin_confirmation'))
        OR EXISTS (SELECT 1 FROM audit_events WHERE action_type = 'vin_enrichment_applied'
          AND (jsonb_path_exists(previous_state::jsonb, '$.**.vin_revision')
            OR jsonb_path_exists(new_state::jsonb, '$.**.vin_revision')
            OR jsonb_path_exists(previous_state::jsonb, '$.**.vin_confirmation')
            OR jsonb_path_exists(new_state::jsonb, '$.**.vin_confirmation'))) THEN
        RAISE EXCEPTION 'VIN_REVISION_PREFLIGHT_FAILED: existing revision metadata requires a data-preserving migration review';
      END IF;
    END $$;
    ALTER TABLE transactions ADD COLUMN vin_revision INTEGER NOT NULL DEFAULT 0 CHECK (vin_revision >= 0);
  `);
};
exports.down = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM transactions WHERE vin_revision <> 0
        OR jsonb_path_exists(raw_data::jsonb, '$.**.vin_revision')
        OR jsonb_path_exists(raw_data::jsonb, '$.**.vin_confirmation'))
        OR EXISTS (SELECT 1 FROM audit_events WHERE action_type = 'vin_enrichment_applied'
          AND new_state ? 'vin_revision') THEN
        RAISE EXCEPTION 'VIN_REVISION_DOWN_UNSAFE: preserve correction revisions and audits';
      END IF;
    END $$;
    ALTER TABLE transactions DROP COLUMN vin_revision;
  `);
};
