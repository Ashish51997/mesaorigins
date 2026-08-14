-- MesaERP valued inventory and source-posting controls. All changes are
-- additive: existing item, warehouse, voucher and movement rows remain valid.
ALTER TABLE "ErpItem"
  ADD COLUMN "createIdempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT NOT NULL DEFAULT '';

ALTER TABLE "ErpWarehouse"
  ADD COLUMN "createIdempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX "ErpItem_create_idempotency_key"
ON "ErpItem"("organizationId", "legalEntityId", "createIdempotencyKey");
CREATE UNIQUE INDEX "ErpWarehouse_create_idempotency_key"
ON "ErpWarehouse"("organizationId", "legalEntityId", "createIdempotencyKey");

CREATE TABLE "ErpValuationLayer" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "receiptMovementId" TEXT NOT NULL,
  "batchNumber" TEXT NOT NULL DEFAULT '',
  "serialNumber" TEXT NOT NULL DEFAULT '',
  "expiryDate" DATE,
  "quantity" DECIMAL(18,6) NOT NULL,
  "unitCost" DECIMAL(18,6) NOT NULL,
  "value" DECIMAL(18,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpValuationLayer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpValuationLayer_values_check" CHECK ("quantity" > 0 AND "unitCost" >= 0 AND "value" >= 0)
);

CREATE TABLE "ErpValuationConsumption" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "valuationLayerId" TEXT NOT NULL,
  "issueMovementId" TEXT NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "value" DECIMAL(18,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpValuationConsumption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpValuationConsumption_values_check" CHECK ("quantity" > 0 AND "value" >= 0)
);

