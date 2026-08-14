-- Database roles for tenant isolation.
--
-- RLS is only enforced against NON-superuser, non-BYPASSRLS roles. So:
--   • migrations / seed / studio  → the privileged migration/table-owner role
--     (Cloud SQL customer-managed roles are not PostgreSQL superusers)
--   • the running app              → `app_user` (least-privilege, RLS applies)
--
-- Run this ONCE as the owner, BEFORE the first migration, so the DEFAULT
-- PRIVILEGES below auto-grant app_user access to the tables migrations create.
-- With docker-compose this file is mounted into the init dir and runs on first
-- boot. Change the password before any real deployment (or use IAM auth).

DO $$
BEGIN
  IF current_user = 'app_user' THEN
    RAISE EXCEPTION 'setup-roles.sql must run through the privileged migration connection, not app_user';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user';
  END IF;
END $$;

-- Cloud SQL database owners may set LOGIN, CREATEDB and CREATEROLE, but they
-- cannot change the SUPERUSER, REPLICATION or BYPASSRLS attributes. Normalize
-- the supported attributes, then verify the complete boundary before applying
-- migrations. Cloud SQL's implicit cloudsqlsuperuser membership must first be
-- removed through the Cloud SQL user-management API.
ALTER ROLE app_user WITH LOGIN NOCREATEDB NOCREATEROLE;

DO $$
DECLARE
  runtime_role record;
  has_cloudsqlsuperuser boolean := false;
BEGIN
  SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
  INTO runtime_role
  FROM pg_roles
  WHERE rolname = 'app_user';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_user does not exist';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudsqlsuperuser') THEN
    SELECT pg_has_role('app_user', 'cloudsqlsuperuser', 'MEMBER')
    INTO has_cloudsqlsuperuser;
  END IF;

  IF NOT runtime_role.rolcanlogin
    OR runtime_role.rolsuper
    OR runtime_role.rolcreatedb
    OR runtime_role.rolcreaterole
    OR runtime_role.rolreplication
    OR runtime_role.rolbypassrls
    OR has_cloudsqlsuperuser
  THEN
    RAISE EXCEPTION 'app_user must be LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS and not a member of cloudsqlsuperuser';
  END IF;
END $$;

-- FORCE RLS remains enabled for every tenant table. The separate table-owning
-- migration identity needs an explicit policy for reviewed cross-tenant schema
-- backfills; app_user is never included. Recreate the policy on every release
-- so an intentional migration-owner rotation does not leave stale access.
DO $$
DECLARE
  migration_role name := current_user;
  migration_role_oid oid;
  tenant_table record;
BEGIN
  SELECT oid INTO migration_role_oid FROM pg_roles WHERE rolname = migration_role;
  IF NOT FOUND OR migration_role = 'app_user' THEN
    RAISE EXCEPTION 'migration-owner RLS policies must be installed by the privileged migration identity';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    RAISE EXCEPTION 'app_user must exist before migration-owner RLS policies are installed';
  END IF;
  IF pg_has_role('app_user', migration_role, 'MEMBER') THEN
    RAISE EXCEPTION 'app_user must not inherit the migration identity %', migration_role;
  END IF;

  FOR tenant_table IN
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      relation.relowner AS owner_oid
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  LOOP
    IF tenant_table.owner_oid <> migration_role_oid THEN
      RAISE EXCEPTION 'FORCE-RLS table %.% is not owned by migration identity %',
        tenant_table.schema_name, tenant_table.table_name, migration_role;
    END IF;
    EXECUTE format(
      'DROP POLICY IF EXISTS migration_owner_all_tenants ON %I.%I',
      tenant_table.schema_name,
      tenant_table.table_name
    );
    EXECUTE format(
      'CREATE POLICY migration_owner_all_tenants ON %I.%I AS PERMISSIVE FOR ALL TO %I '
      || 'USING (current_user = %L AND session_user = %L) '
      || 'WITH CHECK (current_user = %L AND session_user = %L)',
      tenant_table.schema_name,
      tenant_table.table_name,
      migration_role,
      migration_role,
      migration_role,
      migration_role,
      migration_role
    );
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO app_user;

-- Tables/sequences the owner creates from here on (i.e. via migrations) are
-- automatically granted to app_user.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- If tables already exist (role added after migrating), grant on them too.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
