-- Structured maker-checker evidence and optimistic versions replace temporary
-- JSON/change-case encodings introduced by the additive foundation migration.
ALTER TABLE "RoleAssignment"
  ADD COLUMN "rowVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "revocationReason" TEXT NOT NULL DEFAULT '';

ALTER TABLE "ErpVendor"
  ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "lastLifecycleActor" TEXT NOT NULL DEFAULT '';

UPDATE "ErpVendor"
SET "createdBy" = COALESCE("originMetadata"->>'createdByMembershipId', ''),
    "lastLifecycleActor" = COALESCE("originMetadata"->>'lastLifecycleActorMembershipId', '');

ALTER TABLE "ErpVendorBankAccount"
  ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "verificationReference" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "decisionReason" TEXT NOT NULL DEFAULT '';

UPDATE "ErpVendorBankAccount"
SET "createdBy" = CASE
  WHEN "changeCaseId" LIKE 'maker:%' THEN split_part(substr("changeCaseId", 7), '|', 1)
  ELSE ''
END;

ALTER TABLE "RoleAssignment"
  ADD CONSTRAINT "RoleAssignment_status_check"
  CHECK ("status" IN ('active', 'revoked', 'expired'));

ALTER TABLE "ErpVendorBankAccount"
  ADD CONSTRAINT "ErpVendorBankAccount_status_check"
  CHECK ("status" IN ('pending_verification', 'verified', 'rejected'));

-- The database independently enforces the accounting lifecycle and
-- maker-checker split. API permission bugs cannot bypass these controls.
CREATE OR REPLACE FUNCTION assert_erp_voucher_lifecycle() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD."status" = 'draft' AND NEW."status" = 'submitted' AND NEW."submittedAt" IS NOT NULL)
    OR (OLD."status" = 'submitted' AND NEW."status" = 'approved' AND NEW."approvedAt" IS NOT NULL)
    OR (OLD."status" = 'approved' AND NEW."status" = 'posted' AND NEW."postedAt" IS NOT NULL)
    OR (OLD."status" = 'posted' AND NEW."status" = 'reversed' AND NEW."reversedAt" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'invalid ERP voucher lifecycle transition from % to %', OLD."status", NEW."status";
  END IF;

  IF NEW."status" = 'approved' AND (NEW."approvedBy" = '' OR NEW."approvedBy" = NEW."createdBy") THEN
    RAISE EXCEPTION 'voucher maker and approver must be different actors';
  END IF;
  IF NEW."status" = 'posted' AND NEW."postedBy" = '' THEN
    RAISE EXCEPTION 'posted voucher requires a posting actor';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpVoucher_lifecycle"
BEFORE UPDATE OF "status" ON "ErpVoucher"
FOR EACH ROW EXECUTE FUNCTION assert_erp_voucher_lifecycle();

CREATE OR REPLACE FUNCTION assert_erp_vendor_checker() RETURNS trigger AS $$
BEGIN
  IF NEW."lifecycleStatus" IS DISTINCT FROM OLD."lifecycleStatus"
     AND NEW."lifecycleStatus" IN ('approved', 'conditionally_approved', 'suspended', 'blocked')
     AND (
       NEW."lastLifecycleActor" = ''
       OR NEW."lastLifecycleActor" = NEW."createdBy"
       OR NEW."lastLifecycleActor" = OLD."lastLifecycleActor"
     ) THEN
    RAISE EXCEPTION 'vendor lifecycle decision requires a separate checker';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpVendor_checker"
BEFORE UPDATE OF "lifecycleStatus" ON "ErpVendor"
FOR EACH ROW EXECUTE FUNCTION assert_erp_vendor_checker();

CREATE OR REPLACE FUNCTION assert_erp_vendor_bank_checker() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'pending_verification' AND NEW."status" IN ('verified', 'rejected') THEN
    IF NEW."verifiedBy" IS NULL OR NEW."verifiedBy" = '' OR NEW."verifiedBy" = NEW."createdBy" THEN
      RAISE EXCEPTION 'vendor bank decision requires a separate checker';
    END IF;
    IF NEW."verificationReference" = '' THEN
      RAISE EXCEPTION 'vendor bank decision requires verification evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpVendorBankAccount_checker"
BEFORE UPDATE OF "status" ON "ErpVendorBankAccount"
FOR EACH ROW EXECUTE FUNCTION assert_erp_vendor_bank_checker();

-- Audit and idempotency rows are evidence, never mutable business records.
CREATE OR REPLACE FUNCTION reject_erp_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only evidence', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION reject_erp_evidence_mutation();

CREATE TRIGGER "ErpIdempotencyRecord_append_only"
BEFORE UPDATE OR DELETE ON "ErpIdempotencyRecord"
FOR EACH ROW EXECUTE FUNCTION reject_erp_evidence_mutation();
