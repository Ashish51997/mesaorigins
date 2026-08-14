-- MesaOps -> MesaERP durable return path and a narrow India TDS evidence
-- foundation. Additive only: no plant event calls ERP synchronously and no
-- existing stock, journal, tax or customer evidence is rewritten.

CREATE TABLE "ErpHandoffMapping" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "sourceService" TEXT NOT NULL DEFAULT 'mesaops',
  "mappingType" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "targetId" TEXT NOT NULL DEFAULT '',
  "targetValue" TEXT NOT NULL DEFAULT '',
  "sourceEvidence" JSONB NOT NULL DEFAULT '{}',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpHandoffMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpHandoffMapping_type_check" CHECK ("mappingType" IN ('item','uom','warehouse','customer')),
  CONSTRAINT "ErpHandoffMapping_source_check" CHECK ("sourceService" = 'mesaops' AND length(trim("sourceKey")) > 0),
  CONSTRAINT "ErpHandoffMapping_target_check" CHECK (
    ("mappingType" = 'uom' AND "targetId" = '' AND length(trim("targetValue")) > 0)
    OR ("mappingType" <> 'uom' AND length(trim("targetId")) > 0)
  )
);

-- A standalone MesaOps event has no ERP company identity. It becomes visible
-- to exactly one company only after a two-person routing decision binds the
-- immutable event id and payload hash to that company.
CREATE TABLE "ErpHandoffEventRoute" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "sourceEventId" TEXT NOT NULL,
  "sourcePayloadHash" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "routingEvidence" JSONB NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT NOT NULL DEFAULT '',
  "approvedAt" TIMESTAMP(3),
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpHandoffEventRoute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpHandoffEventRoute_status_check" CHECK ("status" IN ('draft','approved','rejected')),
  CONSTRAINT "ErpHandoffEventRoute_hash_check" CHECK ("sourcePayloadHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ErpHandoffEventRoute_reason_check" CHECK (length(trim("reason")) >= 8),
  CONSTRAINT "ErpHandoffEventRoute_checker_check" CHECK ("status" <> 'approved' OR ("approvedBy" <> '' AND "approvedBy" <> "createdBy" AND "approvedAt" IS NOT NULL))
);

CREATE TABLE "ErpHandoffInboxEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "sourceEventId" TEXT NOT NULL,
  "sourceService" TEXT NOT NULL DEFAULT 'mesaops',
  "eventType" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "sourceSnapshotHash" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'received',
  "exceptionCode" TEXT NOT NULL DEFAULT '',
  "exceptionDetails" JSONB NOT NULL DEFAULT '{}',
  "createdArtifacts" JSONB NOT NULL DEFAULT '{}',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "receivedBy" TEXT NOT NULL,
  "resolvedBy" TEXT NOT NULL DEFAULT '',
  "resolvedAt" TIMESTAMP(3),
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpHandoffInboxEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpHandoffInboxEvent_source_check" CHECK ("sourceService" = 'mesaops'),
  CONSTRAINT "ErpHandoffInboxEvent_type_check" CHECK ("eventType" IN (
    'mesaops.production-actuals.submitted.v1','mesaops.qa-disposition.recorded.v1','mesaops.physical-dispatch.completed.v1'
  )),
  CONSTRAINT "ErpHandoffInboxEvent_schema_check" CHECK ("schemaVersion" = 1),
  CONSTRAINT "ErpHandoffInboxEvent_state_check" CHECK ("state" IN ('received','accepted','retry','rejected','conflict')),
  CONSTRAINT "ErpHandoffInboxEvent_hash_check" CHECK (
    "sourceSnapshotHash" ~ '^[a-f0-9]{64}$' AND "payloadHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "ErpHandoffInboxEvent_attempt_check" CHECK ("attemptCount" >= 0)
);

