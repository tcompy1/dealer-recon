exports.shorthands = undefined;

// bcrypt hash of the local demo password documented in README.md
// (email: demo@dealer-recon.local, password: dealer-recon-demo).
// Generated with bcryptjs at cost 12; verifiable via the runtime verifyPassword.
const DEMO_PASSWORD_HASH =
  "$2b$12$CNeLgYHRWpM5lvEJ1QzDyeKewVpz6.jReaE.uP.Xmzn5kAwb5cgSm";

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
      '${DEMO_PASSWORD_HASH}',
      ${defaultDealershipId}
    WHERE NOT EXISTS (
      SELECT 1 FROM users WHERE lower(email) = lower('demo@dealer-recon.local')
    );

    UPDATE users
    SET password_hash = '${DEMO_PASSWORD_HASH}'
    WHERE lower(email) = lower('demo@dealer-recon.local')
      AND (
        password_hash IS NULL
        OR password_hash = ''
        OR password_hash LIKE 'scrypt$%'
      );

    UPDATE users
    SET password_hash = '${DEMO_PASSWORD_HASH}'
    WHERE password_hash IS NULL OR password_hash = '';

    ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower ON users (lower(email));

    INSERT INTO user_store_assignments (user_id, dealership_store_id)
    SELECT u.id, 1
    FROM users u
    WHERE lower(u.email) = lower('demo@dealer-recon.local')
      AND EXISTS (SELECT 1 FROM dealership_stores WHERE id = 1)
    ON CONFLICT (user_id, dealership_store_id) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM user_store_assignments
    WHERE user_id IN (
      SELECT id FROM users WHERE lower(email) = lower('demo@dealer-recon.local')
    );
    DROP INDEX IF EXISTS ux_users_email_lower;
    DELETE FROM users WHERE lower(email) = lower('demo@dealer-recon.local');
    ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
  `);
};
