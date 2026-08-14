CREATE TABLE "ErpComplianceRuleProfile" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL DEFAULT 'IN',
  "artifactKind" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "rules" JSONB NOT NULL,
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
  CONSTRAINT "ErpComplianceRuleProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpComplianceRuleProfile_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  CONSTRAINT "ErpComplianceRuleProfile_kind_check" CHECK ("artifactKind" IN ('outbound_e_invoice', 'e_way_bill', 'inbound_e_invoice')),
  CONSTRAINT "ErpComplianceRuleProfile_status_check" CHECK ("status" IN ('draft', 'approved', 'retired')),
  CONSTRAINT "ErpComplianceRuleProfile_source_checksum_check" CHECK ("sourceChecksum" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "ErpComplianceRuleProfile_identity_key"
ON "ErpComplianceRuleProfile"("organizationId", "legalEntityId", "artifactKind", "version");
CREATE UNIQUE INDEX "ErpComplianceRuleProfile_idempotency_key"
ON "ErpComplianceRuleProfile"("organizationId", "legalEntityId", "createIdempotencyKey");
CREATE INDEX "ErpComplianceRuleProfile_organizationId_idx" ON "ErpComplianceRuleProfile"("organizationId");
CREATE INDEX "ErpComplianceRuleProfile_lookup_idx"
ON "ErpComplianceRuleProfile"("legalEntityId", "artifactKind", "status", "effectiveFrom");

ALTER TABLE "ErpComplianceRuleProfile" ADD CONSTRAINT "ErpComplianceRuleProfile_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpComplianceRuleProfile" ADD CONSTRAINT "ErpComplianceRuleProfile_legalEntityId_fkey"
FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ErpTaxDocument_inbound_identity_unique"
ON "ErpTaxDocument"(
  "organizationId", "legalEntityId", "supplierGstin", "documentType", "documentNumber", "financialYearId"
) WHERE "documentKind" = 'inbound_e_invoice';

CREATE UNIQUE INDEX "ErpTaxDocument_eway_number_unique"
ON "ErpTaxDocument"("organizationId", "legalEntityId", "acknowledgementNumber")
WHERE "documentKind" = 'e_way_bill' AND "acknowledgementNumber" <> '';

CREATE UNIQUE INDEX "ErpTaxDocument_outbound_seller_identity_unique"
ON "ErpTaxDocument"(
  "organizationId", "legalEntityId", "supplierGstin", "documentType", "documentNumber", "financialYearId"
) WHERE "documentKind" = 'outbound_e_invoice';

CREATE UNIQUE INDEX "ErpTaxDocument_eway_source_active_unique"
ON "ErpTaxDocument"("organizationId", "legalEntityId", "sourceDocumentId")
WHERE "documentKind" = 'e_way_bill' AND "sourceDocumentId" IS NOT NULL AND "status" <> 'cancelled';

CREATE UNIQUE INDEX "ErpTaxDocument_gstr2b_period_unique"
ON "ErpTaxDocument"("organizationId", "legalEntityId", "recipientGstin", "documentNumber")
WHERE "documentKind" = 'gstr2b';

ALTER TABLE "ErpTaxDocument" ADD CONSTRAINT "ErpTaxDocument_india_lifecycle_check" CHECK (
  "documentKind" IN ('outbound_e_invoice', 'inbound_e_invoice', 'e_way_bill', 'gstr2b')
  AND "itcStatus" IN ('pending', 'eligible', 'blocked', 'mismatched', 'reversed', 'claimed')
  AND (
    ("documentKind" = 'outbound_e_invoice' AND "status" IN ('draft', 'approved', 'acknowledged', 'cancelled'))
    OR ("documentKind" = 'e_way_bill' AND "status" IN ('draft', 'approved', 'external_pending', 'active', 'cancelled'))
    OR ("documentKind" = 'inbound_e_invoice' AND "status" IN ('received', 'reconciled'))
    OR ("documentKind" = 'gstr2b' AND "status" = 'imported')
  )
);

CREATE OR REPLACE FUNCTION enforce_erp_tax_document_insert_boundary() RETURNS trigger AS $$
DECLARE maker TEXT;
BEGIN
  maker := COALESCE(NEW."reconciliation" #>> '{mesaerpControl,makerMembershipId}', '');
  IF maker = '' THEN
    RAISE EXCEPTION 'ERP tax document requires maker evidence';
  END IF;
  IF NEW."rowVersion" <> 0 OR COALESCE(NEW."createIdempotencyKey", '') = '' THEN
    RAISE EXCEPTION 'ERP tax document must start at row version zero with an idempotency identity';
  END IF;
  IF NEW."evidenceHash" !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'ERP tax document requires a canonical SHA-256 evidence hash';
  END IF;
  IF NEW."documentKind" = 'outbound_e_invoice' AND NEW."status" <> 'draft' THEN
    RAISE EXCEPTION 'outbound e-invoice must start as draft';
  END IF;
  IF NEW."documentKind" = 'outbound_e_invoice' AND (
    NEW."sourceDocumentId" IS NULL OR NEW."ruleProfileVersion" = '' OR NEW."submittedPayload" = '{}'::jsonb
  ) THEN
    RAISE EXCEPTION 'outbound e-invoice draft requires source, rule and immutable payload evidence';
  END IF;
  IF NEW."documentKind" = 'e_way_bill' AND NEW."status" NOT IN ('draft', 'external_pending') THEN
    RAISE EXCEPTION 'e-way bill must start as draft or external pending evidence';
  END IF;
  IF NEW."documentKind" = 'e_way_bill' AND NEW."status" = 'draft' AND (
    NEW."sourceDocumentId" IS NULL OR NEW."ruleProfileVersion" = '' OR NEW."submittedPayload" = '{}'::jsonb
  ) THEN
    RAISE EXCEPTION 'e-way-bill draft requires source, rule and immutable payload evidence';
  END IF;
  IF NEW."documentKind" = 'e_way_bill' AND NEW."status" = 'external_pending' AND (
    NEW."acknowledgementNumber" !~ '^[0-9]{12}$' OR NEW."signedPayload" = '{}'::jsonb OR NEW."validUntil" IS NULL
  ) THEN
    RAISE EXCEPTION 'external e-way-bill evidence is incomplete';
  END IF;
  IF NEW."documentKind" = 'inbound_e_invoice' AND NEW."status" <> 'received' THEN
    RAISE EXCEPTION 'inbound e-invoice must start as received';
  END IF;
  IF NEW."documentKind" = 'inbound_e_invoice' AND (
    NEW."irn" !~ '^[a-f0-9]{64}$' OR NEW."signedPayload" = '{}'::jsonb OR NEW."submittedPayload" = '{}'::jsonb
  ) THEN
    RAISE EXCEPTION 'inbound e-invoice evidence is incomplete';
  END IF;
  IF NEW."documentKind" = 'gstr2b' AND NEW."status" <> 'imported' THEN
    RAISE EXCEPTION 'GSTR-2B evidence must start as imported';
  END IF;
  IF NEW."documentKind" = 'gstr2b' AND (NEW."signedPayload" = '{}'::jsonb OR NEW."submittedPayload" = '{}'::jsonb) THEN
    RAISE EXCEPTION 'GSTR-2B import requires source and normalized evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpTaxDocument_insert_boundary"
BEFORE INSERT ON "ErpTaxDocument"
FOR EACH ROW EXECUTE FUNCTION enforce_erp_tax_document_insert_boundary();

CREATE OR REPLACE FUNCTION protect_erp_tax_document_evidence() RETURNS trigger AS $$
DECLARE maker TEXT;
DECLARE checker TEXT;
DECLARE last_history JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERP tax documents are retained statutory evidence';
  END IF;
  IF ROW(
    NEW."organizationId", NEW."legalEntityId", NEW."financialYearId", NEW."sourceDocumentId",
    NEW."documentKind", NEW."supplierGstin", NEW."recipientGstin", NEW."documentType",
    NEW."documentNumber", NEW."documentDate", NEW."submittedPayload", NEW."ruleProfileVersion",
    NEW."createIdempotencyKey", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."organizationId", OLD."legalEntityId", OLD."financialYearId", OLD."sourceDocumentId",
    OLD."documentKind", OLD."supplierGstin", OLD."recipientGstin", OLD."documentType",
    OLD."documentNumber", OLD."documentDate", OLD."submittedPayload", OLD."ruleProfileVersion",
    OLD."createIdempotencyKey", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'ERP tax document identity and submitted payload are immutable';
  END IF;
  IF OLD."irn" <> '' AND NEW."irn" IS DISTINCT FROM OLD."irn" THEN
    RAISE EXCEPTION 'IRN is immutable once recorded';
  END IF;
  IF OLD."acknowledgementNumber" <> '' AND NEW."acknowledgementNumber" IS DISTINCT FROM OLD."acknowledgementNumber" THEN
    RAISE EXCEPTION 'statutory acknowledgement number is immutable once recorded';
  END IF;
  IF OLD."signedPayload" <> '{}'::jsonb AND NEW."signedPayload" IS DISTINCT FROM OLD."signedPayload" THEN
    RAISE EXCEPTION 'signed statutory acknowledgement is immutable once recorded';
  END IF;
  IF OLD."cancellation" <> '{}'::jsonb AND NEW."cancellation" IS DISTINCT FROM OLD."cancellation" THEN
    RAISE EXCEPTION 'statutory cancellation evidence is immutable once recorded';
  END IF;
  IF OLD."provider" <> '' AND NEW."provider" IS DISTINCT FROM OLD."provider" THEN
    RAISE EXCEPTION 'statutory provider identity is immutable once recorded';
  END IF;
  IF NEW."rowVersion" <> OLD."rowVersion" + 1 THEN
    RAISE EXCEPTION 'ERP tax document updates require row-version compare-and-swap';
  END IF;
  IF NEW."evidenceHash" !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'ERP tax document requires a canonical SHA-256 evidence hash';
  END IF;
  maker := COALESCE(NEW."reconciliation" #>> '{mesaerpControl,makerMembershipId}', '');
  checker := COALESCE(NEW."reconciliation" #>> '{mesaerpControl,approvedBy}', '');
  IF OLD."status" = 'draft' AND NEW."status" = 'approved' AND (checker = '' OR checker = maker) THEN
    RAISE EXCEPTION 'compliance document approval requires a separate checker';
  END IF;
  IF OLD."status" = 'external_pending' AND NEW."status" = 'active' AND (checker = '' OR checker = maker) THEN
    RAISE EXCEPTION 'external e-way-bill verification requires a separate checker';
  END IF;
  IF OLD."documentKind" = 'outbound_e_invoice' AND OLD."status" = 'approved' AND NEW."status" = 'acknowledged' AND (
    NEW."irn" !~ '^[a-f0-9]{64}$' OR NEW."acknowledgementNumber" = '' OR NEW."signedPayload" = '{}'::jsonb OR NEW."qrData" = ''
  ) THEN
    RAISE EXCEPTION 'outbound e-invoice acknowledgement evidence is incomplete';
  END IF;
  IF OLD."documentKind" = 'e_way_bill' AND OLD."status" = 'approved' AND NEW."status" = 'active' AND (
    NEW."acknowledgementNumber" !~ '^[0-9]{12}$' OR NEW."signedPayload" = '{}'::jsonb OR NEW."validUntil" IS NULL
  ) THEN
    RAISE EXCEPTION 'e-way-bill provider acknowledgement evidence is incomplete';
  END IF;
  IF NEW."status" = 'cancelled' AND NEW."cancellation" = '{}'::jsonb THEN
    RAISE EXCEPTION 'statutory cancellation requires immutable provider evidence';
  END IF;
  last_history := NEW."reconciliation"->'history'->-1;
  IF COALESCE(last_history->>'kind', '') = 'itc_decision' THEN
    checker := COALESCE(last_history #>> '{evidence,decidedBy}', '');
    IF checker = '' OR checker = maker THEN
      RAISE EXCEPTION 'ITC decision requires a separate checker';
    END IF;
  END IF;
  IF OLD."documentKind" = 'outbound_e_invoice' THEN
    IF OLD."status" = 'draft' AND NEW."status" NOT IN ('draft', 'approved') THEN
      RAISE EXCEPTION 'outbound e-invoice draft has an invalid transition';
    END IF;
    IF OLD."status" = 'approved' AND NEW."status" NOT IN ('approved', 'acknowledged') THEN
      RAISE EXCEPTION 'approved outbound e-invoice has an invalid transition';
    END IF;
    IF OLD."status" = 'acknowledged' AND NEW."status" NOT IN ('acknowledged', 'cancelled') THEN
      RAISE EXCEPTION 'acknowledged outbound e-invoice has an invalid transition';
    END IF;
    IF OLD."status" = 'cancelled' AND NEW."status" <> 'cancelled' THEN
      RAISE EXCEPTION 'cancelled outbound e-invoice is immutable';
    END IF;
  ELSIF OLD."documentKind" = 'e_way_bill' THEN
    IF OLD."status" = 'draft' AND NEW."status" NOT IN ('draft', 'approved') THEN
      RAISE EXCEPTION 'e-way bill draft has an invalid transition';
    END IF;
    IF OLD."status" = 'approved' AND NEW."status" NOT IN ('approved', 'active') THEN
      RAISE EXCEPTION 'approved e-way bill has an invalid transition';
    END IF;
    IF OLD."status" = 'external_pending' AND NEW."status" NOT IN ('external_pending', 'active') THEN
      RAISE EXCEPTION 'external e-way bill evidence has an invalid transition';
    END IF;
    IF OLD."status" = 'active' AND NEW."status" NOT IN ('active', 'cancelled') THEN
      RAISE EXCEPTION 'active e-way bill has an invalid transition';
    END IF;
    IF OLD."status" = 'cancelled' AND NEW."status" <> 'cancelled' THEN
      RAISE EXCEPTION 'cancelled e-way bill is immutable';
    END IF;
  ELSIF OLD."documentKind" = 'inbound_e_invoice' THEN
    IF OLD."status" = 'received' AND NEW."status" NOT IN ('received', 'reconciled') THEN
      RAISE EXCEPTION 'inbound e-invoice has an invalid transition';
    END IF;
    IF OLD."status" = 'reconciled' AND NEW."status" <> 'reconciled' THEN
      RAISE EXCEPTION 'reconciled inbound e-invoice has an invalid transition';
    END IF;
  ELSIF OLD."documentKind" = 'gstr2b' AND NEW."status" <> 'imported' THEN
    RAISE EXCEPTION 'GSTR-2B evidence status is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpTaxDocument_protect_evidence"
BEFORE UPDATE OR DELETE ON "ErpTaxDocument"
FOR EACH ROW EXECUTE FUNCTION protect_erp_tax_document_evidence();

CREATE OR REPLACE FUNCTION enforce_compliance_rule_profile_insert() RETURNS trigger AS $$
BEGIN
  IF NEW."status" <> 'draft' OR NEW."approvedAt" IS NOT NULL OR NEW."approvedBy" <> '' OR NEW."createdBy" = '' THEN
    RAISE EXCEPTION 'compliance rule profile must start as a maker-owned draft';
  END IF;
  IF NEW."rowVersion" <> 0 OR COALESCE(NEW."createIdempotencyKey", '') = '' OR NEW."requestHash" !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'compliance rule profile must start with idempotency and canonical request evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpComplianceRuleProfile_insert_draft"
BEFORE INSERT ON "ErpComplianceRuleProfile"
FOR EACH ROW EXECUTE FUNCTION enforce_compliance_rule_profile_insert();

CREATE OR REPLACE FUNCTION protect_and_validate_compliance_rule_profile() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'compliance rule profiles are retained evidence';
  END IF;
  IF OLD."status" = 'approved' AND ROW(
    NEW."organizationId", NEW."legalEntityId", NEW."jurisdiction", NEW."artifactKind", NEW."version",
    NEW."effectiveFrom", NEW."effectiveTo", NEW."rules", NEW."sourceReference", NEW."sourceEvidence", NEW."sourceChecksum",
    NEW."createIdempotencyKey", NEW."requestHash", NEW."createdBy", NEW."approvedBy", NEW."approvedAt", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."organizationId", OLD."legalEntityId", OLD."jurisdiction", OLD."artifactKind", OLD."version",
    OLD."effectiveFrom", OLD."effectiveTo", OLD."rules", OLD."sourceReference", OLD."sourceEvidence", OLD."sourceChecksum",
    OLD."createIdempotencyKey", OLD."requestHash", OLD."createdBy", OLD."approvedBy", OLD."approvedAt", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'approved compliance rule profile is immutable';
  END IF;
  IF OLD."status" = 'approved' AND NEW."status" NOT IN ('approved', 'retired') THEN
    RAISE EXCEPTION 'approved compliance rule profile has an invalid transition';
  END IF;
  IF NEW."rowVersion" <> OLD."rowVersion" + 1 THEN
    RAISE EXCEPTION 'compliance rule profile updates require row-version compare-and-swap';
  END IF;
  IF NEW."status" = 'approved' AND OLD."status" <> 'approved' THEN
    IF NEW."approvedAt" IS NULL OR NEW."approvedBy" = '' OR NEW."approvedBy" = NEW."createdBy" THEN
      RAISE EXCEPTION 'compliance rule profile approval requires a separate checker';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "ErpComplianceRuleProfile" existing
      WHERE existing."organizationId" = NEW."organizationId"
        AND existing."legalEntityId" = NEW."legalEntityId"
        AND existing."artifactKind" = NEW."artifactKind"
        AND existing."status" = 'approved'
        AND existing."id" <> NEW."id"
        AND daterange(existing."effectiveFrom", COALESCE(existing."effectiveTo", 'infinity'::date), '[]')
            && daterange(NEW."effectiveFrom", COALESCE(NEW."effectiveTo", 'infinity'::date), '[]')
    ) THEN
      RAISE EXCEPTION 'approved compliance rule profile effective dates overlap';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpComplianceRuleProfile_protect_and_validate"
BEFORE UPDATE OR DELETE ON "ErpComplianceRuleProfile"
FOR EACH ROW EXECUTE FUNCTION protect_and_validate_compliance_rule_profile();

ALTER TABLE "ErpComplianceRuleProfile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ErpComplianceRuleProfile"
USING ("organizationId" = current_setting('app.current_tenant', true))
WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ErpComplianceRuleProfile" TO app_user;
