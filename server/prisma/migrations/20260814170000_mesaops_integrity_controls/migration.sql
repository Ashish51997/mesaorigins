-- Additive MesaOps integrity controls. Existing rows remain available in the
-- PRIMARY plant and historical dispatch quantities are backfilled from their
-- operational orders before the new NOT NULL evidence fields are enforced.

ALTER TABLE "Machine" ADD COLUMN IF NOT EXISTS "plantCode" TEXT NOT NULL DEFAULT 'PRIMARY';
ALTER TABLE "OperationalOrder" ADD COLUMN IF NOT EXISTS "plantCode" TEXT NOT NULL DEFAULT 'PRIMARY';

ALTER TABLE "DispatchRecord" ADD COLUMN IF NOT EXISTS "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "DispatchRecord" ADD COLUMN IF NOT EXISTS "uom" TEXT NOT NULL DEFAULT 'units';
ALTER TABLE "DispatchRecord" ADD COLUMN IF NOT EXISTS "evidenceSnapshot" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "DispatchRecord" ADD COLUMN IF NOT EXISTS "evidenceHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DispatchRecord" ADD COLUMN IF NOT EXISTS "statutoryProfileVersion" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DispatchRecord" ADD COLUMN IF NOT EXISTS "statutoryEvidenceHash" TEXT NOT NULL DEFAULT '';

UPDATE "DispatchRecord" d
SET "quantity" = o."quantity", "uom" = o."uom"
FROM "OperationalOrder" o
WHERE d."operationalOrderId" = o."id" AND d."quantity" = 0;

CREATE INDEX IF NOT EXISTS "Machine_organizationId_plantCode_idx" ON "Machine"("organizationId", "plantCode");
CREATE INDEX IF NOT EXISTS "OperationalOrder_organizationId_plantCode_status_idx" ON "OperationalOrder"("organizationId", "plantCode", "status");

CREATE TABLE "MesaOpsIdempotencyRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MesaOpsIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MesaOpsIdempotencyRecord_organizationId_scope_key_key"
  ON "MesaOpsIdempotencyRecord"("organizationId", "scope", "key");
CREATE INDEX "MesaOpsIdempotencyRecord_organizationId_createdAt_idx"
  ON "MesaOpsIdempotencyRecord"("organizationId", "createdAt");
ALTER TABLE "MesaOpsIdempotencyRecord" ADD CONSTRAINT "MesaOpsIdempotencyRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MesaOpsIdempotencyRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MesaOpsIdempotencyRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MesaOpsIdempotencyRecord"
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- Serialize and recheck all new schedule writes at the database boundary. This
-- protects imports and future workers as well as the HTTP service.
CREATE OR REPLACE FUNCTION guard_mesaops_plan_schedule() RETURNS trigger AS $$
DECLARE
  order_quantity DECIMAL(18,6);
  other_planned DECIMAL(18,6);
  order_plant TEXT;
  machine_plant TEXT;
  schedule_key TEXT;
BEGIN
  SELECT "quantity", "plantCode" INTO order_quantity, order_plant
  FROM "OperationalOrder" WHERE "id" = NEW."operationalOrderId" FOR UPDATE;
  IF order_quantity IS NULL THEN
    RAISE EXCEPTION 'operational order does not exist';
  END IF;

  SELECT "plantCode" INTO machine_plant FROM "Machine" WHERE "id" = NEW."machineId";
  IF machine_plant IS NULL OR machine_plant <> order_plant THEN
    RAISE EXCEPTION 'production plan machine and operational order must belong to the same plant';
  END IF;

  SELECT COALESCE(SUM("plannedQuantity"), 0) INTO other_planned
  FROM "ProductionPlan"
  WHERE "operationalOrderId" = NEW."operationalOrderId" AND "id" <> NEW."id";
  IF other_planned + NEW."plannedQuantity" > order_quantity THEN
    RAISE EXCEPTION 'production plan quantity exceeds operational order quantity';
  END IF;

  IF NEW."status" = 'scheduled' AND length(NEW."scheduledStartDate") >= 10 THEN
    schedule_key := NEW."organizationId" || ':' || NEW."machineId" || ':' || NEW."shift" || ':' || substring(NEW."scheduledStartDate" from 1 for 10);
    PERFORM pg_advisory_xact_lock(hashtextextended(schedule_key, 0));
    IF EXISTS (
      SELECT 1 FROM "ProductionPlan" p
      WHERE p."organizationId" = NEW."organizationId"
        AND p."machineId" = NEW."machineId"
        AND p."shift" = NEW."shift"
        AND p."status" = 'scheduled'
        AND substring(p."scheduledStartDate" from 1 for 10) = substring(NEW."scheduledStartDate" from 1 for 10)
        AND p."id" <> NEW."id"
    ) THEN
      RAISE EXCEPTION 'machine shift is already scheduled for this business date' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ProductionPlan_guard_schedule" ON "ProductionPlan";
CREATE TRIGGER "ProductionPlan_guard_schedule"
BEFORE INSERT OR UPDATE OF "operationalOrderId", "machineId", "plannedQuantity", "shift", "scheduledStartDate", "status"
ON "ProductionPlan" FOR EACH ROW EXECUTE FUNCTION guard_mesaops_plan_schedule();

ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_quantity_positive" CHECK ("quantity" > 0) NOT VALID;
ALTER TABLE "DispatchRecord" VALIDATE CONSTRAINT "DispatchRecord_quantity_positive";
