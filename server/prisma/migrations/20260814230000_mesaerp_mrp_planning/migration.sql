-- MesaERP company-scoped planning, ATP and MRP. Additive only: no existing
-- operational, inventory or accounting evidence is rewritten.

ALTER TABLE "ErpItem"
  ADD COLUMN "planningLeadTimeDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "planningSafetyStock" DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN "planningMinimumStock" DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN "planningMaximumStock" DECIMAL(18,6),
  ADD COLUMN "planningLotSizing" TEXT NOT NULL DEFAULT 'lot_for_lot',
  ADD COLUMN "planningFixedLotSize" DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN "planningMinimumOrder" DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN "planningOrderMultiple" DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN "planningSupplyPolicy" TEXT NOT NULL DEFAULT 'buy',
  ADD COLUMN "planningWarehouseId" TEXT,
  ADD COLUMN "transferSourceWarehouseId" TEXT,
  ADD COLUMN "planningPreferredVendorId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "planningPolicyUpdatedAt" TIMESTAMP(3);

ALTER TABLE "ErpItem" ADD CONSTRAINT "ErpItem_planning_values_check" CHECK (
  "planningLeadTimeDays" >= 0 AND "planningSafetyStock" >= 0 AND "planningMinimumStock" >= 0
  AND ("planningMaximumStock" IS NULL OR "planningMaximumStock" >= "planningMinimumStock")
  AND "planningFixedLotSize" >= 0 AND "planningMinimumOrder" >= 0 AND "planningOrderMultiple" >= 0
  AND ("planningLotSizing" <> 'fixed' OR "planningFixedLotSize" > 0)
  AND ("planningLotSizing" <> 'min_max' OR "planningMaximumStock" IS NOT NULL)
);
ALTER TABLE "ErpItem" ADD CONSTRAINT "ErpItem_planning_lot_sizing_check" CHECK ("planningLotSizing" IN ('lot_for_lot','fixed','min_max'));
ALTER TABLE "ErpItem" ADD CONSTRAINT "ErpItem_planning_supply_policy_check" CHECK ("planningSupplyPolicy" IN ('make','buy','transfer'));
ALTER TABLE "ErpItem" ADD CONSTRAINT "ErpItem_planning_transfer_check" CHECK (
  ("planningSupplyPolicy" <> 'transfer' OR "transferSourceWarehouseId" IS NOT NULL)
  AND ("transferSourceWarehouseId" IS NULL OR "transferSourceWarehouseId" <> "planningWarehouseId")
);
ALTER TABLE "ErpItem" ADD CONSTRAINT "ErpItem_planning_warehouse_fkey" FOREIGN KEY ("planningWarehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpItem" ADD CONSTRAINT "ErpItem_transfer_source_warehouse_fkey" FOREIGN KEY ("transferSourceWarehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ErpItem_planning_policy_idx" ON "ErpItem"("legalEntityId", "planningSupplyPolicy", "planningWarehouseId");

CREATE TABLE "ErpPlanningBom" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "bomCode" TEXT NOT NULL,
  "parentItemId" TEXT NOT NULL,
  "bomType" TEXT NOT NULL DEFAULT 'discrete',
  "description" TEXT NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpPlanningBom_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpPlanningBom_type_check" CHECK ("bomType" IN ('discrete','formula')),
  CONSTRAINT "ErpPlanningBom_version_check" CHECK ("rowVersion" >= 0)
);

CREATE TABLE "ErpPlanningBomRevision" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "bomId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "revisionCode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "outputQuantity" DECIMAL(18,6) NOT NULL,
  "outputUom" TEXT NOT NULL,
  "yieldPercentage" DECIMAL(7,4) NOT NULL DEFAULT 100,
  "notes" TEXT NOT NULL DEFAULT '',
  "formulaParameters" JSONB NOT NULL DEFAULT '{}',
  "sourceSnapshotHash" TEXT NOT NULL DEFAULT '',
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "approvedBy" TEXT NOT NULL DEFAULT '',
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpPlanningBomRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpPlanningBomRevision_status_check" CHECK ("status" IN ('draft','submitted','approved')),
  CONSTRAINT "ErpPlanningBomRevision_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  CONSTRAINT "ErpPlanningBomRevision_values_check" CHECK ("revisionNumber" > 0 AND "outputQuantity" > 0 AND "yieldPercentage" > 0 AND "yieldPercentage" <= 100 AND "rowVersion" >= 0),
  CONSTRAINT "ErpPlanningBomRevision_approval_check" CHECK (
    ("status" = 'draft') OR
    ("status" = 'submitted' AND "submittedAt" IS NOT NULL) OR
    ("status" = 'approved' AND "submittedAt" IS NOT NULL AND "approvedAt" IS NOT NULL AND length("approvedBy") > 0 AND "approvedBy" <> "createdBy" AND "sourceSnapshotHash" ~ '^[a-f0-9]{64}$')
  )
);

CREATE TABLE "ErpPlanningBomComponent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "componentItemId" TEXT NOT NULL,
  "issueWarehouseId" TEXT,
  "quantity" DECIMAL(18,6) NOT NULL,
  "uom" TEXT NOT NULL,
  "scrapPercentage" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "componentType" TEXT NOT NULL DEFAULT 'material',
  "phase" TEXT NOT NULL DEFAULT '',
  "dimensions" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpPlanningBomComponent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpPlanningBomComponent_values_check" CHECK ("lineNumber" > 0 AND "quantity" > 0 AND "scrapPercentage" >= 0 AND "scrapPercentage" <= 100),
  CONSTRAINT "ErpPlanningBomComponent_type_check" CHECK ("componentType" IN ('material','packaging'))
);

