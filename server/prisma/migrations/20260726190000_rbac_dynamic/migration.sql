-- Dynamic RBAC: tenant-defined Role + per-employee EmployeeGrant, and a role FK on Membership.
ALTER TABLE "Membership" ADD COLUMN "roleId" TEXT;

CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "screens" JSONB NOT NULL DEFAULT '[]',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Role_organizationId_idx" ON "Role"("organizationId");
CREATE UNIQUE INDEX "Role_organizationId_name_key" ON "Role"("organizationId", "name");

CREATE TABLE "EmployeeGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'on',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeGrant_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeGrant_organizationId_idx" ON "EmployeeGrant"("organizationId");
CREATE INDEX "EmployeeGrant_membershipId_idx" ON "EmployeeGrant"("membershipId");
CREATE UNIQUE INDEX "EmployeeGrant_organizationId_membershipId_screen_key" ON "EmployeeGrant"("organizationId", "membershipId", "screen");

CREATE INDEX "Membership_roleId_idx" ON "Membership"("roleId");
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeGrant" ADD CONSTRAINT "EmployeeGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeGrant" ADD CONSTRAINT "EmployeeGrant_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: Role + EmployeeGrant are tenant-scoped (Membership stays global — identity plane).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Role','EmployeeGrant'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_tenant'', true)) WITH CHECK ("organizationId" = current_setting(''app.current_tenant'', true));', t);
  END LOOP;
END $$;
