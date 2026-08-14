-- MesaERP roles are company-scoped business roles. Legacy MesaOps roles remain
-- organization-scoped and cannot be edited through the MesaERP access desk.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProductionPlan" plan
    JOIN "OperationalOrder" demand ON demand."id" = plan."operationalOrderId"
    WHERE demand."legacySalesOrderId" IS NOT NULL
    GROUP BY demand."id", demand."quantity"
    HAVING COUNT(*) > 1 AND BOOL_AND(plan."plannedQuantity" = demand."quantity")
  ) THEN
    RAISE EXCEPTION 'ambiguous legacy multi-plan quantities require reconciliation before MesaERP authorization hardening';
  END IF;
END $$;

ALTER TABLE "Role" ADD COLUMN "erpLegalEntityId" TEXT;

UPDATE "Role" role
SET "erpLegalEntityId" = scoped."legalEntityId"
FROM (
  SELECT "roleId", MIN("legalEntityId") AS "legalEntityId"
  FROM "RoleAssignment"
  WHERE "serviceId" = 'mesaerp' AND "legalEntityId" IS NOT NULL
  GROUP BY "roleId"
  HAVING COUNT(DISTINCT "legalEntityId") = 1
) scoped
WHERE scoped."roleId" = role."id";

UPDATE "Role"
SET "isSystem" = false
WHERE "name" = 'MesaERP Finance Administrator' AND "erpLegalEntityId" IS NOT NULL;

