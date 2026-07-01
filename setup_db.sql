-- Setup script for dealer_recon database
-- Run this as the postgres superuser

-- Create database if it doesn't exist
SELECT 'CREATE DATABASE dealer_recon'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'dealer_recon')\gexec

-- Connect to the database
\c dealer_recon

-- Create user if it doesn't exist
DO
$$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'dealer_recon') THEN
    CREATE USER dealer_recon WITH PASSWORD 'dealer_recon';
  END IF;
END
$$;

-- Grant all privileges on the database
GRANT ALL PRIVILEGES ON DATABASE dealer_recon TO dealer_recon;

-- Grant schema permissions
GRANT ALL ON SCHEMA public TO dealer_recon;
GRANT CREATE ON SCHEMA public TO dealer_recon;

-- Grant default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO dealer_recon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO dealer_recon;

-- If there are existing tables, grant permissions on them too
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO dealer_recon;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO dealer_recon;

-- Make dealer_recon the owner of the public schema
ALTER SCHEMA public OWNER TO dealer_recon;

\echo 'Database setup complete!'