CREATE TABLE "ErpDemandForecast" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "financialYearId" TEXT NOT NULL,
  "forecastNumber" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "forecastDate" DATE NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "uom" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "notes" TEXT NOT NULL DEFAULT '',
  "sourceSnapshotHash" TEXT NOT NULL DEFAULT '',
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "approvedBy" TEXT NOT NULL DEFAULT '',
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpDemandForecast_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpDemandForecast_status_check" CHECK ("status" IN ('draft','submitted','approved','cancelled')),
  CONSTRAINT "ErpDemandForecast_values_check" CHECK ("quantity" > 0 AND "rowVersion" >= 0),
  CONSTRAINT "ErpDemandForecast_approval_check" CHECK (
    "status" IN ('draft','cancelled') OR
    ("status" = 'submitted' AND "submittedAt" IS NOT NULL) OR
    ("status" = 'approved' AND "submittedAt" IS NOT NULL AND "approvedAt" IS NOT NULL AND length("approvedBy") > 0 AND "approvedBy" <> "createdBy" AND "sourceSnapshotHash" ~ '^[a-f0-9]{64}$')
  )
);

CREATE TABLE "ErpStockReservation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "reservationNumber" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "uom" TEXT NOT NULL,
  "batchNumber" TEXT NOT NULL DEFAULT '',
  "serialNumber" TEXT NOT NULL DEFAULT '',
  "sourceType" TEXT NOT NULL DEFAULT 'manual',
  "sourceId" TEXT NOT NULL DEFAULT '',
  "sourceLineId" TEXT NOT NULL DEFAULT '',
  "requiredOn" DATE,
  "status" TEXT NOT NULL DEFAULT 'active',
  "sourceSnapshotHash" TEXT NOT NULL,
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "releasedBy" TEXT NOT NULL DEFAULT '',
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpStockReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpStockReservation_values_check" CHECK ("quantity" > 0 AND "rowVersion" >= 0 AND "sourceSnapshotHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ErpStockReservation_source_check" CHECK (
    ("sourceType" = 'manual' AND "sourceId" = '' AND "sourceLineId" = '') OR
    ("sourceType" = 'production_demand' AND length("sourceId") > 0 AND "sourceLineId" = '') OR
    ("sourceType" = 'sales_order' AND length("sourceId") > 0 AND length("sourceLineId") > 0)
  ),
  CONSTRAINT "ErpStockReservation_status_check" CHECK ("status" IN ('active','released','consumed','cancelled'))
);

CREATE TABLE "ErpMrpRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "financialYearId" TEXT NOT NULL,
  "runNumber" TEXT NOT NULL,
  "asOfDate" DATE NOT NULL,
  "horizonEnd" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'calculated',
  "parameters" JSONB NOT NULL,
  "demandSnapshot" JSONB NOT NULL,
  "supplySnapshot" JSONB NOT NULL,
  "sourceSnapshotHash" TEXT NOT NULL,
  "resultSnapshot" JSONB NOT NULL,
  "resultSnapshotHash" TEXT NOT NULL,
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpMrpRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpMrpRun_dates_check" CHECK ("horizonEnd" >= "asOfDate"),
  CONSTRAINT "ErpMrpRun_status_check" CHECK ("status" IN ('calculated','stale')),
  CONSTRAINT "ErpMrpRun_hashes_check" CHECK ("sourceSnapshotHash" ~ '^[a-f0-9]{64}$' AND "resultSnapshotHash" ~ '^[a-f0-9]{64}$' AND "rowVersion" >= 0)
);

CREATE TABLE "ErpMrpRequirement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "mrpRunId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "bomRevisionId" TEXT,
  "level" INTEGER NOT NULL DEFAULT 0,
  "requiredOn" DATE NOT NULL,
  "grossRequirement" DECIMAL(18,6) NOT NULL,
  "includedReservation" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "onHandQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "externalReservation" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "openPurchaseSupply" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "openProductionSupply" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "safetyStock" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "netRequirement" DECIMAL(18,6) NOT NULL,
  "sourceRefs" JSONB NOT NULL,
  "calculationSnapshot" JSONB NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpMrpRequirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpMrpRequirement_values_check" CHECK (
    "level" >= 0 AND "grossRequirement" >= 0 AND "includedReservation" >= 0 AND "onHandQuantity" >= 0
    AND "externalReservation" >= 0 AND "openPurchaseSupply" >= 0 AND "openProductionSupply" >= 0
    AND "safetyStock" >= 0 AND "netRequirement" >= 0 AND "snapshotHash" ~ '^[a-f0-9]{64}$'
  )
);

