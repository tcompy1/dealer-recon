exports.shorthands = undefined;

exports.up = (pgm) => {
  const defaultDealershipId = Number(process.env.DEFAULT_DEALERSHIP_ID ?? 1);
  if (!Number.isInteger(defaultDealershipId) || defaultDealershipId <= 0) {
    throw new Error("DEFAULT_DEALERSHIP_ID must be a positive integer.");
  }

  pgm.sql(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NULL;

    INSERT INTO dealerships (id, name)
    VALUES (${defaultDealershipId}, 'Configured Dealership')
    ON CONFLICT (id) DO NOTHING;

    UPDATE users
    SET password_hash = 'disabled:' || md5(random()::text || clock_timestamp()::text || id::text)
    WHERE password_hash IS NULL
      OR password_hash = ''
      OR password_hash LIKE 'scrypt$%';

    ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower ON users (lower(email));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS ux_users_email_lower;
    ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
  `);
};