CREATE TABLE "ErpPlantQaEvidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "handoffInboxEventId" TEXT NOT NULL,
  "inspectionId" TEXT NOT NULL,
  "operationalOrderId" TEXT NOT NULL,
  "productionPlanId" TEXT NOT NULL DEFAULT '',
  "logbookId" TEXT NOT NULL DEFAULT '',
  "productCode" TEXT NOT NULL,
  "lotNumber" TEXT NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "uom" TEXT NOT NULL,
  "disposition" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "evidenceSnapshot" JSONB NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "acceptedBy" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpPlantQaEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpPlantQaEvidence_disposition_check" CHECK ("disposition" IN ('accepted','hold','rejected')),
  CONSTRAINT "ErpPlantQaEvidence_quantity_check" CHECK ("quantity" >= 0),
  CONSTRAINT "ErpPlantQaEvidence_hash_check" CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "ErpPlantDispatchEvidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "handoffInboxEventId" TEXT NOT NULL,
  "sourceDispatchId" TEXT NOT NULL,
  "operationalOrderId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "salesInvoiceId" TEXT,
  "businessDate" DATE NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "uom" TEXT NOT NULL,
  "invoiceReference" TEXT NOT NULL DEFAULT '',
  "gatePassNumber" TEXT NOT NULL DEFAULT '',
  "vehicleNumber" TEXT NOT NULL DEFAULT '',
  "evidenceSnapshot" JSONB NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "acceptedBy" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpPlantDispatchEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpPlantDispatchEvidence_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "ErpPlantDispatchEvidence_hash_check" CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "ErpTdsSection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "natureOfPayment" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sourceReference" TEXT NOT NULL,
  "sourceEvidence" JSONB NOT NULL,
  "effectiveSourceHash" TEXT NOT NULL,
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT NOT NULL DEFAULT '',
  "approvedAt" TIMESTAMP(3),
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpTdsSection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpTdsSection_status_check" CHECK ("status" IN ('draft','approved','retired')),
  CONSTRAINT "ErpTdsSection_hash_check" CHECK ("effectiveSourceHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ErpTdsSection_checker_check" CHECK ("status" <> 'approved' OR ("approvedBy" <> '' AND "approvedBy" <> "createdBy" AND "approvedAt" IS NOT NULL))
);

CREATE TABLE "ErpTdsRate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "standardRate" DECIMAL(7,4) NOT NULL,
  "noPanRate" DECIMAL(7,4) NOT NULL,
  "singlePaymentThreshold" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "aggregateThreshold" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "thresholdApplication" TEXT NOT NULL DEFAULT 'full_current',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sourceReference" TEXT NOT NULL,
  "sourceEvidence" JSONB NOT NULL,
  "sourceEvidenceHash" TEXT NOT NULL,
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT NOT NULL DEFAULT '',
  "approvedAt" TIMESTAMP(3),
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpTdsRate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpTdsRate_status_check" CHECK ("status" IN ('draft','approved','retired')),
  CONSTRAINT "ErpTdsRate_date_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  CONSTRAINT "ErpTdsRate_value_check" CHECK (
    "standardRate" >= 0 AND "standardRate" <= 100 AND "noPanRate" >= 0 AND "noPanRate" <= 100
    AND "singlePaymentThreshold" >= 0 AND "aggregateThreshold" >= 0
  ),
  CONSTRAINT "ErpTdsRate_threshold_check" CHECK ("thresholdApplication" IN ('full_current','excess_only')),
  CONSTRAINT "ErpTdsRate_hash_check" CHECK ("sourceEvidenceHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ErpTdsRate_checker_check" CHECK ("status" <> 'approved' OR ("approvedBy" <> '' AND "approvedBy" <> "createdBy" AND "approvedAt" IS NOT NULL))
);

CREATE TABLE "ErpVendorTdsClassification" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "panStatus" TEXT NOT NULL DEFAULT 'valid',
  "overrideRate" DECIMAL(7,4),
  "certificateReference" TEXT NOT NULL DEFAULT '',
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "evidenceHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT NOT NULL DEFAULT '',
  "approvedAt" TIMESTAMP(3),
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpVendorTdsClassification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpVendorTdsClassification_status_check" CHECK ("status" IN ('draft','approved','retired')),
  CONSTRAINT "ErpVendorTdsClassification_pan_check" CHECK ("panStatus" IN ('valid','missing','invalid')),
  CONSTRAINT "ErpVendorTdsClassification_date_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  CONSTRAINT "ErpVendorTdsClassification_rate_check" CHECK ("overrideRate" IS NULL OR ("overrideRate" >= 0 AND "overrideRate" <= 100)),
  CONSTRAINT "ErpVendorTdsClassification_hash_check" CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ErpVendorTdsClassification_checker_check" CHECK ("status" <> 'approved' OR ("approvedBy" <> '' AND "approvedBy" <> "createdBy" AND "approvedAt" IS NOT NULL))
);

CREATE TABLE "ErpTdsDeduction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "financialYearId" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "rateId" TEXT NOT NULL,
  "vendorClassificationId" TEXT NOT NULL,
  "payableVoucherId" TEXT NOT NULL,
  "paymentVoucherId" TEXT,
  "businessDate" DATE NOT NULL,
  "grossAmount" DECIMAL(18,2) NOT NULL,
  "priorAggregateBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "taxableBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "appliedRate" DECIMAL(7,4) NOT NULL,
  "deductionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "calculationSnapshot" JSONB NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT NOT NULL DEFAULT '',
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpTdsDeduction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpTdsDeduction_status_check" CHECK ("status" IN ('draft','submitted','approved')),
  CONSTRAINT "ErpTdsDeduction_value_check" CHECK (
    "grossAmount" > 0 AND "priorAggregateBase" >= 0 AND "taxableBase" >= 0
    AND "appliedRate" >= 0 AND "appliedRate" <= 100 AND "deductionAmount" >= 0
  ),
  CONSTRAINT "ErpTdsDeduction_hash_check" CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ErpTdsDeduction_checker_check" CHECK ("status" <> 'approved' OR ("approvedBy" <> '' AND "approvedBy" <> "createdBy" AND "approvedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "ErpHandoffMapping_identity_key" ON "ErpHandoffMapping"("organizationId","legalEntityId","sourceService","mappingType","sourceKey");
