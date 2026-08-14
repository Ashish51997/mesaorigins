-- Company-commercial and manufacturing lifecycle invariants. API validation
-- remains the friendly first boundary; these constraints prevent privileged or
-- worker SQL from creating impossible states behind it.
ALTER TABLE "ErpCustomer" ADD CONSTRAINT "ErpCustomer_commercial_values_check"
CHECK (
  "status" IN ('active', 'on_hold', 'blocked')
  AND "currency" ~ '^[A-Z]{3}$'
  AND "creditLimit" >= 0
  AND "creditDays" BETWEEN 0 AND 3650
);

ALTER TABLE "ErpProductionDemand" ADD CONSTRAINT "ErpProductionDemand_lifecycle_check"
CHECK (
  "status" IN ('draft', 'approved', 'released', 'partially_completed', 'completed', 'cancelled')
  AND "demandType" IN ('sales_order', 'internal', 'forecast', 'replenishment', 'trial', 'rework', 'import')
  AND "quantity" > 0
);

ALTER TABLE "ErpManufacturingVoucher" ADD CONSTRAINT "ErpManufacturingVoucher_lifecycle_check"
CHECK (
  "status" IN ('draft', 'submitted', 'approved', 'posted')
  AND "voucherType" IN ('issue', 'return', 'manufacturing', 'completion', 'rework')
  AND "materialValue" >= 0
  AND "conversionValue" >= 0
  AND "recoveryValue" >= 0
  AND "actualCost" >= 0
);

ALTER TABLE "ErpBatchCost" ADD CONSTRAINT "ErpBatchCost_approval_check"
CHECK (
  "status" IN ('draft', 'approved')
  AND ("status" <> 'approved' OR (
    "approvedAt" IS NOT NULL
    AND "approvedBy" <> ''
    AND "sourceSnapshotHash" ~ '^[a-f0-9]{64}$'
  ))
);

