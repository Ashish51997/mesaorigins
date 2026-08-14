-- Post-apply planning hardening. The prior 230000 migration is checksum-frozen.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Even concurrent approvers cannot publish overlapping effective revisions.
ALTER TABLE "ErpPlanningBomRevision" ADD CONSTRAINT "ErpPlanningBomRevision_no_approved_overlap"
  EXCLUDE USING gist (
    "bomId" WITH =,
    daterange("effectiveFrom", "effectiveTo", '[]') WITH &&
  ) WHERE ("status" = 'approved');

-- Preferred vendors are optional, but asserted IDs must be approved within the
-- same tenant and company. Arbitrary import text cannot leak into an MRP PR.
CREATE OR REPLACE FUNCTION enforce_erp_item_planning_vendor() RETURNS trigger AS $$
BEGIN
  IF NEW."planningPreferredVendorId" = '' THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "ErpVendor" vendor
    WHERE vendor."id" = NEW."planningPreferredVendorId"
      AND vendor."organizationId" = NEW."organizationId"
      AND vendor."legalEntityId" = NEW."legalEntityId"
      AND vendor."lifecycleStatus" IN ('approved','conditionally_approved')
  ) THEN RAISE EXCEPTION 'preferred planning vendor must be approved in the same company'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpItem_planning_vendor_scope"
BEFORE INSERT OR UPDATE OF "organizationId","legalEntityId","planningPreferredVendorId" ON "ErpItem"
FOR EACH ROW EXECUTE FUNCTION enforce_erp_item_planning_vendor();