CREATE UNIQUE INDEX "ErpHandoffMapping_idempotency_key" ON "ErpHandoffMapping"("organizationId","legalEntityId","createIdempotencyKey");
CREATE INDEX "ErpHandoffMapping_organization_idx" ON "ErpHandoffMapping"("organizationId");
CREATE INDEX "ErpHandoffMapping_lookup_idx" ON "ErpHandoffMapping"("legalEntityId","mappingType","active");

CREATE UNIQUE INDEX "ErpHandoffEventRoute_source_key" ON "ErpHandoffEventRoute"("organizationId","sourceEventId");
CREATE UNIQUE INDEX "ErpHandoffEventRoute_idempotency_key" ON "ErpHandoffEventRoute"("organizationId","legalEntityId","createIdempotencyKey");
CREATE INDEX "ErpHandoffEventRoute_organization_idx" ON "ErpHandoffEventRoute"("organizationId");
CREATE INDEX "ErpHandoffEventRoute_company_status_idx" ON "ErpHandoffEventRoute"("legalEntityId","status","createdAt");

CREATE UNIQUE INDEX "ErpHandoffInboxEvent_source_key" ON "ErpHandoffInboxEvent"("organizationId","legalEntityId","sourceEventId");
CREATE INDEX "ErpHandoffInboxEvent_organization_idx" ON "ErpHandoffInboxEvent"("organizationId");
CREATE INDEX "ErpHandoffInboxEvent_state_idx" ON "ErpHandoffInboxEvent"("legalEntityId","state","occurredAt");
CREATE INDEX "ErpHandoffInboxEvent_aggregate_idx" ON "ErpHandoffInboxEvent"("legalEntityId","eventType","aggregateType","aggregateId");

CREATE UNIQUE INDEX "ErpPlantQaEvidence_inbox_key" ON "ErpPlantQaEvidence"("handoffInboxEventId");
CREATE UNIQUE INDEX "ErpPlantQaEvidence_inspection_key" ON "ErpPlantQaEvidence"("organizationId","legalEntityId","inspectionId");
CREATE INDEX "ErpPlantQaEvidence_organization_idx" ON "ErpPlantQaEvidence"("organizationId");
CREATE INDEX "ErpPlantQaEvidence_order_lot_idx" ON "ErpPlantQaEvidence"("legalEntityId","operationalOrderId","lotNumber");

CREATE UNIQUE INDEX "ErpPlantDispatchEvidence_inbox_key" ON "ErpPlantDispatchEvidence"("handoffInboxEventId");
CREATE UNIQUE INDEX "ErpPlantDispatchEvidence_dispatch_key" ON "ErpPlantDispatchEvidence"("organizationId","legalEntityId","sourceDispatchId");
CREATE INDEX "ErpPlantDispatchEvidence_organization_idx" ON "ErpPlantDispatchEvidence"("organizationId");
CREATE INDEX "ErpPlantDispatchEvidence_order_idx" ON "ErpPlantDispatchEvidence"("legalEntityId","operationalOrderId","businessDate");
CREATE INDEX "ErpPlantDispatchEvidence_invoice_idx" ON "ErpPlantDispatchEvidence"("salesInvoiceId");

CREATE UNIQUE INDEX "ErpTdsSection_code_key" ON "ErpTdsSection"("organizationId","legalEntityId","code");
CREATE UNIQUE INDEX "ErpTdsSection_idempotency_key" ON "ErpTdsSection"("organizationId","legalEntityId","createIdempotencyKey");
CREATE INDEX "ErpTdsSection_organization_idx" ON "ErpTdsSection"("organizationId");
CREATE INDEX "ErpTdsSection_status_idx" ON "ErpTdsSection"("legalEntityId","status");

CREATE UNIQUE INDEX "ErpTdsRate_idempotency_key" ON "ErpTdsRate"("organizationId","legalEntityId","createIdempotencyKey");
CREATE INDEX "ErpTdsRate_organization_idx" ON "ErpTdsRate"("organizationId");
CREATE INDEX "ErpTdsRate_lookup_idx" ON "ErpTdsRate"("legalEntityId","sectionId","status","effectiveFrom");

