-- Refresh the migration-owner policy after the MesaERP foundation creates its
-- first company-scoped tables and enables FORCE RLS on them.
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
