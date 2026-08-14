-- Database roles for tenant isolation.
--
-- RLS is only enforced against NON-superuser, non-BYPASSRLS roles. So:
--   • migrations / seed / studio  → the owner role (e.g. `masspolimer`, superuser)
--   • the running app              → `app_user` (least-privilege, RLS applies)
--
-- Run this ONCE as the owner, BEFORE the first migration, so the DEFAULT
-- PRIVILEGES below auto-grant app_user access to the tables migrations create.
-- With docker-compose this file is mounted into the init dir and runs on first
-- boot. Change the password before any real deployment (or use IAM auth).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user';
  END IF;
END $$;

-- Reassert the runtime boundary when the Cloud SQL user already existed.
-- Readiness verifies these flags too, but bootstrap should establish the safe
-- state instead of relying on a failed deployment to reveal drift.
ALTER ROLE app_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO app_user;

-- Tables/sequences the owner creates from here on (i.e. via migrations) are
-- automatically granted to app_user.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- If tables already exist (role added after migrating), grant on them too.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