CREATE UNIQUE INDEX "ErpVendorTdsClassification_idempotency_key" ON "ErpVendorTdsClassification"("organizationId","legalEntityId","createIdempotencyKey");
CREATE INDEX "ErpVendorTdsClassification_organization_idx" ON "ErpVendorTdsClassification"("organizationId");
CREATE INDEX "ErpVendorTdsClassification_lookup_idx" ON "ErpVendorTdsClassification"("legalEntityId","vendorId","sectionId","status","effectiveFrom");

CREATE UNIQUE INDEX "ErpTdsDeduction_idempotency_key" ON "ErpTdsDeduction"("organizationId","legalEntityId","createIdempotencyKey");
CREATE INDEX "ErpTdsDeduction_organization_idx" ON "ErpTdsDeduction"("organizationId");
CREATE INDEX "ErpTdsDeduction_date_idx" ON "ErpTdsDeduction"("legalEntityId","businessDate","status");
CREATE INDEX "ErpTdsDeduction_vendor_idx" ON "ErpTdsDeduction"("vendorId","sectionId","financialYearId");
CREATE INDEX "ErpTdsDeduction_payable_idx" ON "ErpTdsDeduction"("payableVoucherId");
CREATE INDEX "ErpTdsDeduction_payment_idx" ON "ErpTdsDeduction"("paymentVoucherId");

ALTER TABLE "ErpHandoffMapping" ADD CONSTRAINT "ErpHandoffMapping_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpHandoffMapping" ADD CONSTRAINT "ErpHandoffMapping_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpHandoffEventRoute" ADD CONSTRAINT "ErpHandoffEventRoute_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpHandoffEventRoute" ADD CONSTRAINT "ErpHandoffEventRoute_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpHandoffInboxEvent" ADD CONSTRAINT "ErpHandoffInboxEvent_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpHandoffInboxEvent" ADD CONSTRAINT "ErpHandoffInboxEvent_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlantQaEvidence" ADD CONSTRAINT "ErpPlantQaEvidence_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlantQaEvidence" ADD CONSTRAINT "ErpPlantQaEvidence_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlantQaEvidence" ADD CONSTRAINT "ErpPlantQaEvidence_inbox_fkey" FOREIGN KEY ("handoffInboxEventId") REFERENCES "ErpHandoffInboxEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlantDispatchEvidence" ADD CONSTRAINT "ErpPlantDispatchEvidence_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlantDispatchEvidence" ADD CONSTRAINT "ErpPlantDispatchEvidence_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlantDispatchEvidence" ADD CONSTRAINT "ErpPlantDispatchEvidence_inbox_fkey" FOREIGN KEY ("handoffInboxEventId") REFERENCES "ErpHandoffInboxEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlantDispatchEvidence" ADD CONSTRAINT "ErpPlantDispatchEvidence_item_fkey" FOREIGN KEY ("itemId") REFERENCES "ErpItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlantDispatchEvidence" ADD CONSTRAINT "ErpPlantDispatchEvidence_warehouse_fkey" FOREIGN KEY ("warehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlantDispatchEvidence" ADD CONSTRAINT "ErpPlantDispatchEvidence_customer_fkey" FOREIGN KEY ("customerId") REFERENCES "ErpCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlantDispatchEvidence" ADD CONSTRAINT "ErpPlantDispatchEvidence_invoice_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsSection" ADD CONSTRAINT "ErpTdsSection_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsSection" ADD CONSTRAINT "ErpTdsSection_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsRate" ADD CONSTRAINT "ErpTdsRate_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsRate" ADD CONSTRAINT "ErpTdsRate_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsRate" ADD CONSTRAINT "ErpTdsRate_section_fkey" FOREIGN KEY ("sectionId") REFERENCES "ErpTdsSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpVendorTdsClassification" ADD CONSTRAINT "ErpVendorTdsClassification_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpVendorTdsClassification" ADD CONSTRAINT "ErpVendorTdsClassification_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpVendorTdsClassification" ADD CONSTRAINT "ErpVendorTdsClassification_vendor_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpVendorTdsClassification" ADD CONSTRAINT "ErpVendorTdsClassification_section_fkey" FOREIGN KEY ("sectionId") REFERENCES "ErpTdsSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsDeduction" ADD CONSTRAINT "ErpTdsDeduction_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsDeduction" ADD CONSTRAINT "ErpTdsDeduction_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsDeduction" ADD CONSTRAINT "ErpTdsDeduction_year_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsDeduction" ADD CONSTRAINT "ErpTdsDeduction_vendor_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsDeduction" ADD CONSTRAINT "ErpTdsDeduction_section_fkey" FOREIGN KEY ("sectionId") REFERENCES "ErpTdsSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsDeduction" ADD CONSTRAINT "ErpTdsDeduction_rate_fkey" FOREIGN KEY ("rateId") REFERENCES "ErpTdsRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsDeduction" ADD CONSTRAINT "ErpTdsDeduction_classification_fkey" FOREIGN KEY ("vendorClassificationId") REFERENCES "ErpVendorTdsClassification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsDeduction" ADD CONSTRAINT "ErpTdsDeduction_payable_fkey" FOREIGN KEY ("payableVoucherId") REFERENCES "ErpVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTdsDeduction" ADD CONSTRAINT "ErpTdsDeduction_payment_fkey" FOREIGN KEY ("paymentVoucherId") REFERENCES "ErpVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Approved effective periods cannot overlap, even across concurrent checker
-- transactions. btree_gist is already provisioned by the MRP hardening.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "ErpTdsRate" ADD CONSTRAINT "ErpTdsRate_no_approved_overlap"
  EXCLUDE USING gist ("sectionId" WITH =, daterange("effectiveFrom", "effectiveTo", '[]') WITH &&)
  WHERE ("status" = 'approved');
ALTER TABLE "ErpVendorTdsClassification" ADD CONSTRAINT "ErpVendorTdsClassification_no_approved_overlap"
  EXCLUDE USING gist ("vendorId" WITH =, "sectionId" WITH =, daterange("effectiveFrom", "effectiveTo", '[]') WITH &&)
  WHERE ("status" = 'approved');

-- Polymorphic handoff mappings still fail closed at the database boundary.
CREATE OR REPLACE FUNCTION enforce_erp_handoff_mapping_target() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "LegalEntity" entity
    WHERE entity."id" = NEW."legalEntityId" AND entity."organizationId" = NEW."organizationId"
  ) THEN RAISE EXCEPTION 'handoff mapping legal entity must belong to its tenant'; END IF;
  IF NEW."mappingType" = 'uom' THEN RETURN NEW; END IF;
  IF NEW."mappingType" = 'item' AND NOT EXISTS (
    SELECT 1 FROM "ErpItem" target WHERE target."id" = NEW."targetId" AND target."organizationId" = NEW."organizationId" AND target."legalEntityId" = NEW."legalEntityId" AND target."active"
  ) THEN RAISE EXCEPTION 'handoff item mapping must target an active item in the same company'; END IF;
  IF NEW."mappingType" = 'warehouse' AND NOT EXISTS (
    SELECT 1 FROM "ErpWarehouse" target WHERE target."id" = NEW."targetId" AND target."organizationId" = NEW."organizationId" AND target."legalEntityId" = NEW."legalEntityId" AND target."active"
  ) THEN RAISE EXCEPTION 'handoff warehouse mapping must target an active warehouse in the same company'; END IF;
  IF NEW."mappingType" = 'customer' AND NOT EXISTS (
    SELECT 1 FROM "ErpCustomer" target WHERE target."id" = NEW."targetId" AND target."organizationId" = NEW."organizationId" AND target."legalEntityId" = NEW."legalEntityId" AND target."status" = 'active'
  ) THEN RAISE EXCEPTION 'handoff customer mapping must target an active customer in the same company'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpHandoffMapping_target_scope" BEFORE INSERT OR UPDATE OF "organizationId","legalEntityId","mappingType","targetId" ON "ErpHandoffMapping" FOR EACH ROW EXECUTE FUNCTION enforce_erp_handoff_mapping_target();

