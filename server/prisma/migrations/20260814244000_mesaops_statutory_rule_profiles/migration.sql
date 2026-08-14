-- MesaOps owns an independent, versioned statutory applicability register.
-- Profiles are explicit tenant records rather than mutable Organization.settings
-- JSON. An approved no-artifact profile is a reviewed exemption, not an absent
-- rule, and therefore requires an evidence-backed explanation.

CREATE TABLE "MesaOpsStatutoryRuleProfile" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL DEFAULT 'IN',
  "plantCode" TEXT NOT NULL DEFAULT '*',
  "movementType" TEXT NOT NULL DEFAULT '*',
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "requiresInvoice" BOOLEAN NOT NULL,
  "requiresEWayBill" BOOLEAN NOT NULL,
  "reviewedExemptionReason" TEXT NOT NULL DEFAULT '',
  "sourceReference" TEXT NOT NULL,
  "sourceEvidence" JSONB NOT NULL,
  "sourceChecksum" TEXT NOT NULL,
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT NOT NULL DEFAULT '',
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MesaOpsStatutoryRuleProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MesaOpsStatutoryRuleProfile_country_check" CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  CONSTRAINT "MesaOpsStatutoryRuleProfile_plant_check" CHECK ("plantCode" = '*' OR "plantCode" ~ '^[A-Z0-9._-]{1,40}$'),
  CONSTRAINT "MesaOpsStatutoryRuleProfile_movement_check" CHECK ("movementType" IN ('*', 'supply', 'transfer', 'job_work', 'return', 'other')),
  CONSTRAINT "MesaOpsStatutoryRuleProfile_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  CONSTRAINT "MesaOpsStatutoryRuleProfile_status_check" CHECK ("status" IN ('draft', 'approved')),
  CONSTRAINT "MesaOpsStatutoryRuleProfile_checksum_check" CHECK ("sourceChecksum" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "MesaOpsStatutoryRuleProfile_source_check" CHECK (length(btrim("sourceReference")) >= 3 AND "sourceEvidence" <> '{}'::jsonb),
  CONSTRAINT "MesaOpsStatutoryRuleProfile_exemption_check" CHECK (
    "requiresInvoice" OR "requiresEWayBill" OR length(btrim("reviewedExemptionReason")) >= 10
  )
);

CREATE UNIQUE INDEX "MesaOpsStatutoryRuleProfile_identity_key"
ON "MesaOpsStatutoryRuleProfile"("organizationId", "version");
CREATE UNIQUE INDEX "MesaOpsStatutoryRuleProfile_idempotency_key"
ON "MesaOpsStatutoryRuleProfile"("organizationId", "createIdempotencyKey");
CREATE INDEX "MesaOpsStatutoryRuleProfile_lookup_idx"
ON "MesaOpsStatutoryRuleProfile"("organizationId", "status", "countryCode", "plantCode", "movementType", "effectiveFrom");
CREATE UNIQUE INDEX "MesaOpsStatutoryRuleProfile_approved_start_key"
ON "MesaOpsStatutoryRuleProfile"("organizationId", "countryCode", "plantCode", "movementType", "effectiveFrom")
WHERE "status" = 'approved';

ALTER TABLE "MesaOpsStatutoryRuleProfile"
ADD CONSTRAINT "MesaOpsStatutoryRuleProfile_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MesaOpsStatutoryRuleProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MesaOpsStatutoryRuleProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MesaOpsStatutoryRuleProfile"
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

CREATE OR REPLACE FUNCTION protect_mesaops_statutory_rule_profile() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'MesaOps statutory rule profiles are retained evidence';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'draft' OR NEW."rowVersion" <> 0 OR NEW."createdBy" = ''
       OR COALESCE(NEW."createIdempotencyKey", '') = '' THEN
      RAISE EXCEPTION 'MesaOps statutory rule profile must start as an idempotent maker-owned draft';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'approved' THEN
    RAISE EXCEPTION 'approved MesaOps statutory rule profile is immutable';
  END IF;
  IF OLD."status" <> 'draft' OR NEW."status" <> 'approved' THEN
    RAISE EXCEPTION 'MesaOps statutory rule profile supports only draft to approved';
  END IF;
  IF ROW(
    NEW."organizationId", NEW."version", NEW."countryCode", NEW."plantCode", NEW."movementType",
    NEW."effectiveFrom", NEW."effectiveTo", NEW."requiresInvoice", NEW."requiresEWayBill",
    NEW."reviewedExemptionReason", NEW."sourceReference", NEW."sourceEvidence", NEW."sourceChecksum",
    NEW."createIdempotencyKey", NEW."requestHash", NEW."createdBy", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."organizationId", OLD."version", OLD."countryCode", OLD."plantCode", OLD."movementType",
    OLD."effectiveFrom", OLD."effectiveTo", OLD."requiresInvoice", OLD."requiresEWayBill",
    OLD."reviewedExemptionReason", OLD."sourceReference", OLD."sourceEvidence", OLD."sourceChecksum",
    OLD."createIdempotencyKey", OLD."requestHash", OLD."createdBy", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'MesaOps statutory rule profile content is immutable; create a new version';
  END IF;
  IF NEW."rowVersion" <> OLD."rowVersion" + 1 OR NEW."approvedBy" = ''
     OR NEW."approvedBy" = OLD."createdBy" OR NEW."approvedAt" IS NULL THEN
    RAISE EXCEPTION 'MesaOps statutory rule approval requires row-version CAS and a separate checker';
  END IF;

  -- Only one exact-scope version may start on a given day. A later approved
  -- version may supersede an older open-ended version; runtime deterministically
  -- chooses the most specific profile with the latest effective start.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW."organizationId" || ':' || NEW."countryCode" || ':' || NEW."plantCode" || ':' || NEW."movementType", 0
  ));
  IF EXISTS (
    SELECT 1 FROM "MesaOpsStatutoryRuleProfile" p
    WHERE p."organizationId" = NEW."organizationId"
      AND p."id" <> NEW."id"
      AND p."status" = 'approved'
      AND p."countryCode" = NEW."countryCode"
      AND p."plantCode" = NEW."plantCode"
      AND p."movementType" = NEW."movementType"
      AND p."effectiveFrom" = NEW."effectiveFrom"
  ) THEN
    RAISE EXCEPTION 'approved MesaOps statutory rule profile already starts on this date for the exact scope' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MesaOpsStatutoryRuleProfile_protect"
BEFORE INSERT OR UPDATE OR DELETE ON "MesaOpsStatutoryRuleProfile"
FOR EACH ROW EXECUTE FUNCTION protect_mesaops_statutory_rule_profile();
