-- Row-Level Security: hard, database-level tenant isolation.
--
-- Every tenant-owned table only exposes rows whose "organizationId" matches the
-- per-transaction setting `app.current_tenant`, which the app sets from the
-- request's tenant context (server/src/db.ts + withTenant). FORCE makes the
-- policy apply even to the table owner, so a forgotten WHERE clause — or a raw
-- query — cannot cross tenants. When the setting is unset, current_setting(...,
-- true) is NULL and no rows match (fail-closed).
--
-- Organization, User and Membership are intentionally excluded: they are the
-- identity/tenancy plane, queried before a tenant is known (during auth).

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'Customer','Inquiry','SalesOrder','ProductionPlan','LogbookTemplate','MachineLogbook',
    'QualityInspection','PackingRecord','InventoryTransaction','DispatchRecord','Complaint',
    'CAPARecord','Recipe','BOMItem','MaintenanceTask','Machine','Supplier','PermissionRule',
    'EmployeeGrant','Delegation','AuditEvent'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING ("organizationId" = current_setting(''app.current_tenant'', true)) '
      || 'WITH CHECK ("organizationId" = current_setting(''app.current_tenant'', true));', t);
  END LOOP;
END $$;
