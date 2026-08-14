-- Fail closed when the independent Role and RoleAssignment company scopes do
-- not agree. The null/null pair is reserved for the narrow platform bootstrap
-- role; every company role must be exact-company on both rows.
CREATE OR REPLACE FUNCTION enforce_mesaerp_role_assignment_scope() RETURNS trigger AS $$
DECLARE
  role_organization TEXT;
  role_company TEXT;
BEGIN
  IF NEW."serviceId" <> 'mesaerp' THEN
    RETURN NEW;
  END IF;

  SELECT role."organizationId", role."erpLegalEntityId"
    INTO role_organization, role_company
  FROM "Role" role
  WHERE role."id" = NEW."roleId";

  IF role_organization IS NULL
     OR role_organization <> NEW."organizationId"
     OR role_company IS DISTINCT FROM NEW."legalEntityId" THEN
    RAISE EXCEPTION 'MesaERP role and assignment company scopes must match exactly';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RoleAssignment_mesaerp_company_scope"
BEFORE INSERT OR UPDATE OF "organizationId", "roleId", "serviceId", "legalEntityId"
ON "RoleAssignment"
FOR EACH ROW EXECUTE FUNCTION enforce_mesaerp_role_assignment_scope();

-- Approved commercial documents and their lines are evidence. Corrections are
-- represented by a new debit/credit/reversal document, not by rewriting the
-- approved snapshot. Only explicit lifecycle columns may change.
CREATE OR REPLACE FUNCTION protect_approved_erp_document() RETURNS trigger AS $$
DECLARE privileged_purge BOOLEAN;
BEGIN
  SELECT pg_get_userbyid("relowner") = current_user INTO privileged_purge
  FROM pg_class WHERE "oid" = TG_RELID;

  IF TG_OP = 'DELETE' THEN
    IF COALESCE(privileged_purge, false) THEN RETURN OLD; END IF;
    IF OLD."status" IN ('approved', 'posted', 'cancelled', 'closed') THEN
      RAISE EXCEPTION 'approved ERP documents are retained commercial evidence';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" IN ('approved', 'posted', 'cancelled', 'closed') THEN
    IF ROW(
      NEW."organizationId", NEW."legalEntityId", NEW."financialYearId", NEW."documentType",
      NEW."documentNumber", NEW."documentDate", NEW."dueDate", NEW."vendorId", NEW."customerId",
      NEW."parentDocumentId", NEW."partySnapshot", NEW."currency", NEW."exchangeRate", NEW."subtotal",
      NEW."discountTotal", NEW."taxTotal", NEW."roundingAmount", NEW."grandTotal", NEW."baseCurrencyTotal",
      NEW."taxSummary", NEW."terms", NEW."shipping", NEW."originType", NEW."originMetadata",
      NEW."sourceSnapshotHash", NEW."createIdempotencyKey", NEW."requestHash", NEW."submittedAt",
      NEW."approvedAt", NEW."createdBy", NEW."approvedBy", NEW."createdAt"
    ) IS DISTINCT FROM ROW(
      OLD."organizationId", OLD."legalEntityId", OLD."financialYearId", OLD."documentType",
      OLD."documentNumber", OLD."documentDate", OLD."dueDate", OLD."vendorId", OLD."customerId",
      OLD."parentDocumentId", OLD."partySnapshot", OLD."currency", OLD."exchangeRate", OLD."subtotal",
      OLD."discountTotal", OLD."taxTotal", OLD."roundingAmount", OLD."grandTotal", OLD."baseCurrencyTotal",
      OLD."taxSummary", OLD."terms", OLD."shipping", OLD."originType", OLD."originMetadata",
      OLD."sourceSnapshotHash", OLD."createIdempotencyKey", OLD."requestHash", OLD."submittedAt",
      OLD."approvedAt", OLD."createdBy", OLD."approvedBy", OLD."createdAt"
    ) THEN
      RAISE EXCEPTION 'approved ERP document content is immutable; use a reversal or adjustment document';
    END IF;

    IF NEW."rowVersion" <> OLD."rowVersion" + 1 THEN
      RAISE EXCEPTION 'approved ERP document lifecycle changes require the next row version';
    END IF;

    IF NOT (
      (OLD."status" = 'approved' AND NEW."status" = 'posted' AND NEW."postedAt" IS NOT NULL)
      OR (OLD."status" = 'approved' AND NEW."status" IN ('cancelled', 'closed') AND NEW."postedAt" IS NOT DISTINCT FROM OLD."postedAt")
      OR (OLD."status" = 'posted' AND NEW."status" = 'closed' AND NEW."postedAt" IS NOT DISTINCT FROM OLD."postedAt")
    ) THEN
      RAISE EXCEPTION 'approved ERP document has an invalid lifecycle transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpDocument_protect_approved"
BEFORE UPDATE OR DELETE ON "ErpDocument"
FOR EACH ROW EXECUTE FUNCTION protect_approved_erp_document();

CREATE OR REPLACE FUNCTION protect_approved_erp_document_line() RETURNS trigger AS $$
DECLARE
  parent_status TEXT;
  privileged_purge BOOLEAN;
