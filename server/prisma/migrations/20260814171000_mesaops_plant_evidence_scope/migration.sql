-- Additive plant ownership for evidence rows that previously carried only the
-- group tenant. Historical records remain in PRIMARY and are never reset.
ALTER TABLE "QualityInspection" ADD COLUMN IF NOT EXISTS "plantCode" TEXT NOT NULL DEFAULT 'PRIMARY';
ALTER TABLE "InventoryTransaction" ADD COLUMN IF NOT EXISTS "plantCode" TEXT NOT NULL DEFAULT 'PRIMARY';

CREATE INDEX IF NOT EXISTS "QualityInspection_organizationId_plantCode_createdAt_idx"
  ON "QualityInspection"("organizationId", "plantCode", "createdAt");
CREATE INDEX IF NOT EXISTS "InventoryTransaction_organizationId_plantCode_createdAt_idx"
  ON "InventoryTransaction"("organizationId", "plantCode", "createdAt");
