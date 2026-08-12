-- Global MesaDesk service catalog + many-to-many organization subscriptions.
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationService" (
    "organizationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationService_pkey" PRIMARY KEY ("organizationId", "serviceId")
);

CREATE INDEX "OrganizationService_serviceId_idx" ON "OrganizationService"("serviceId");

ALTER TABLE "OrganizationService"
  ADD CONSTRAINT "OrganizationService_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationService"
  ADD CONSTRAINT "OrganizationService_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Service" ("id", "name", "description", "status", "sortOrder") VALUES
  ('mesaops', 'MesaOps', 'Manufacturing operations, planning, quality, inventory and dispatch.', 'active', 10),
  ('mesaleads', 'MesaLeads', 'Lead management and sales pipeline workspace.', 'preview', 20);

-- Preserve existing behavior: every organization already using MesaDesk starts
-- with MesaOps assigned. MesaLeads stays opt-in.
INSERT INTO "OrganizationService" ("organizationId", "serviceId")
SELECT "id", 'mesaops' FROM "Organization"
ON CONFLICT ("organizationId", "serviceId") DO NOTHING;
