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

    INSERT INTO users (email, password_hash, dealership_id)
    SELECT
      'demo@dealer-recon.local',
      'scrypt$UYU6Jk26voanP9d8Nx-0kQ$tTkRmBjgGgor7zV4eWCL4LU2NjC8HBa7suSNeaboAl9cp-WP6UojXR__G8vY2QO68xloC5z7A6JYDEXKREjCOw',
      ${defaultDealershipId}
    WHERE NOT EXISTS (
      SELECT 1 FROM users WHERE lower(email) = lower('demo@dealer-recon.local')
    );

    UPDATE users
    SET password_hash = 'scrypt$UYU6Jk26voanP9d8Nx-0kQ$tTkRmBjgGgor7zV4eWCL4LU2NjC8HBa7suSNeaboAl9cp-WP6UojXR__G8vY2QO68xloC5z7A6JYDEXKREjCOw'
    WHERE password_hash IS NULL OR password_hash = '';

    ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower ON users (lower(email));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS ux_users_email_lower;
    DELETE FROM users WHERE lower(email) = lower('demo@dealer-recon.local');
    ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
  `);
};