CREATE OR REPLACE FUNCTION enforce_erp_handoff_event_route() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "LegalEntity" entity WHERE entity."id" = NEW."legalEntityId" AND entity."organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'handoff event route legal entity must belong to its tenant';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "IntegrationOutboxEvent" event
    WHERE event."id" = NEW."sourceEventId" AND event."organizationId" = NEW."organizationId"
      AND event."serviceId" = 'mesaops' AND event."legalEntityId" IS NULL
      AND event."payloadHash" = NEW."sourcePayloadHash"
      AND event."eventType" IN ('mesaops.production-actuals.submitted.v1','mesaops.qa-disposition.recorded.v1','mesaops.physical-dispatch.completed.v1')
  ) THEN RAISE EXCEPTION 'route must bind an exact unrouted MesaOps event and payload hash'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpHandoffEventRoute_scope" BEFORE INSERT OR UPDATE ON "ErpHandoffEventRoute" FOR EACH ROW EXECUTE FUNCTION enforce_erp_handoff_event_route();

CREATE OR REPLACE FUNCTION protect_erp_handoff_event_route() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" <> 'draft' THEN RAISE EXCEPTION 'reviewed event routing evidence is immutable'; END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('approved','rejected') THEN RAISE EXCEPTION 'resolved event routing evidence is immutable'; END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW."organizationId",NEW."legalEntityId",NEW."sourceEventId",NEW."sourcePayloadHash",NEW."reason",NEW."routingEvidence",NEW."evidenceHash",NEW."createdBy",NEW."createdAt") IS DISTINCT FROM ROW(OLD."organizationId",OLD."legalEntityId",OLD."sourceEventId",OLD."sourcePayloadHash",OLD."reason",OLD."routingEvidence",OLD."evidenceHash",OLD."createdBy",OLD."createdAt") THEN
    RAISE EXCEPTION 'event routing identity and evidence are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpHandoffEventRoute_immutable" BEFORE UPDATE OR DELETE ON "ErpHandoffEventRoute" FOR EACH ROW EXECUTE FUNCTION protect_erp_handoff_event_route();

