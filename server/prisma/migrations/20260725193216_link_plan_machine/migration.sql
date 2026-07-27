-- CreateIndex
CREATE INDEX "ProductionPlan_machineId_idx" ON "ProductionPlan"("machineId");

-- AddForeignKey
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
