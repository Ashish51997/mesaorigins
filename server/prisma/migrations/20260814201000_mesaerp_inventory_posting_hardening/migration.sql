-- Follow-up hardening kept separate because the valued-inventory foundation
-- was already deployed by a concurrent clean-DB verification run.
DROP TRIGGER "ErpInventoryCount_append_only" ON "ErpInventoryCount";

CREATE OR REPLACE FUNCTION protect_erp_inventory_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."voucherId" IS NULL AND NEW."voucherId" IS NOT NULL
     AND ROW(
       NEW."organizationId", NEW."legalEntityId", NEW."financialYearId", NEW."warehouseId",
       NEW."countNumber", NEW."businessDate", NEW."status", NEW."lines", NEW."sourceSnapshotHash",
       NEW."createIdempotencyKey", NEW."requestHash", NEW."createdBy", NEW."rowVersion", NEW."createdAt"
     ) IS NOT DISTINCT FROM ROW(
       OLD."organizationId", OLD."legalEntityId", OLD."financialYearId", OLD."warehouseId",
       OLD."countNumber", OLD."businessDate", OLD."status", OLD."lines", OLD."sourceSnapshotHash",
       OLD."createIdempotencyKey", OLD."requestHash", OLD."createdBy", OLD."rowVersion", OLD."createdAt"
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'physical-count evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpInventoryCount_append_only"
BEFORE UPDATE OR DELETE ON "ErpInventoryCount"
FOR EACH ROW EXECUTE FUNCTION protect_erp_inventory_count();

CREATE OR REPLACE FUNCTION lock_erp_item_valuation_method() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW."itemType", NEW."baseUom", NEW."valuationMethod", NEW."batchTracked", NEW."serialTracked", NEW."expiryTracked")
     IS DISTINCT FROM ROW(OLD."itemType", OLD."baseUom", OLD."valuationMethod", OLD."batchTracked", OLD."serialTracked", OLD."expiryTracked")
     AND EXISTS (SELECT 1 FROM "ErpStockMovement" movement WHERE movement."itemId" = OLD."id") THEN
    RAISE EXCEPTION 'item stock and valuation policies are fixed after the first stock transaction';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "ErpItem_lock_valuation_method" ON "ErpItem";
CREATE TRIGGER "ErpItem_lock_valuation_method"
BEFORE UPDATE OF "itemType", "baseUom", "valuationMethod", "batchTracked", "serialTracked", "expiryTracked" ON "ErpItem"
FOR EACH ROW EXECUTE FUNCTION lock_erp_item_valuation_method();

UPDATE "ErpWarehouse" SET "allowNegative" = false WHERE "allowNegative" = true;
ALTER TABLE "ErpWarehouse" ADD CONSTRAINT "ErpWarehouse_negative_stock_disabled" CHECK ("allowNegative" = false);

CREATE OR REPLACE FUNCTION protect_source_posting_voucher() RETURNS trigger AS $$
BEGIN
  IF OLD."originType" = 'source_posting'
     AND EXISTS (SELECT 1 FROM "ErpPostingLink" link WHERE link."voucherId" = OLD."id")
     AND ROW(
       NEW."organizationId", NEW."legalEntityId", NEW."financialYearId", NEW."accountingPeriodId",
       NEW."voucherType", NEW."businessDate", NEW."currency", NEW."exchangeRate",
       NEW."transactionDebit", NEW."transactionCredit", NEW."baseDebit", NEW."baseCredit",
       NEW."reference", NEW."narration", NEW."sourceDocumentId", NEW."dimensions",
       NEW."originType", NEW."originMetadata", NEW."requestHash", NEW."createdBy"
     ) IS DISTINCT FROM ROW(
       OLD."organizationId", OLD."legalEntityId", OLD."financialYearId", OLD."accountingPeriodId",
       OLD."voucherType", OLD."businessDate", OLD."currency", OLD."exchangeRate",
       OLD."transactionDebit", OLD."transactionCredit", OLD."baseDebit", OLD."baseCredit",
       OLD."reference", OLD."narration", OLD."sourceDocumentId", OLD."dimensions",
       OLD."originType", OLD."originMetadata", OLD."requestHash", OLD."createdBy"
     ) THEN
    RAISE EXCEPTION 'source-generated voucher mapping is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpVoucher_protect_source_mapping"
BEFORE UPDATE ON "ErpVoucher"
FOR EACH ROW EXECUTE FUNCTION protect_source_posting_voucher();

CREATE OR REPLACE FUNCTION protect_source_posting_voucher_line() RETURNS trigger AS $$
DECLARE source_voucher_id TEXT;
BEGIN
  source_voucher_id := COALESCE(NEW."voucherId", OLD."voucherId");
  IF EXISTS (
    SELECT 1 FROM "ErpVoucher" voucher
    JOIN "ErpPostingLink" link ON link."voucherId" = voucher."id"
    WHERE voucher."id" = source_voucher_id AND voucher."originType" = 'source_posting'
  ) THEN
    RAISE EXCEPTION 'source-generated voucher lines are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpVoucherLine_protect_source_mapping"
BEFORE INSERT OR UPDATE OR DELETE ON "ErpVoucherLine"
FOR EACH ROW EXECUTE FUNCTION protect_source_posting_voucher_line();
