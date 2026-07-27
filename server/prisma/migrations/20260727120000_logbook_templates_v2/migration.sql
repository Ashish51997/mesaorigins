-- Logbook template layout families (pipe/coil) + plan → template selection.
ALTER TABLE "LogbookTemplate" ADD COLUMN "layout" TEXT NOT NULL DEFAULT 'coil';
ALTER TABLE "LogbookTemplate" ADD COLUMN "hardnessType" TEXT NOT NULL DEFAULT 'A';
ALTER TABLE "LogbookTemplate" ADD COLUMN "productionUnit" TEXT NOT NULL DEFAULT 'roll';
ALTER TABLE "LogbookTemplate" ADD COLUMN "packingNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LogbookTemplate" ADD COLUMN "pipeSpecs" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ProductionPlan" ADD COLUMN "logbookTemplateId" TEXT;
CREATE INDEX "ProductionPlan_logbookTemplateId_idx" ON "ProductionPlan"("logbookTemplateId");
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_logbookTemplateId_fkey" FOREIGN KEY ("logbookTemplateId") REFERENCES "LogbookTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
