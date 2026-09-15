exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    LOCK TABLE dealerships, dealer_groups, dealership_stores
      IN ACCESS EXCLUSIVE MODE;

    DO $$
    DECLARE
      identity RECORD;
      sequence_name TEXT;
      sequence_last_value BIGINT;
      sequence_is_called BOOLEAN;
      sequence_increment BIGINT;
      current_next BIGINT;
      table_next BIGINT;
      restart_with BIGINT;
    BEGIN
      FOR identity IN
        SELECT *
        FROM (VALUES
          ('dealerships'::TEXT),
          ('dealer_groups'::TEXT),
          ('dealership_stores'::TEXT)
        ) AS identities(table_name)
      LOOP
        sequence_name := pg_get_serial_sequence(identity.table_name, 'id');
        IF sequence_name IS NULL THEN
          RAISE EXCEPTION 'Missing owned identity sequence for %.id', identity.table_name;
        END IF;

        -- This no-op ownership declaration takes a transactional sequence lock
        -- before its state is read. Together with the table locks above, inserts
        -- and direct nextval calls cannot race the restart calculation.
        EXECUTE format(
          'ALTER SEQUENCE %s OWNED BY %I.id',
          sequence_name,
          identity.table_name
        );
        EXECUTE format('SELECT last_value, is_called FROM %s', sequence_name)
          INTO sequence_last_value, sequence_is_called;
        SELECT increment
          INTO sequence_increment
          FROM pg_sequence_parameters(sequence_name::regclass);
        EXECUTE format(
          'SELECT COALESCE(MAX(id) + 1, 1) FROM %I',
          identity.table_name
        ) INTO table_next;

        current_next := CASE
          WHEN sequence_is_called THEN sequence_last_value + sequence_increment
          ELSE sequence_last_value
        END;
        restart_with := GREATEST(current_next, table_next);
        EXECUTE format(
          'ALTER SEQUENCE %s RESTART WITH %s',
          sequence_name,
          restart_with
        );
      END LOOP;
    END
    $$;
  `);
};

// Sequence advancement is a data-safety repair. Rolling it back would make
// future inserts collide with rows that already exist, so the down migration
// intentionally leaves sequence values unchanged.
exports.down = () => {};