ALTER TABLE "Role"
  ADD CONSTRAINT "Role_erpLegalEntityId_fkey"
  FOREIGN KEY ("erpLegalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Role_erpLegalEntityId_idx" ON "Role"("erpLegalEntityId");

-- A narrow organization-level bootstrap role can create companies. It carries
-- no voucher, vendor, banking, tax, or access-administration authority.
INSERT INTO "Role" (
  "id", "organizationId", "erpLegalEntityId", "name", "screens",
  "isAdmin", "isSystem", "version", "createdAt", "updatedAt"
)
SELECT 'mesaerp-platform-' || md5(org."id"), org."id", NULL,
       'MesaERP Platform Administrator', '[]'::jsonb, false, true, 0,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" org
ON CONFLICT ("organizationId", "name") DO NOTHING;

INSERT INTO "RolePermission" (
  "id", "organizationId", "roleId", "permissionId", "effect", "createdAt"
)
SELECT 'mesaerp-platform-grant-' || md5(org."id"), org."id", role."id",
       permission."id", 'allow', CURRENT_TIMESTAMP
FROM "Organization" org
JOIN "Role" role ON role."organizationId" = org."id"
  AND role."name" = 'MesaERP Platform Administrator'
JOIN "Permission" permission ON permission."key" = 'mesaerp.legal_entity.manage'
ON CONFLICT ("organizationId", "roleId", "permissionId") DO NOTHING;

INSERT INTO "RoleAssignment" (
  "id", "organizationId", "membershipId", "roleId", "serviceId",
  "legalEntityId", "plantCode", "warehouseId", "status", "rowVersion",
  "revokedBy", "revocationReason", "createdAt", "updatedAt"
)
SELECT 'mesaerp-platform-assignment-' || md5(member."id"), member."organizationId",
       member."id", role."id", 'mesaerp', NULL, NULL, NULL, 'active', 0,
       '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Membership" member
JOIN "Role" role ON role."organizationId" = member."organizationId"
  AND role."name" = 'MesaERP Platform Administrator'
WHERE member."role" = 'Owner' AND member."status" <> 'inactive'
ON CONFLICT ("id") DO NOTHING;

-- Backfilled companies receive one explicit, editable company administrator
-- role assigned only to active organization Owners. The role is dormant while
-- MesaERP is not entitled and avoids any legacy-admin privilege inheritance.
INSERT INTO "Role" (
  "id", "organizationId", "erpLegalEntityId", "name", "screens",
  "isAdmin", "isSystem", "version", "createdAt", "updatedAt"
)
SELECT 'mesaerp-company-admin-' || md5(entity."id"), entity."organizationId", entity."id",
       entity."code" || ' MesaERP Administrator', '[]'::jsonb, false, false, 0,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "LegalEntity" entity
WHERE NOT EXISTS (
  SELECT 1 FROM "Role" role WHERE role."organizationId" = entity."organizationId"
    AND role."erpLegalEntityId" = entity."id"
)
ON CONFLICT ("organizationId", "name") DO NOTHING;

INSERT INTO "RolePermission" (
  "id", "organizationId", "roleId", "permissionId", "effect", "createdAt"
)
SELECT 'mesaerp-company-grant-' || md5(role."id" || permission."id"), role."organizationId",
       role."id", permission."id", 'allow', CURRENT_TIMESTAMP
FROM "Role" role
JOIN "Permission" permission ON permission."serviceId" = 'mesaerp'
WHERE role."erpLegalEntityId" IS NOT NULL
  AND role."name" LIKE '% MesaERP Administrator'
ON CONFLICT ("organizationId", "roleId", "permissionId") DO NOTHING;

INSERT INTO "RoleAssignment" (
  "id", "organizationId", "membershipId", "roleId", "serviceId",
  "legalEntityId", "plantCode", "warehouseId", "status", "rowVersion",
  "revokedBy", "revocationReason", "createdAt", "updatedAt"
)
SELECT 'mesaerp-company-assignment-' || md5(member."id" || role."id"), member."organizationId",
       member."id", role."id", 'mesaerp', role."erpLegalEntityId", NULL, NULL,
       'active', 0, '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Membership" member
JOIN "Role" role ON role."organizationId" = member."organizationId"
  AND role."erpLegalEntityId" IS NOT NULL
  AND role."name" LIKE '% MesaERP Administrator'
WHERE member."role" = 'Owner' AND member."status" <> 'inactive'
ON CONFLICT ("id") DO NOTHING;

-- PostgreSQL's ordinary nullable unique constraint treats NULLs as distinct.
-- This partial index provides the intended active-scope uniqueness and closes
-- the check-then-create race for company role assignments.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "RoleAssignment"
    WHERE "status" = 'active'
    GROUP BY "organizationId", "membershipId", "roleId", "serviceId",
             "legalEntityId", "plantCode", "warehouseId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate active role assignments must be quarantined before MesaERP authorization hardening';
  END IF;
END $$;

CREATE UNIQUE INDEX "RoleAssignment_active_scope_unique"
ON "RoleAssignment" (
  "organizationId", "membershipId", "roleId", "serviceId",
  "legalEntityId", "plantCode", "warehouseId"
) NULLS NOT DISTINCT
WHERE "status" = 'active';

-- Voucher families and states are closed enumerations at the database boundary.
ALTER TABLE "ErpVoucher" ADD CONSTRAINT "ErpVoucher_status_check"
CHECK ("status" IN ('draft', 'submitted', 'approved', 'posted', 'reversed'));
ALTER TABLE "ErpVoucher" ADD CONSTRAINT "ErpVoucher_type_check"
CHECK ("voucherType" IN (
  'contra', 'payment', 'receipt', 'journal', 'sales', 'purchase',
  'credit_note', 'debit_note', 'stock_journal', 'manufacturing_journal', 'opening'
));

-- Direct inserts must start at the same safe boundary as the API. In
-- particular, a tenant-scoped SQL path cannot manufacture posted evidence.
CREATE OR REPLACE FUNCTION enforce_erp_voucher_insert_draft() RETURNS trigger AS $$
BEGIN
  IF NEW."status" <> 'draft' THEN
    RAISE EXCEPTION 'ERP vouchers must be inserted as drafts';
  END IF;
  IF NEW."createdBy" = '' THEN
    RAISE EXCEPTION 'ERP voucher draft requires a maker';
  END IF;
  IF NEW."submittedAt" IS NOT NULL OR NEW."approvedAt" IS NOT NULL OR NEW."postedAt" IS NOT NULL
     OR NEW."approvedBy" <> '' OR NEW."postedBy" <> '' THEN
    RAISE EXCEPTION 'ERP voucher insert cannot contain approval or posting evidence';
  END IF;
  IF NEW."transactionDebit" <= 0 OR NEW."transactionDebit" <> NEW."transactionCredit"
     OR NEW."baseDebit" <= 0 OR NEW."baseDebit" <> NEW."baseCredit" THEN
    RAISE EXCEPTION 'ERP voucher draft totals must be non-zero and balanced';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpVoucher_insert_draft_only"
BEFORE INSERT ON "ErpVoucher"
FOR EACH ROW EXECUTE FUNCTION enforce_erp_voucher_insert_draft();

-- Inbox processing fields may advance, but the deduplication identity and
-- received payload evidence never change after receipt.
CREATE OR REPLACE FUNCTION protect_integration_inbox_identity() RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW."organizationId", NEW."legalEntityId", NEW."consumer", NEW."eventId",
    NEW."eventType", NEW."payloadHash", NEW."receivedAt"
  ) IS DISTINCT FROM ROW(
    OLD."organizationId", OLD."legalEntityId", OLD."consumer", OLD."eventId",
    OLD."eventType", OLD."payloadHash", OLD."receivedAt"
  ) THEN
    RAISE EXCEPTION 'integration inbox identity and payload evidence are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "IntegrationInboxReceipt_identity_immutable"
BEFORE UPDATE ON "IntegrationInboxReceipt"
FOR EACH ROW EXECUTE FUNCTION protect_integration_inbox_identity();