CREATE TABLE "ErpMrpSuggestion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "mrpRunId" TEXT NOT NULL,
  "requirementId" TEXT NOT NULL,
  "suggestionType" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "sourceWarehouseId" TEXT,
  "quantity" DECIMAL(18,6) NOT NULL,
  "uom" TEXT NOT NULL,
  "orderOn" DATE NOT NULL,
  "requiredOn" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "planningSnapshot" JSONB NOT NULL,
  "sourceSnapshotHash" TEXT NOT NULL,
  "releasedResourceType" TEXT NOT NULL DEFAULT '',
  "releasedResourceId" TEXT NOT NULL DEFAULT '',
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "approvedBy" TEXT NOT NULL DEFAULT '',
  "approvedAt" TIMESTAMP(3),
  "releasedBy" TEXT NOT NULL DEFAULT '',
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpMrpSuggestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpMrpSuggestion_type_check" CHECK ("suggestionType" IN ('make','purchase','transfer')),
  CONSTRAINT "ErpMrpSuggestion_status_check" CHECK ("status" IN ('draft','submitted','approved','released','cancelled')),
  CONSTRAINT "ErpMrpSuggestion_values_check" CHECK ("quantity" > 0 AND "orderOn" <= "requiredOn" AND "rowVersion" >= 0 AND "sourceSnapshotHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ErpMrpSuggestion_transfer_check" CHECK (("suggestionType" = 'transfer' AND "sourceWarehouseId" IS NOT NULL AND "sourceWarehouseId" <> "warehouseId") OR ("suggestionType" <> 'transfer' AND "sourceWarehouseId" IS NULL)),
  CONSTRAINT "ErpMrpSuggestion_approval_check" CHECK (
    "status" = 'draft' OR
    ("status" = 'submitted' AND "submittedAt" IS NOT NULL) OR
    ("status" = 'approved' AND "submittedAt" IS NOT NULL AND "approvedAt" IS NOT NULL AND length("approvedBy") > 0 AND "approvedBy" <> "createdBy") OR
    ("status" = 'released' AND "submittedAt" IS NOT NULL AND "approvedAt" IS NOT NULL AND length("approvedBy") > 0 AND "approvedBy" <> "createdBy") OR
    "status" = 'cancelled'
  ),
  CONSTRAINT "ErpMrpSuggestion_release_check" CHECK (
    ("status" <> 'released' AND "releasedResourceType" = '' AND "releasedResourceId" = '') OR
    ("status" = 'released' AND length("releasedBy") > 0 AND "releasedAt" IS NOT NULL AND length("releasedResourceType") > 0 AND length("releasedResourceId") > 0)
  )
);

CREATE TABLE "ErpTransferProposal" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "suggestionId" TEXT NOT NULL,
  "proposalNumber" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "fromWarehouseId" TEXT NOT NULL,
  "toWarehouseId" TEXT NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "uom" TEXT NOT NULL,
  "requiredOn" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sourceSnapshotHash" TEXT NOT NULL,
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpTransferProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpTransferProposal_values_check" CHECK ("quantity" > 0 AND "fromWarehouseId" <> "toWarehouseId" AND "rowVersion" >= 0 AND "sourceSnapshotHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ErpTransferProposal_status_check" CHECK ("status" IN ('draft','submitted','approved','released','cancelled'))
);