-- The received payload and source identity never change; only local resolution
-- state, retry diagnostics and artifact references may advance.
CREATE OR REPLACE FUNCTION protect_erp_handoff_inbox_evidence() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ERP handoff inbox evidence is immutable'; END IF;
  IF ROW(NEW."organizationId",NEW."legalEntityId",NEW."sourceEventId",NEW."sourceService",NEW."eventType",NEW."schemaVersion",NEW."aggregateType",NEW."aggregateId",NEW."correlationId",NEW."occurredAt",NEW."sourceSnapshotHash",NEW."payloadHash",NEW."payload",NEW."receivedBy",NEW."receivedAt")
     IS DISTINCT FROM ROW(OLD."organizationId",OLD."legalEntityId",OLD."sourceEventId",OLD."sourceService",OLD."eventType",OLD."schemaVersion",OLD."aggregateType",OLD."aggregateId",OLD."correlationId",OLD."occurredAt",OLD."sourceSnapshotHash",OLD."payloadHash",OLD."payload",OLD."receivedBy",OLD."receivedAt") THEN
    RAISE EXCEPTION 'ERP handoff source identity and payload are immutable';
  END IF;
  IF OLD."state" IN ('accepted','rejected') AND NEW."state" <> OLD."state" THEN
    RAISE EXCEPTION 'resolved ERP handoff state is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpHandoffInboxEvent_immutable_evidence" BEFORE UPDATE OR DELETE ON "ErpHandoffInboxEvent" FOR EACH ROW EXECUTE FUNCTION protect_erp_handoff_inbox_evidence();

CREATE OR REPLACE FUNCTION protect_erp_plant_evidence() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'accepted plant handoff evidence is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpPlantQaEvidence_immutable" BEFORE UPDATE OR DELETE ON "ErpPlantQaEvidence" FOR EACH ROW EXECUTE FUNCTION protect_erp_plant_evidence();
CREATE TRIGGER "ErpPlantDispatchEvidence_immutable" BEFORE UPDATE OR DELETE ON "ErpPlantDispatchEvidence" FOR EACH ROW EXECUTE FUNCTION protect_erp_plant_evidence();

