exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    SELECT setval(
      pg_get_serial_sequence('dealerships', 'id')::regclass,
      COALESCE(MAX(id), 1),
      COUNT(*) > 0
    )
    FROM dealerships;

    SELECT setval(
      pg_get_serial_sequence('dealer_groups', 'id')::regclass,
      COALESCE(MAX(id), 1),
      COUNT(*) > 0
    )
    FROM dealer_groups;

    SELECT setval(
      pg_get_serial_sequence('dealership_stores', 'id')::regclass,
      COALESCE(MAX(id), 1),
      COUNT(*) > 0
    )
    FROM dealership_stores;
  `);
};

// Sequence advancement is a data-safety repair. Rolling it back would make
// future inserts collide with rows that already exist, so the down migration
// intentionally leaves sequence values unchanged.
exports.down = () => {};