CREATE UNIQUE INDEX "ErpPlanningBom_number_key" ON "ErpPlanningBom"("organizationId","legalEntityId","bomCode");
CREATE UNIQUE INDEX "ErpPlanningBom_idempotency_key" ON "ErpPlanningBom"("organizationId","legalEntityId","createIdempotencyKey");
CREATE UNIQUE INDEX "ErpPlanningBom_one_active_item" ON "ErpPlanningBom"("organizationId","legalEntityId","parentItemId") WHERE "active";
CREATE INDEX "ErpPlanningBom_org_idx" ON "ErpPlanningBom"("organizationId");
CREATE INDEX "ErpPlanningBom_item_idx" ON "ErpPlanningBom"("legalEntityId","parentItemId","active");
CREATE UNIQUE INDEX "ErpPlanningBomRevision_number_key" ON "ErpPlanningBomRevision"("organizationId","bomId","revisionNumber");
CREATE UNIQUE INDEX "ErpPlanningBomRevision_code_key" ON "ErpPlanningBomRevision"("organizationId","legalEntityId","bomId","revisionCode");
CREATE UNIQUE INDEX "ErpPlanningBomRevision_idempotency_key" ON "ErpPlanningBomRevision"("organizationId","legalEntityId","createIdempotencyKey");
CREATE INDEX "ErpPlanningBomRevision_org_idx" ON "ErpPlanningBomRevision"("organizationId");
CREATE INDEX "ErpPlanningBomRevision_status_idx" ON "ErpPlanningBomRevision"("legalEntityId","bomId","status","effectiveFrom");
CREATE UNIQUE INDEX "ErpPlanningBomComponent_line_key" ON "ErpPlanningBomComponent"("organizationId","revisionId","lineNumber");
CREATE UNIQUE INDEX "ErpPlanningBomComponent_item_key" ON "ErpPlanningBomComponent"("organizationId","revisionId","componentItemId");
CREATE INDEX "ErpPlanningBomComponent_org_idx" ON "ErpPlanningBomComponent"("organizationId");
CREATE INDEX "ErpPlanningBomComponent_item_idx" ON "ErpPlanningBomComponent"("legalEntityId","componentItemId");
CREATE UNIQUE INDEX "ErpDemandForecast_number_key" ON "ErpDemandForecast"("organizationId","legalEntityId","financialYearId","forecastNumber");
CREATE UNIQUE INDEX "ErpDemandForecast_idempotency_key" ON "ErpDemandForecast"("organizationId","legalEntityId","createIdempotencyKey");
CREATE INDEX "ErpDemandForecast_org_idx" ON "ErpDemandForecast"("organizationId");
CREATE INDEX "ErpDemandForecast_date_idx" ON "ErpDemandForecast"("legalEntityId","status","forecastDate");
CREATE UNIQUE INDEX "ErpStockReservation_number_key" ON "ErpStockReservation"("organizationId","legalEntityId","reservationNumber");
CREATE UNIQUE INDEX "ErpStockReservation_idempotency_key" ON "ErpStockReservation"("organizationId","legalEntityId","createIdempotencyKey");
CREATE UNIQUE INDEX "ErpStockReservation_active_serial_key" ON "ErpStockReservation"("organizationId","legalEntityId","itemId","warehouseId","serialNumber") WHERE "status" = 'active' AND "serialNumber" <> '';
CREATE INDEX "ErpStockReservation_org_idx" ON "ErpStockReservation"("organizationId");
CREATE INDEX "ErpStockReservation_stock_idx" ON "ErpStockReservation"("legalEntityId","itemId","warehouseId","status");
CREATE INDEX "ErpStockReservation_source_idx" ON "ErpStockReservation"("sourceType","sourceId","sourceLineId");
CREATE UNIQUE INDEX "ErpMrpRun_number_key" ON "ErpMrpRun"("organizationId","legalEntityId","financialYearId","runNumber");
CREATE UNIQUE INDEX "ErpMrpRun_idempotency_key" ON "ErpMrpRun"("organizationId","legalEntityId","createIdempotencyKey");
CREATE INDEX "ErpMrpRun_org_idx" ON "ErpMrpRun"("organizationId");
CREATE INDEX "ErpMrpRun_date_idx" ON "ErpMrpRun"("legalEntityId","asOfDate","status");
CREATE UNIQUE INDEX "ErpMrpRequirement_bucket_key" ON "ErpMrpRequirement"("organizationId","mrpRunId","itemId","warehouseId","requiredOn","level");
CREATE INDEX "ErpMrpRequirement_org_idx" ON "ErpMrpRequirement"("organizationId");
CREATE INDEX "ErpMrpRequirement_item_idx" ON "ErpMrpRequirement"("legalEntityId","itemId","warehouseId","requiredOn");
CREATE UNIQUE INDEX "ErpMrpSuggestion_requirement_key" ON "ErpMrpSuggestion"("organizationId","requirementId");
CREATE INDEX "ErpMrpSuggestion_org_idx" ON "ErpMrpSuggestion"("organizationId");
CREATE INDEX "ErpMrpSuggestion_status_idx" ON "ErpMrpSuggestion"("legalEntityId","mrpRunId","status");
CREATE UNIQUE INDEX "ErpTransferProposal_suggestion_key" ON "ErpTransferProposal"("suggestionId");
CREATE UNIQUE INDEX "ErpTransferProposal_number_key" ON "ErpTransferProposal"("organizationId","legalEntityId","proposalNumber");
CREATE INDEX "ErpTransferProposal_org_idx" ON "ErpTransferProposal"("organizationId");
CREATE INDEX "ErpTransferProposal_status_idx" ON "ErpTransferProposal"("legalEntityId","status");

