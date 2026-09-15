exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE reconciliation_runs
      ADD COLUMN automated BOOLEAN NOT NULL DEFAULT FALSE;
    WITH ranked_auto_runs AS (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY dealership_id, boa_source_file_id, dealertrack_source_file_id
        ORDER BY id
      ) AS pair_rank
      FROM reconciliation_runs
      WHERE status = 'completed_auto'
    )
    UPDATE reconciliation_runs rr
      SET automated = TRUE
      FROM ranked_auto_runs ranked
      WHERE rr.id = ranked.id AND ranked.pair_rank = 1;
    CREATE UNIQUE INDEX ux_reconciliation_runs_automated_source_pair
      ON reconciliation_runs (dealership_id, boa_source_file_id, dealertrack_source_file_id)
      WHERE automated = TRUE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS ux_reconciliation_runs_automated_source_pair;
    ALTER TABLE reconciliation_runs DROP COLUMN IF EXISTS automated;
  `);
};
