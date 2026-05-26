exports.shorthands = undefined;

// Splits the single `review_notes` column on reconciliation_exceptions into
// side-specific `boa_notes` and `gl_notes` columns so the Hurst FP Rec
// workbook can keep BOA-side context and GL-side context separate without
// losing existing notes. The legacy `review_notes` column is preserved as a
// fallback (older API clients still write it; readers prefer the side-specific
// columns and fall back to `review_notes` when both are empty).
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE reconciliation_exceptions
      ADD COLUMN IF NOT EXISTS boa_notes TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS gl_notes TEXT NOT NULL DEFAULT '';

    -- Backfill existing notes to the side that matches each exception's source.
    UPDATE reconciliation_exceptions
       SET boa_notes = review_notes
     WHERE source_type = 'boa'
       AND COALESCE(review_notes, '') <> ''
       AND COALESCE(boa_notes, '') = '';

    UPDATE reconciliation_exceptions
       SET gl_notes = review_notes
     WHERE source_type IN ('dealertrack', 'dms', 'gl')
       AND COALESCE(review_notes, '') <> ''
       AND COALESCE(gl_notes, '') = '';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE reconciliation_exceptions
      DROP COLUMN IF EXISTS boa_notes,
      DROP COLUMN IF EXISTS gl_notes;
  `);
};