ALTER TABLE "ErpPlanningBom" ADD CONSTRAINT "ErpPlanningBom_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlanningBom" ADD CONSTRAINT "ErpPlanningBom_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlanningBom" ADD CONSTRAINT "ErpPlanningBom_parent_item_fkey" FOREIGN KEY ("parentItemId") REFERENCES "ErpItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlanningBomRevision" ADD CONSTRAINT "ErpPlanningBomRevision_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlanningBomRevision" ADD CONSTRAINT "ErpPlanningBomRevision_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlanningBomRevision" ADD CONSTRAINT "ErpPlanningBomRevision_bom_fkey" FOREIGN KEY ("bomId") REFERENCES "ErpPlanningBom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlanningBomComponent" ADD CONSTRAINT "ErpPlanningBomComponent_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlanningBomComponent" ADD CONSTRAINT "ErpPlanningBomComponent_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlanningBomComponent" ADD CONSTRAINT "ErpPlanningBomComponent_revision_fkey" FOREIGN KEY ("revisionId") REFERENCES "ErpPlanningBomRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlanningBomComponent" ADD CONSTRAINT "ErpPlanningBomComponent_item_fkey" FOREIGN KEY ("componentItemId") REFERENCES "ErpItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpPlanningBomComponent" ADD CONSTRAINT "ErpPlanningBomComponent_warehouse_fkey" FOREIGN KEY ("issueWarehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpDemandForecast" ADD CONSTRAINT "ErpDemandForecast_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpDemandForecast" ADD CONSTRAINT "ErpDemandForecast_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpDemandForecast" ADD CONSTRAINT "ErpDemandForecast_year_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpDemandForecast" ADD CONSTRAINT "ErpDemandForecast_item_fkey" FOREIGN KEY ("itemId") REFERENCES "ErpItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpDemandForecast" ADD CONSTRAINT "ErpDemandForecast_warehouse_fkey" FOREIGN KEY ("warehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpStockReservation" ADD CONSTRAINT "ErpStockReservation_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpStockReservation" ADD CONSTRAINT "ErpStockReservation_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpStockReservation" ADD CONSTRAINT "ErpStockReservation_item_fkey" FOREIGN KEY ("itemId") REFERENCES "ErpItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpStockReservation" ADD CONSTRAINT "ErpStockReservation_warehouse_fkey" FOREIGN KEY ("warehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpRun" ADD CONSTRAINT "ErpMrpRun_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpRun" ADD CONSTRAINT "ErpMrpRun_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpRun" ADD CONSTRAINT "ErpMrpRun_year_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpRequirement" ADD CONSTRAINT "ErpMrpRequirement_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpRequirement" ADD CONSTRAINT "ErpMrpRequirement_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpRequirement" ADD CONSTRAINT "ErpMrpRequirement_run_fkey" FOREIGN KEY ("mrpRunId") REFERENCES "ErpMrpRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpRequirement" ADD CONSTRAINT "ErpMrpRequirement_item_fkey" FOREIGN KEY ("itemId") REFERENCES "ErpItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpRequirement" ADD CONSTRAINT "ErpMrpRequirement_warehouse_fkey" FOREIGN KEY ("warehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpRequirement" ADD CONSTRAINT "ErpMrpRequirement_revision_fkey" FOREIGN KEY ("bomRevisionId") REFERENCES "ErpPlanningBomRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpSuggestion" ADD CONSTRAINT "ErpMrpSuggestion_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpSuggestion" ADD CONSTRAINT "ErpMrpSuggestion_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpSuggestion" ADD CONSTRAINT "ErpMrpSuggestion_run_fkey" FOREIGN KEY ("mrpRunId") REFERENCES "ErpMrpRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpSuggestion" ADD CONSTRAINT "ErpMrpSuggestion_requirement_fkey" FOREIGN KEY ("requirementId") REFERENCES "ErpMrpRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpSuggestion" ADD CONSTRAINT "ErpMrpSuggestion_item_fkey" FOREIGN KEY ("itemId") REFERENCES "ErpItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpSuggestion" ADD CONSTRAINT "ErpMrpSuggestion_warehouse_fkey" FOREIGN KEY ("warehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpMrpSuggestion" ADD CONSTRAINT "ErpMrpSuggestion_source_warehouse_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTransferProposal" ADD CONSTRAINT "ErpTransferProposal_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTransferProposal" ADD CONSTRAINT "ErpTransferProposal_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTransferProposal" ADD CONSTRAINT "ErpTransferProposal_suggestion_fkey" FOREIGN KEY ("suggestionId") REFERENCES "ErpMrpSuggestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTransferProposal" ADD CONSTRAINT "ErpTransferProposal_item_fkey" FOREIGN KEY ("itemId") REFERENCES "ErpItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTransferProposal" ADD CONSTRAINT "ErpTransferProposal_from_warehouse_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpTransferProposal" ADD CONSTRAINT "ErpTransferProposal_to_warehouse_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cross-row tenant/company integrity remains enforced even if an application
-- path accidentally supplies an ID from another company.
CREATE OR REPLACE FUNCTION enforce_erp_planning_scope() RETURNS trigger AS $$
DECLARE parent_org TEXT; parent_entity TEXT; second_org TEXT; second_entity TEXT; item_uom TEXT; item_batch BOOLEAN; item_serial BOOLEAN; item_expiry BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'ErpItem' THEN
    IF NEW."planningWarehouseId" IS NOT NULL THEN SELECT "organizationId","legalEntityId" INTO parent_org,parent_entity FROM "ErpWarehouse" WHERE "id" = NEW."planningWarehouseId"; IF parent_org <> NEW."organizationId" OR parent_entity <> NEW."legalEntityId" THEN RAISE EXCEPTION 'planning warehouse company mismatch'; END IF; END IF;
    IF NEW."transferSourceWarehouseId" IS NOT NULL THEN SELECT "organizationId","legalEntityId" INTO parent_org,parent_entity FROM "ErpWarehouse" WHERE "id" = NEW."transferSourceWarehouseId"; IF parent_org <> NEW."organizationId" OR parent_entity <> NEW."legalEntityId" THEN RAISE EXCEPTION 'transfer warehouse company mismatch'; END IF; END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'ErpPlanningBom' THEN
    SELECT "organizationId","legalEntityId" INTO parent_org,parent_entity FROM "ErpItem" WHERE "id" = NEW."parentItemId";
  ELSIF TG_TABLE_NAME = 'ErpPlanningBomRevision' THEN
    SELECT "organizationId","legalEntityId" INTO parent_org,parent_entity FROM "ErpPlanningBom" WHERE "id" = NEW."bomId";
  ELSIF TG_TABLE_NAME = 'ErpPlanningBomComponent' THEN
    SELECT "organizationId","legalEntityId" INTO parent_org,parent_entity FROM "ErpPlanningBomRevision" WHERE "id" = NEW."revisionId";
    SELECT "organizationId","legalEntityId" INTO second_org,second_entity FROM "ErpItem" WHERE "id" = NEW."componentItemId";
    IF second_org <> NEW."organizationId" OR second_entity <> NEW."legalEntityId" THEN RAISE EXCEPTION 'BOM component item company mismatch'; END IF;
    IF NEW."issueWarehouseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ErpWarehouse" WHERE "id"=NEW."issueWarehouseId" AND "organizationId"=NEW."organizationId" AND "legalEntityId"=NEW."legalEntityId") THEN RAISE EXCEPTION 'BOM issue warehouse company mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'ErpDemandForecast' THEN
    SELECT "organizationId","legalEntityId","baseUom" INTO parent_org,parent_entity,item_uom FROM "ErpItem" WHERE "id" = NEW."itemId";
    IF NOT EXISTS (SELECT 1 FROM "ErpWarehouse" WHERE "id"=NEW."warehouseId" AND "organizationId"=NEW."organizationId" AND "legalEntityId"=NEW."legalEntityId") OR NOT EXISTS (SELECT 1 FROM "FinancialYear" WHERE "id"=NEW."financialYearId" AND "organizationId"=NEW."organizationId" AND "legalEntityId"=NEW."legalEntityId") THEN RAISE EXCEPTION 'forecast company scope mismatch'; END IF;
    IF upper(item_uom) <> upper(NEW."uom") THEN RAISE EXCEPTION 'forecast UOM must match item base UOM'; END IF;
  ELSIF TG_TABLE_NAME = 'ErpStockReservation' THEN
    SELECT "organizationId","legalEntityId","baseUom","batchTracked","serialTracked","expiryTracked" INTO parent_org,parent_entity,item_uom,item_batch,item_serial,item_expiry FROM "ErpItem" WHERE "id" = NEW."itemId";
    IF NOT EXISTS (SELECT 1 FROM "ErpWarehouse" WHERE "id"=NEW."warehouseId" AND "organizationId"=NEW."organizationId" AND "legalEntityId"=NEW."legalEntityId") THEN RAISE EXCEPTION 'reservation warehouse company mismatch'; END IF;
    IF upper(item_uom) <> upper(NEW."uom") OR ((item_batch OR item_expiry) AND NEW."batchNumber"='') OR (item_serial AND (NEW."serialNumber"='' OR NEW."quantity"<>1)) OR (NOT item_serial AND NEW."serialNumber"<>'') THEN RAISE EXCEPTION 'reservation item tracking or UOM mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'ErpMrpRun' THEN
    SELECT "organizationId","legalEntityId" INTO parent_org,parent_entity FROM "FinancialYear" WHERE "id" = NEW."financialYearId";
  ELSIF TG_TABLE_NAME = 'ErpMrpRequirement' THEN
    SELECT "organizationId","legalEntityId" INTO parent_org,parent_entity FROM "ErpMrpRun" WHERE "id" = NEW."mrpRunId";
    IF NOT EXISTS (SELECT 1 FROM "ErpItem" WHERE "id"=NEW."itemId" AND "organizationId"=NEW."organizationId" AND "legalEntityId"=NEW."legalEntityId") OR NOT EXISTS (SELECT 1 FROM "ErpWarehouse" WHERE "id"=NEW."warehouseId" AND "organizationId"=NEW."organizationId" AND "legalEntityId"=NEW."legalEntityId") THEN RAISE EXCEPTION 'MRP requirement company scope mismatch'; END IF;
    IF NEW."bomRevisionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ErpPlanningBomRevision" revision JOIN "ErpPlanningBom" bom ON bom."id"=revision."bomId" WHERE revision."id"=NEW."bomRevisionId" AND revision."organizationId"=NEW."organizationId" AND revision."legalEntityId"=NEW."legalEntityId" AND revision."status"='approved' AND bom."parentItemId"=NEW."itemId") THEN RAISE EXCEPTION 'MRP requirement BOM scope mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'ErpMrpSuggestion' THEN
    SELECT "organizationId","legalEntityId" INTO parent_org,parent_entity FROM "ErpMrpRequirement" WHERE "id" = NEW."requirementId";
    IF NOT EXISTS (SELECT 1 FROM "ErpMrpRequirement" WHERE "id"=NEW."requirementId" AND "mrpRunId"=NEW."mrpRunId" AND "itemId"=NEW."itemId" AND "warehouseId"=NEW."warehouseId") OR NOT EXISTS (SELECT 1 FROM "ErpMrpRun" WHERE "id"=NEW."mrpRunId" AND "organizationId"=NEW."organizationId" AND "legalEntityId"=NEW."legalEntityId") OR NOT EXISTS (SELECT 1 FROM "ErpItem" WHERE "id"=NEW."itemId" AND "organizationId"=NEW."organizationId" AND "legalEntityId"=NEW."legalEntityId" AND upper("baseUom")=upper(NEW."uom")) OR NOT EXISTS (SELECT 1 FROM "ErpWarehouse" WHERE "id"=NEW."warehouseId" AND "organizationId"=NEW."organizationId" AND "legalEntityId"=NEW."legalEntityId") THEN RAISE EXCEPTION 'MRP suggestion company scope mismatch'; END IF;
    IF NEW."sourceWarehouseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ErpWarehouse" WHERE "id"=NEW."sourceWarehouseId" AND "organizationId"=NEW."organizationId" AND "legalEntityId"=NEW."legalEntityId") THEN RAISE EXCEPTION 'MRP source warehouse company mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'ErpTransferProposal' THEN
    SELECT "organizationId","legalEntityId" INTO parent_org,parent_entity FROM "ErpMrpSuggestion" WHERE "id" = NEW."suggestionId";
    IF NOT EXISTS (SELECT 1 FROM "ErpMrpSuggestion" WHERE "id"=NEW."suggestionId" AND "suggestionType"='transfer' AND "itemId"=NEW."itemId" AND "sourceWarehouseId"=NEW."fromWarehouseId" AND "warehouseId"=NEW."toWarehouseId" AND "quantity"=NEW."quantity" AND upper("uom")=upper(NEW."uom")) OR NOT EXISTS (SELECT 1 FROM "ErpItem" WHERE "id"=NEW."itemId" AND "organizationId"=NEW."organizationId" AND "legalEntityId"=NEW."legalEntityId") OR NOT EXISTS (SELECT 1 FROM "ErpWarehouse" WHERE "id" IN (NEW."fromWarehouseId",NEW."toWarehouseId") AND "organizationId"=NEW."organizationId" AND "legalEntityId"=NEW."legalEntityId" GROUP BY "organizationId" HAVING count(*)=2) THEN RAISE EXCEPTION 'transfer proposal company scope mismatch'; END IF;
  END IF;
  IF parent_org IS DISTINCT FROM NEW."organizationId" OR parent_entity IS DISTINCT FROM NEW."legalEntityId" THEN RAISE EXCEPTION 'planning parent company scope mismatch'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpItem_planning_scope" BEFORE INSERT OR UPDATE OF "organizationId","legalEntityId","planningWarehouseId","transferSourceWarehouseId" ON "ErpItem" FOR EACH ROW EXECUTE FUNCTION enforce_erp_planning_scope();
CREATE TRIGGER "ErpPlanningBom_scope" BEFORE INSERT OR UPDATE ON "ErpPlanningBom" FOR EACH ROW EXECUTE FUNCTION enforce_erp_planning_scope();
CREATE TRIGGER "ErpPlanningBomRevision_scope" BEFORE INSERT OR UPDATE ON "ErpPlanningBomRevision" FOR EACH ROW EXECUTE FUNCTION enforce_erp_planning_scope();
CREATE TRIGGER "ErpPlanningBomComponent_scope" BEFORE INSERT OR UPDATE ON "ErpPlanningBomComponent" FOR EACH ROW EXECUTE FUNCTION enforce_erp_planning_scope();
CREATE TRIGGER "ErpDemandForecast_scope" BEFORE INSERT OR UPDATE ON "ErpDemandForecast" FOR EACH ROW EXECUTE FUNCTION enforce_erp_planning_scope();
CREATE TRIGGER "ErpStockReservation_scope" BEFORE INSERT OR UPDATE ON "ErpStockReservation" FOR EACH ROW EXECUTE FUNCTION enforce_erp_planning_scope();
CREATE TRIGGER "ErpMrpRun_scope" BEFORE INSERT OR UPDATE ON "ErpMrpRun" FOR EACH ROW EXECUTE FUNCTION enforce_erp_planning_scope();
CREATE TRIGGER "ErpMrpRequirement_scope" BEFORE INSERT OR UPDATE ON "ErpMrpRequirement" FOR EACH ROW EXECUTE FUNCTION enforce_erp_planning_scope();
CREATE TRIGGER "ErpMrpSuggestion_scope" BEFORE INSERT OR UPDATE ON "ErpMrpSuggestion" FOR EACH ROW EXECUTE FUNCTION enforce_erp_planning_scope();
CREATE TRIGGER "ErpTransferProposal_scope" BEFORE INSERT OR UPDATE ON "ErpTransferProposal" FOR EACH ROW EXECUTE FUNCTION enforce_erp_planning_scope();

CREATE OR REPLACE FUNCTION protect_erp_planning_revision() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" <> 'draft' THEN RAISE EXCEPTION 'submitted or approved BOM revision is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF OLD."status" = 'approved' THEN RAISE EXCEPTION 'approved BOM revision is immutable'; END IF;
  IF OLD."status" = 'submitted' AND NEW."status" <> 'approved' THEN RAISE EXCEPTION 'submitted BOM revision may only be approved'; END IF;
  IF NEW."status" = 'approved' AND EXISTS (
    SELECT 1 FROM "ErpPlanningBomRevision" other WHERE other."bomId"=NEW."bomId" AND other."id"<>NEW."id" AND other."status"='approved'
      AND daterange(other."effectiveFrom", COALESCE(other."effectiveTo" + 1, 'infinity'::date), '[)') && daterange(NEW."effectiveFrom", COALESCE(NEW."effectiveTo" + 1, 'infinity'::date), '[)')
  ) THEN RAISE EXCEPTION 'approved BOM effective periods cannot overlap'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpPlanningBomRevision_immutable" BEFORE UPDATE OR DELETE ON "ErpPlanningBomRevision" FOR EACH ROW EXECUTE FUNCTION protect_erp_planning_revision();

CREATE OR REPLACE FUNCTION protect_erp_planning_component() RETURNS trigger AS $$
DECLARE revision_status TEXT;
BEGIN
  SELECT "status" INTO revision_status FROM "ErpPlanningBomRevision" WHERE "id"=COALESCE(NEW."revisionId",OLD."revisionId");
  IF revision_status <> 'draft' THEN RAISE EXCEPTION 'BOM components are immutable after revision submission'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpPlanningBomComponent_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "ErpPlanningBomComponent" FOR EACH ROW EXECUTE FUNCTION protect_erp_planning_component();

CREATE OR REPLACE FUNCTION protect_erp_forecast() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" <> 'draft' THEN RAISE EXCEPTION 'submitted or approved forecast is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF OLD."status" = 'approved' THEN RAISE EXCEPTION 'approved forecast is immutable'; END IF;
  IF OLD."status" = 'submitted' AND NEW."status" <> 'approved' THEN RAISE EXCEPTION 'submitted forecast may only be approved'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpDemandForecast_immutable" BEFORE UPDATE OR DELETE ON "ErpDemandForecast" FOR EACH ROW EXECUTE FUNCTION protect_erp_forecast();

CREATE OR REPLACE FUNCTION protect_erp_mrp_snapshot() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MRP run and requirement snapshots are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpMrpRun_immutable" BEFORE UPDATE OR DELETE ON "ErpMrpRun" FOR EACH ROW EXECUTE FUNCTION protect_erp_mrp_snapshot();
CREATE TRIGGER "ErpMrpRequirement_immutable" BEFORE UPDATE OR DELETE ON "ErpMrpRequirement" FOR EACH ROW EXECUTE FUNCTION protect_erp_mrp_snapshot();

CREATE OR REPLACE FUNCTION protect_erp_mrp_suggestion() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MRP suggestion evidence is immutable'; END IF;
  IF ROW(NEW."organizationId",NEW."legalEntityId",NEW."mrpRunId",NEW."requirementId",NEW."suggestionType",NEW."itemId",NEW."warehouseId",NEW."sourceWarehouseId",NEW."quantity",NEW."uom",NEW."orderOn",NEW."requiredOn",NEW."planningSnapshot",NEW."sourceSnapshotHash",NEW."createdBy",NEW."createdAt")
    IS DISTINCT FROM ROW(OLD."organizationId",OLD."legalEntityId",OLD."mrpRunId",OLD."requirementId",OLD."suggestionType",OLD."itemId",OLD."warehouseId",OLD."sourceWarehouseId",OLD."quantity",OLD."uom",OLD."orderOn",OLD."requiredOn",OLD."planningSnapshot",OLD."sourceSnapshotHash",OLD."createdBy",OLD."createdAt") THEN RAISE EXCEPTION 'MRP suggestion planning evidence is immutable'; END IF;
  IF (OLD."status"='draft' AND NEW."status"<>'submitted') OR (OLD."status"='submitted' AND NEW."status"<>'approved') OR (OLD."status"='approved' AND NEW."status"<>'released') OR OLD."status" IN ('released','cancelled') THEN RAISE EXCEPTION 'invalid MRP suggestion lifecycle transition'; END IF;
  IF NEW."status"='approved' AND NEW."approvedBy"=NEW."createdBy" THEN RAISE EXCEPTION 'MRP suggestion maker cannot approve'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpMrpSuggestion_immutable" BEFORE UPDATE OR DELETE ON "ErpMrpSuggestion" FOR EACH ROW EXECUTE FUNCTION protect_erp_mrp_suggestion();

CREATE OR REPLACE FUNCTION protect_erp_reservation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'stock reservation evidence is immutable'; END IF;
  IF ROW(NEW."organizationId",NEW."legalEntityId",NEW."reservationNumber",NEW."itemId",NEW."warehouseId",NEW."quantity",NEW."uom",NEW."batchNumber",NEW."serialNumber",NEW."sourceType",NEW."sourceId",NEW."sourceLineId",NEW."requiredOn",NEW."sourceSnapshotHash",NEW."createdBy",NEW."createdAt")
    IS DISTINCT FROM ROW(OLD."organizationId",OLD."legalEntityId",OLD."reservationNumber",OLD."itemId",OLD."warehouseId",OLD."quantity",OLD."uom",OLD."batchNumber",OLD."serialNumber",OLD."sourceType",OLD."sourceId",OLD."sourceLineId",OLD."requiredOn",OLD."sourceSnapshotHash",OLD."createdBy",OLD."createdAt") THEN RAISE EXCEPTION 'stock reservation evidence is immutable'; END IF;
  IF OLD."status" <> 'active' OR NEW."status" NOT IN ('released','consumed','cancelled') THEN RAISE EXCEPTION 'invalid stock reservation lifecycle transition'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpStockReservation_immutable" BEFORE UPDATE OR DELETE ON "ErpStockReservation" FOR EACH ROW EXECUTE FUNCTION protect_erp_reservation();

INSERT INTO "Permission" ("id","serviceId","key","label","description","riskLevel") VALUES
  ('mesaerp.mrp.manage','mesaerp','mesaerp.mrp.manage','Manage manufacturing planning','Manage company planning policies, BOM revisions, forecasts, ATP, reservations and MRP suggestions.','high')
ON CONFLICT ("id") DO UPDATE SET "label"=EXCLUDED."label", "description"=EXCLUDED."description", "riskLevel"=EXCLUDED."riskLevel";

INSERT INTO "RolePermission" ("id","organizationId","roleId","permissionId","effect","createdAt")
SELECT 'mrp-planning-' || md5(role."id"), role."organizationId", role."id", 'mesaerp.mrp.manage', 'allow', CURRENT_TIMESTAMP
FROM "Role" role
WHERE role."erpLegalEntityId" IS NOT NULL AND role."name" LIKE '% MesaERP Administrator'
ON CONFLICT ("organizationId","roleId","permissionId") DO NOTHING;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['ErpPlanningBom','ErpPlanningBomRevision','ErpPlanningBomComponent','ErpDemandForecast','ErpStockReservation','ErpMrpRun','ErpMrpRequirement','ErpMrpSuggestion','ErpTransferProposal'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_tenant'', true)) WITH CHECK ("organizationId" = current_setting(''app.current_tenant'', true));', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO app_user;', table_name);
  END LOOP;
END $$;