-- Company references are checked in addition to ordinary foreign keys so a
-- valid id from another company can never be attached through raw SQL.
CREATE OR REPLACE FUNCTION enforce_erp_return_tds_company_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "LegalEntity" entity WHERE entity."id" = NEW."legalEntityId" AND entity."organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'record legal entity must belong to its tenant';
  END IF;
  IF TG_TABLE_NAME = 'ErpHandoffInboxEvent' AND NOT EXISTS (
    SELECT 1 FROM "IntegrationOutboxEvent" event WHERE event."id" = NEW."sourceEventId" AND event."organizationId" = NEW."organizationId"
      AND event."serviceId" = 'mesaops' AND event."eventType" = NEW."eventType"
      AND event."schemaVersion" = NEW."schemaVersion" AND event."aggregateType" = NEW."aggregateType" AND event."aggregateId" = NEW."aggregateId"
      AND event."correlationId" = NEW."correlationId" AND event."payloadHash" = NEW."payloadHash"
      AND (
        event."legalEntityId" = NEW."legalEntityId"
        OR (event."legalEntityId" IS NULL AND EXISTS (
          SELECT 1 FROM "ErpHandoffEventRoute" route
          WHERE route."organizationId" = NEW."organizationId" AND route."legalEntityId" = NEW."legalEntityId"
            AND route."sourceEventId" = event."id" AND route."sourcePayloadHash" = event."payloadHash" AND route."status" = 'approved'
        ))
      )
  ) THEN RAISE EXCEPTION 'handoff inbox must reference the exact same-company MesaOps outbox event'; END IF;
  IF TG_TABLE_NAME = 'ErpPlantQaEvidence' AND NOT EXISTS (
    SELECT 1 FROM "ErpHandoffInboxEvent" inbox WHERE inbox."id" = NEW."handoffInboxEventId" AND inbox."organizationId" = NEW."organizationId" AND inbox."legalEntityId" = NEW."legalEntityId" AND inbox."eventType" = 'mesaops.qa-disposition.recorded.v1'
  ) THEN RAISE EXCEPTION 'QA evidence must reference a same-company QA handoff'; END IF;
  IF TG_TABLE_NAME = 'ErpPlantDispatchEvidence' THEN
    IF NOT EXISTS (SELECT 1 FROM "ErpHandoffInboxEvent" inbox WHERE inbox."id" = NEW."handoffInboxEventId" AND inbox."organizationId" = NEW."organizationId" AND inbox."legalEntityId" = NEW."legalEntityId" AND inbox."eventType" = 'mesaops.physical-dispatch.completed.v1') THEN RAISE EXCEPTION 'dispatch evidence must reference a same-company dispatch handoff'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpItem" item WHERE item."id" = NEW."itemId" AND item."organizationId" = NEW."organizationId" AND item."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'dispatch item must belong to the same company'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpWarehouse" warehouse WHERE warehouse."id" = NEW."warehouseId" AND warehouse."organizationId" = NEW."organizationId" AND warehouse."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'dispatch warehouse must belong to the same company'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpCustomer" customer WHERE customer."id" = NEW."customerId" AND customer."organizationId" = NEW."organizationId" AND customer."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'dispatch customer must belong to the same company'; END IF;
    IF NEW."salesInvoiceId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ErpDocument" document WHERE document."id" = NEW."salesInvoiceId" AND document."organizationId" = NEW."organizationId" AND document."legalEntityId" = NEW."legalEntityId" AND document."documentType" = 'sales_invoice') THEN RAISE EXCEPTION 'dispatch invoice must be a same-company sales invoice'; END IF;
  END IF;
  IF TG_TABLE_NAME = 'ErpTdsRate' AND NOT EXISTS (SELECT 1 FROM "ErpTdsSection" section WHERE section."id" = NEW."sectionId" AND section."organizationId" = NEW."organizationId" AND section."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS rate section must belong to the same company'; END IF;
  IF TG_TABLE_NAME = 'ErpVendorTdsClassification' THEN
    IF NOT EXISTS (SELECT 1 FROM "ErpVendor" vendor WHERE vendor."id" = NEW."vendorId" AND vendor."organizationId" = NEW."organizationId" AND vendor."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS classification vendor must belong to the same company'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpTdsSection" section WHERE section."id" = NEW."sectionId" AND section."organizationId" = NEW."organizationId" AND section."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS classification section must belong to the same company'; END IF;
  END IF;
  IF TG_TABLE_NAME = 'ErpTdsDeduction' THEN
    IF NOT EXISTS (SELECT 1 FROM "FinancialYear" year WHERE year."id" = NEW."financialYearId" AND year."organizationId" = NEW."organizationId" AND year."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS deduction year must belong to the same company'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpVendor" vendor WHERE vendor."id" = NEW."vendorId" AND vendor."organizationId" = NEW."organizationId" AND vendor."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS deduction vendor must belong to the same company'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpTdsSection" section WHERE section."id" = NEW."sectionId" AND section."organizationId" = NEW."organizationId" AND section."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS deduction section must belong to the same company'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpTdsRate" rate WHERE rate."id" = NEW."rateId" AND rate."organizationId" = NEW."organizationId" AND rate."legalEntityId" = NEW."legalEntityId" AND rate."sectionId" = NEW."sectionId") THEN RAISE EXCEPTION 'TDS deduction rate must belong to its company section'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpVendorTdsClassification" classification WHERE classification."id" = NEW."vendorClassificationId" AND classification."organizationId" = NEW."organizationId" AND classification."legalEntityId" = NEW."legalEntityId" AND classification."vendorId" = NEW."vendorId" AND classification."sectionId" = NEW."sectionId") THEN RAISE EXCEPTION 'TDS deduction classification must match its vendor and section'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpVoucher" voucher WHERE voucher."id" = NEW."payableVoucherId" AND voucher."organizationId" = NEW."organizationId" AND voucher."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS payable voucher must belong to the same company'; END IF;
    IF NEW."paymentVoucherId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ErpVoucher" voucher WHERE voucher."id" = NEW."paymentVoucherId" AND voucher."organizationId" = NEW."organizationId" AND voucher."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS payment voucher must belong to the same company'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpHandoffInboxEvent_company_scope" BEFORE INSERT OR UPDATE ON "ErpHandoffInboxEvent" FOR EACH ROW EXECUTE FUNCTION enforce_erp_return_tds_company_scope();
CREATE TRIGGER "ErpPlantQaEvidence_company_scope" BEFORE INSERT OR UPDATE ON "ErpPlantQaEvidence" FOR EACH ROW EXECUTE FUNCTION enforce_erp_return_tds_company_scope();
CREATE TRIGGER "ErpPlantDispatchEvidence_company_scope" BEFORE INSERT OR UPDATE ON "ErpPlantDispatchEvidence" FOR EACH ROW EXECUTE FUNCTION enforce_erp_return_tds_company_scope();
CREATE TRIGGER "ErpTdsSection_company_scope" BEFORE INSERT OR UPDATE ON "ErpTdsSection" FOR EACH ROW EXECUTE FUNCTION enforce_erp_return_tds_company_scope();
CREATE TRIGGER "ErpTdsRate_company_scope" BEFORE INSERT OR UPDATE ON "ErpTdsRate" FOR EACH ROW EXECUTE FUNCTION enforce_erp_return_tds_company_scope();
CREATE TRIGGER "ErpVendorTdsClassification_company_scope" BEFORE INSERT OR UPDATE ON "ErpVendorTdsClassification" FOR EACH ROW EXECUTE FUNCTION enforce_erp_return_tds_company_scope();
CREATE TRIGGER "ErpTdsDeduction_company_scope" BEFORE INSERT OR UPDATE ON "ErpTdsDeduction" FOR EACH ROW EXECUTE FUNCTION enforce_erp_return_tds_company_scope();

CREATE OR REPLACE FUNCTION protect_erp_tds_evidence() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" <> 'draft' THEN RAISE EXCEPTION 'reviewed TDS evidence is immutable'; END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'approved' THEN RAISE EXCEPTION 'approved TDS evidence is immutable'; END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'ErpTdsDeduction' AND OLD."status" = 'submitted' AND (
    NEW."status" <> 'approved'
    OR ROW(NEW."organizationId",NEW."legalEntityId",NEW."financialYearId",NEW."vendorId",NEW."sectionId",NEW."rateId",NEW."vendorClassificationId",NEW."payableVoucherId",NEW."paymentVoucherId",NEW."businessDate",NEW."grossAmount",NEW."priorAggregateBase",NEW."taxableBase",NEW."appliedRate",NEW."deductionAmount",NEW."calculationSnapshot",NEW."evidenceHash",NEW."createdBy",NEW."submittedAt",NEW."createdAt")
       IS DISTINCT FROM
       ROW(OLD."organizationId",OLD."legalEntityId",OLD."financialYearId",OLD."vendorId",OLD."sectionId",OLD."rateId",OLD."vendorClassificationId",OLD."payableVoucherId",OLD."paymentVoucherId",OLD."businessDate",OLD."grossAmount",OLD."priorAggregateBase",OLD."taxableBase",OLD."appliedRate",OLD."deductionAmount",OLD."calculationSnapshot",OLD."evidenceHash",OLD."createdBy",OLD."submittedAt",OLD."createdAt")
  ) THEN RAISE EXCEPTION 'submitted TDS calculation evidence is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpTdsSection_immutable" BEFORE UPDATE OR DELETE ON "ErpTdsSection" FOR EACH ROW EXECUTE FUNCTION protect_erp_tds_evidence();
CREATE TRIGGER "ErpTdsRate_immutable" BEFORE UPDATE OR DELETE ON "ErpTdsRate" FOR EACH ROW EXECUTE FUNCTION protect_erp_tds_evidence();
CREATE TRIGGER "ErpVendorTdsClassification_immutable" BEFORE UPDATE OR DELETE ON "ErpVendorTdsClassification" FOR EACH ROW EXECUTE FUNCTION protect_erp_tds_evidence();
CREATE TRIGGER "ErpTdsDeduction_immutable" BEFORE UPDATE OR DELETE ON "ErpTdsDeduction" FOR EACH ROW EXECUTE FUNCTION protect_erp_tds_evidence();

INSERT INTO "Permission" ("id","serviceId","key","label","description","riskLevel") VALUES
  ('mesaerp.tds.manage','mesaerp','mesaerp.tds.manage','Manage TDS evidence','Maintain effective TDS masters, vendor classifications and deduction evidence.','high')
ON CONFLICT ("id") DO UPDATE SET "label" = EXCLUDED."label", "description" = EXCLUDED."description", "riskLevel" = EXCLUDED."riskLevel";

INSERT INTO "RolePermission" ("id","organizationId","roleId","permissionId","effect","createdAt")
SELECT 'tds-control-' || md5(role."id" || permission."id"), role."organizationId", role."id", permission."id", 'allow', CURRENT_TIMESTAMP
FROM "Role" role JOIN "Permission" permission ON permission."id" = 'mesaerp.tds.manage'
WHERE role."erpLegalEntityId" IS NOT NULL AND role."name" LIKE '% MesaERP Administrator'
ON CONFLICT ("organizationId","roleId","permissionId") DO NOTHING;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ErpHandoffMapping','ErpHandoffEventRoute','ErpHandoffInboxEvent','ErpPlantQaEvidence','ErpPlantDispatchEvidence',
    'ErpTdsSection','ErpTdsRate','ErpVendorTdsClassification','ErpTdsDeduction'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_tenant'', true)) WITH CHECK ("organizationId" = current_setting(''app.current_tenant'', true));', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO app_user;', table_name);
  END LOOP;
END $$;