BEGIN
  SELECT pg_get_userbyid("relowner") = current_user INTO privileged_purge
  FROM pg_class WHERE "oid" = TG_RELID;

  IF TG_OP = 'DELETE' AND COALESCE(privileged_purge, false) THEN
    RETURN OLD;
  END IF;

  SELECT document."status" INTO parent_status
  FROM "ErpDocument" document
  WHERE document."id" = COALESCE(NEW."documentId", OLD."documentId");

  IF parent_status IN ('approved', 'posted', 'cancelled', 'closed') THEN
    RAISE EXCEPTION 'approved ERP document lines are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpDocumentLine_protect_approved"
BEFORE INSERT OR UPDATE OR DELETE ON "ErpDocumentLine"
FOR EACH ROW EXECUTE FUNCTION protect_approved_erp_document_line();

CREATE OR REPLACE FUNCTION protect_approved_erp_match_case() RETURNS trigger AS $$
DECLARE privileged_purge BOOLEAN;
BEGIN
  SELECT pg_get_userbyid("relowner") = current_user INTO privileged_purge
  FROM pg_class WHERE "oid" = TG_RELID;

  IF TG_OP = 'DELETE' AND COALESCE(privileged_purge, false) THEN
    RETURN OLD;
  END IF;
  IF OLD."status" = 'approved' THEN
    RAISE EXCEPTION 'approved ERP match cases are immutable; create explicit dispute or adjustment evidence';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpMatchCase_protect_approved"
BEFORE UPDATE OR DELETE ON "ErpMatchCase"
FOR EACH ROW EXECUTE FUNCTION protect_approved_erp_match_case();

-- Handoff master mappings are default-deny proposals. Existing mappings are
-- preserved as grandfathered approved evidence; every new mapping or update is
-- inactive until a different actor approves the exact proposal hash.
ALTER TABLE "ErpHandoffMapping"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN "requestedActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "proposedBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "approvedBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvalReason" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "proposalHash" TEXT NOT NULL DEFAULT '';

UPDATE "ErpHandoffMapping"
SET "status" = 'approved',
    "requestedActive" = "active",
    "proposedBy" = "createdBy",
    "approvedBy" = 'migration:20260814243000',
    "approvedAt" = "createdAt",
    "approvalReason" = 'Grandfathered pre-maker-checker mapping',
    "proposalHash" = repeat('0', 64);

ALTER TABLE "ErpHandoffMapping"
  ALTER COLUMN "active" SET DEFAULT false,
  ALTER COLUMN "proposedBy" DROP DEFAULT,
  ALTER COLUMN "proposalHash" DROP DEFAULT,
  ADD CONSTRAINT "ErpHandoffMapping_status_check" CHECK ("status" IN ('draft', 'approved')),
  ADD CONSTRAINT "ErpHandoffMapping_proposal_hash_check" CHECK ("proposalHash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "ErpHandoffMapping_approval_check" CHECK (
    ("status" = 'draft' AND "active" = false AND "proposedBy" <> '' AND "approvedBy" = '' AND "approvedAt" IS NULL)
    OR
    ("status" = 'approved' AND "active" = "requestedActive" AND "approvedBy" <> '' AND "approvedBy" <> "proposedBy" AND "approvedAt" IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION protect_erp_handoff_mapping_approval() RETURNS trigger AS $$
DECLARE privileged_purge BOOLEAN;
BEGIN
  SELECT pg_get_userbyid("relowner") = current_user INTO privileged_purge
  FROM pg_class WHERE "oid" = TG_RELID;

  IF TG_OP = 'DELETE' THEN
    IF COALESCE(privileged_purge, false) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'handoff mapping decisions are retained evidence';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'draft' OR NEW."active" OR NEW."approvedBy" <> '' OR NEW."approvedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'handoff mappings must be inserted as inactive draft proposals';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."rowVersion" <> OLD."rowVersion" + 1 THEN
    RAISE EXCEPTION 'handoff mapping changes require the next row version';
  END IF;

  IF OLD."status" = 'approved' THEN
    IF NEW."status" <> 'draft' OR NEW."active" OR NEW."approvedBy" <> '' OR NEW."approvedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'approved handoff mappings may only move to an inactive draft proposal';
    END IF;
  ELSIF OLD."status" = 'draft' AND NEW."status" = 'approved' THEN
    IF NEW."proposedBy" = NEW."approvedBy" OR NEW."approvalReason" = '' OR NEW."proposalHash" <> OLD."proposalHash" THEN
      RAISE EXCEPTION 'handoff mapping approval requires a separate checker and unchanged proposal evidence';
    END IF;
    IF ROW(NEW."mappingType", NEW."sourceKey", NEW."targetId", NEW."targetValue", NEW."sourceEvidence", NEW."requestedActive", NEW."proposedBy")
       IS DISTINCT FROM
       ROW(OLD."mappingType", OLD."sourceKey", OLD."targetId", OLD."targetValue", OLD."sourceEvidence", OLD."requestedActive", OLD."proposedBy") THEN
      RAISE EXCEPTION 'handoff mapping content cannot change during approval';
    END IF;
  ELSIF OLD."status" = 'draft' AND NEW."status" = 'draft' THEN
    IF NEW."active" OR NEW."approvedBy" <> '' OR NEW."approvedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'draft handoff mapping proposals must remain inactive and unapproved';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid handoff mapping lifecycle transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpHandoffMapping_approval_lifecycle"
BEFORE INSERT OR UPDATE OR DELETE ON "ErpHandoffMapping"
FOR EACH ROW EXECUTE FUNCTION protect_erp_handoff_mapping_approval();