CREATE TABLE "ErpInventoryCount" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "financialYearId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "voucherId" TEXT,
  "countNumber" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'recorded',
  "lines" JSONB NOT NULL DEFAULT '[]',
  "sourceSnapshotHash" TEXT NOT NULL,
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpInventoryCount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpInventoryCount_status_check" CHECK ("status" IN ('recorded', 'adjustment_pending', 'reconciled')),
  CONSTRAINT "ErpInventoryCount_hash_check" CHECK ("sourceSnapshotHash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "ErpPostingLink" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "mappingSnapshot" JSONB NOT NULL,
  "sourceSnapshotHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpPostingLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpPostingLink_hash_check" CHECK ("sourceSnapshotHash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "ErpValuationLayer_receiptMovementId_key" ON "ErpValuationLayer"("receiptMovementId");
CREATE INDEX "ErpValuationLayer_organizationId_idx" ON "ErpValuationLayer"("organizationId");
CREATE INDEX "ErpValuationLayer_lookup_idx" ON "ErpValuationLayer"("legalEntityId", "itemId", "warehouseId", "createdAt");
CREATE INDEX "ErpValuationLayer_trace_idx" ON "ErpValuationLayer"("batchNumber", "serialNumber");
CREATE UNIQUE INDEX "ErpValuationConsumption_identity_key"
ON "ErpValuationConsumption"("organizationId", "valuationLayerId", "issueMovementId");
CREATE INDEX "ErpValuationConsumption_organizationId_idx" ON "ErpValuationConsumption"("organizationId");
CREATE INDEX "ErpValuationConsumption_issue_idx" ON "ErpValuationConsumption"("legalEntityId", "issueMovementId");
CREATE UNIQUE INDEX "ErpInventoryCount_voucherId_key" ON "ErpInventoryCount"("voucherId");
CREATE UNIQUE INDEX "ErpInventoryCount_number_key"
ON "ErpInventoryCount"("organizationId", "legalEntityId", "financialYearId", "countNumber");
CREATE UNIQUE INDEX "ErpInventoryCount_idempotency_key"
ON "ErpInventoryCount"("organizationId", "legalEntityId", "createIdempotencyKey");
CREATE INDEX "ErpInventoryCount_organizationId_idx" ON "ErpInventoryCount"("organizationId");
CREATE INDEX "ErpInventoryCount_lookup_idx" ON "ErpInventoryCount"("legalEntityId", "warehouseId", "businessDate");
CREATE UNIQUE INDEX "ErpPostingLink_source_key"
ON "ErpPostingLink"("organizationId", "legalEntityId", "sourceType", "sourceId");
CREATE UNIQUE INDEX "ErpPostingLink_voucher_key" ON "ErpPostingLink"("organizationId", "voucherId");
CREATE INDEX "ErpPostingLink_organizationId_idx" ON "ErpPostingLink"("organizationId");
CREATE INDEX "ErpPostingLink_lookup_idx" ON "ErpPostingLink"("legalEntityId", "sourceType", "sourceId");

ALTER TABLE "ErpValuationLayer" ADD CONSTRAINT "ErpValuationLayer_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpValuationLayer" ADD CONSTRAINT "ErpValuationLayer_legalEntityId_fkey"
FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpValuationLayer" ADD CONSTRAINT "ErpValuationLayer_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "ErpItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpValuationLayer" ADD CONSTRAINT "ErpValuationLayer_warehouseId_fkey"
FOREIGN KEY ("warehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpValuationLayer" ADD CONSTRAINT "ErpValuationLayer_receiptMovementId_fkey"
FOREIGN KEY ("receiptMovementId") REFERENCES "ErpStockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ErpValuationConsumption" ADD CONSTRAINT "ErpValuationConsumption_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpValuationConsumption" ADD CONSTRAINT "ErpValuationConsumption_legalEntityId_fkey"
FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpValuationConsumption" ADD CONSTRAINT "ErpValuationConsumption_layerId_fkey"
FOREIGN KEY ("valuationLayerId") REFERENCES "ErpValuationLayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpValuationConsumption" ADD CONSTRAINT "ErpValuationConsumption_issueMovementId_fkey"
FOREIGN KEY ("issueMovementId") REFERENCES "ErpStockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ErpInventoryCount" ADD CONSTRAINT "ErpInventoryCount_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpInventoryCount" ADD CONSTRAINT "ErpInventoryCount_legalEntityId_fkey"
FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpInventoryCount" ADD CONSTRAINT "ErpInventoryCount_financialYearId_fkey"
FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpInventoryCount" ADD CONSTRAINT "ErpInventoryCount_warehouseId_fkey"
FOREIGN KEY ("warehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpInventoryCount" ADD CONSTRAINT "ErpInventoryCount_voucherId_fkey"
FOREIGN KEY ("voucherId") REFERENCES "ErpVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ErpPostingLink" ADD CONSTRAINT "ErpPostingLink_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPostingLink" ADD CONSTRAINT "ErpPostingLink_legalEntityId_fkey"
FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPostingLink" ADD CONSTRAINT "ErpPostingLink_voucherId_fkey"
FOREIGN KEY ("voucherId") REFERENCES "ErpVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing companies receive a GRNI clearing ledger used by the standard
-- GRN-to-supplier-invoice mapping. New companies receive it from application provisioning.
INSERT INTO "ErpAccount" (
  "id", "organizationId", "legalEntityId", "code", "name", "accountType", "currency",
  "allowPosting", "reconciliationRequired", "active", "rowVersion", "createdAt", "updatedAt"
)
SELECT
  'erp-acct-grni-' || substr(md5(entity."id"), 1, 20), entity."organizationId", entity."id",
  '2010', 'Goods received not invoiced', 'liability', entity."baseCurrency",
  true, true, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "LegalEntity" entity
ON CONFLICT ("organizationId", "legalEntityId", "code") DO NOTHING;

CREATE OR REPLACE FUNCTION protect_erp_inventory_evidence() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only inventory evidence', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpStockMovement_append_only"
BEFORE UPDATE OR DELETE ON "ErpStockMovement"
FOR EACH ROW EXECUTE FUNCTION protect_erp_inventory_evidence();
CREATE TRIGGER "ErpValuationLayer_append_only"
BEFORE UPDATE OR DELETE ON "ErpValuationLayer"
FOR EACH ROW EXECUTE FUNCTION protect_erp_inventory_evidence();
CREATE TRIGGER "ErpValuationConsumption_append_only"
BEFORE UPDATE OR DELETE ON "ErpValuationConsumption"
FOR EACH ROW EXECUTE FUNCTION protect_erp_inventory_evidence();
CREATE TRIGGER "ErpInventoryCount_append_only"
BEFORE UPDATE OR DELETE ON "ErpInventoryCount"
FOR EACH ROW EXECUTE FUNCTION protect_erp_inventory_evidence();
CREATE TRIGGER "ErpPostingLink_append_only"
BEFORE UPDATE OR DELETE ON "ErpPostingLink"
FOR EACH ROW EXECUTE FUNCTION protect_erp_inventory_evidence();

CREATE OR REPLACE FUNCTION lock_erp_item_valuation_method() RETURNS trigger AS $$
BEGIN
  IF NEW."valuationMethod" IS DISTINCT FROM OLD."valuationMethod"
     AND EXISTS (SELECT 1 FROM "ErpStockMovement" movement WHERE movement."itemId" = OLD."id") THEN
    RAISE EXCEPTION 'item valuation method is fixed after the first stock transaction';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpItem_lock_valuation_method"
BEFORE UPDATE OF "valuationMethod" ON "ErpItem"
FOR EACH ROW EXECUTE FUNCTION lock_erp_item_valuation_method();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ErpValuationLayer', 'ErpValuationConsumption', 'ErpInventoryCount', 'ErpPostingLink'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_tenant'', true)) WITH CHECK ("organizationId" = current_setting(''app.current_tenant'', true));',
      table_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO app_user;', table_name);
  END LOOP;
END $$;