CREATE OR REPLACE FUNCTION enforce_erp_production_demand_draft() RETURNS trigger AS $$
BEGIN
  IF NEW."status" <> 'draft' OR NEW."releasedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'ERP production demands must be inserted as unreleased drafts';
  END IF;
  IF COALESCE(NEW."originMetadata" #>> '{mesaerpControl,makerMembershipId}', '') = '' THEN
    RAISE EXCEPTION 'ERP production demand draft requires a maker';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpProductionDemand_insert_draft_only"
BEFORE INSERT ON "ErpProductionDemand"
FOR EACH ROW EXECUTE FUNCTION enforce_erp_production_demand_draft();

CREATE OR REPLACE FUNCTION protect_reviewed_erp_production_demand() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" IN ('approved', 'released', 'partially_completed', 'completed') THEN
    RAISE EXCEPTION 'approved ERP production demands are retained evidence';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('approved', 'released', 'partially_completed', 'completed') THEN
    IF ROW(
      NEW."organizationId", NEW."legalEntityId", NEW."financialYearId", NEW."demandNumber",
      NEW."demandType", NEW."itemId", NEW."quantity", NEW."uom", NEW."requiredOn",
      NEW."bomSnapshot", NEW."materialRequirements", NEW."suggestions", NEW."originType",
      NEW."originMetadata" - 'mesaerpControl', NEW."createIdempotencyKey", NEW."createdAt"
    ) IS DISTINCT FROM ROW(
      OLD."organizationId", OLD."legalEntityId", OLD."financialYearId", OLD."demandNumber",
      OLD."demandType", OLD."itemId", OLD."quantity", OLD."uom", OLD."requiredOn",
      OLD."bomSnapshot", OLD."materialRequirements", OLD."suggestions", OLD."originType",
      OLD."originMetadata" - 'mesaerpControl', OLD."createIdempotencyKey", OLD."createdAt"
    ) THEN
      RAISE EXCEPTION 'approved ERP production demand content is immutable';
    END IF;
    IF OLD."status" = 'approved' AND NEW."status" NOT IN ('approved', 'released', 'cancelled') THEN
      RAISE EXCEPTION 'approved ERP production demand has an invalid transition';
    END IF;
    IF OLD."status" = 'released' AND NEW."status" NOT IN ('released', 'partially_completed', 'completed', 'cancelled') THEN
      RAISE EXCEPTION 'released ERP production demand has an invalid transition';
    END IF;
    IF OLD."status" = 'partially_completed' AND NEW."status" NOT IN ('partially_completed', 'completed', 'cancelled') THEN
      RAISE EXCEPTION 'partially completed ERP production demand has an invalid transition';
    END IF;
    IF OLD."status" = 'completed' AND NEW."status" <> 'completed' THEN
      RAISE EXCEPTION 'completed ERP production demand is immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpProductionDemand_protect_reviewed"
BEFORE UPDATE OR DELETE ON "ErpProductionDemand"
FOR EACH ROW EXECUTE FUNCTION protect_reviewed_erp_production_demand();

CREATE OR REPLACE FUNCTION enforce_erp_manufacturing_voucher_draft() RETURNS trigger AS $$
BEGIN
  IF NEW."status" <> 'draft' OR NEW."approvedAt" IS NOT NULL OR NEW."postedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'ERP manufacturing vouchers must be inserted as unapproved drafts';
  END IF;
  IF COALESCE(NEW."originMetadata" #>> '{mesaerpControl,makerMembershipId}', '') = '' THEN
    RAISE EXCEPTION 'ERP manufacturing voucher draft requires a maker';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpManufacturingVoucher_insert_draft_only"
BEFORE INSERT ON "ErpManufacturingVoucher"
FOR EACH ROW EXECUTE FUNCTION enforce_erp_manufacturing_voucher_draft();

CREATE OR REPLACE FUNCTION protect_reviewed_erp_manufacturing_voucher() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" IN ('submitted', 'approved', 'posted') THEN
    RAISE EXCEPTION 'reviewed ERP manufacturing vouchers are retained evidence';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('submitted', 'approved', 'posted') THEN
    IF ROW(
      NEW."organizationId", NEW."legalEntityId", NEW."financialYearId", NEW."productionDemandId",
      NEW."voucherNumber", NEW."voucherType", NEW."businessDate", NEW."batchNumber",
      NEW."materialLines", NEW."outputLines", NEW."laborLines", NEW."resourceLines",
      NEW."overheadLines", NEW."subcontractLines", NEW."recoveryCredits", NEW."qaDisposition",
      NEW."materialValue", NEW."conversionValue", NEW."recoveryValue", NEW."originType",
      NEW."originMetadata" - 'mesaerpControl', NEW."createIdempotencyKey", NEW."createdAt"
    ) IS DISTINCT FROM ROW(
      OLD."organizationId", OLD."legalEntityId", OLD."financialYearId", OLD."productionDemandId",
      OLD."voucherNumber", OLD."voucherType", OLD."businessDate", OLD."batchNumber",
      OLD."materialLines", OLD."outputLines", OLD."laborLines", OLD."resourceLines",
      OLD."overheadLines", OLD."subcontractLines", OLD."recoveryCredits", OLD."qaDisposition",
      OLD."materialValue", OLD."conversionValue", OLD."recoveryValue", OLD."originType",
      OLD."originMetadata" - 'mesaerpControl', OLD."createIdempotencyKey", OLD."createdAt"
    ) THEN
      RAISE EXCEPTION 'reviewed ERP manufacturing voucher content is immutable';
    END IF;
    IF OLD."status" = 'submitted' AND NEW."status" <> 'approved' THEN
      RAISE EXCEPTION 'submitted ERP manufacturing vouchers may only move to approved';
    END IF;
    IF OLD."status" = 'approved' AND NEW."status" <> 'posted' THEN
      RAISE EXCEPTION 'approved ERP manufacturing vouchers may only move to posted';
    END IF;
    IF OLD."status" = 'posted' THEN
      RAISE EXCEPTION 'posted ERP manufacturing vouchers are immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpManufacturingVoucher_protect_reviewed"
BEFORE UPDATE OR DELETE ON "ErpManufacturingVoucher"
FOR EACH ROW EXECUTE FUNCTION protect_reviewed_erp_manufacturing_voucher();
