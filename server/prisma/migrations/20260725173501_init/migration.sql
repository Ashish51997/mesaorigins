-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'trialing',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firebaseUid" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'D',
    "line" TEXT NOT NULL DEFAULT '—',
    "status" TEXT NOT NULL DEFAULT 'active',
    "joinDate" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "lastSeen" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstNumber" TEXT NOT NULL DEFAULT '',
    "contactPerson" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "billingAddress" TEXT NOT NULL DEFAULT '',
    "deliveryAddress" TEXT NOT NULL DEFAULT '',
    "paymentTerms" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inquiryNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "drawingRef" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "expectedDeliveryDate" TEXT NOT NULL DEFAULT '',
    "remarks" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "attachment" TEXT,
    "quotationPrice" DOUBLE PRECISION,
    "negotiationNote" TEXT,
    "discountPercent" DOUBLE PRECISION,
    "originalPrice" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "soNumber" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "deliveryDate" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "specialInstructions" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'D',
    "operatorName" TEXT NOT NULL DEFAULT '',
    "scheduledStartDate" TEXT NOT NULL DEFAULT '',
    "scheduledEndDate" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogbookTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "docNo" TEXT NOT NULL DEFAULT '',
    "revNo" TEXT NOT NULL DEFAULT '',
    "revDate" TEXT NOT NULL DEFAULT '',
    "brandName" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL DEFAULT '',
    "shifts" TEXT[],
    "supervisors" TEXT[],
    "lotNumberNote" TEXT NOT NULL DEFAULT '',
    "dieZones" TEXT[],
    "barrelZones" TEXT[],
    "zoneSpecs" JSONB,
    "coil" JSONB NOT NULL,
    "inspectionTimeSlots" TEXT[],
    "dimensionSpecs" JSONB NOT NULL,
    "finishSpec" TEXT NOT NULL DEFAULT '',
    "perMeterSpec" TEXT NOT NULL DEFAULT '',
    "traceability" JSONB NOT NULL,
    "rejectionReasons" TEXT[],
    "notes" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogbookTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineLogbook" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productionPlanId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rolls" JSONB NOT NULL DEFAULT '[]',
    "scrapKg" TEXT NOT NULL DEFAULT '',
    "operatorSignature" TEXT NOT NULL DEFAULT '',
    "supervisorSignature" TEXT NOT NULL DEFAULT '',
    "machineId" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL DEFAULT '',
    "shift" TEXT NOT NULL DEFAULT '',
    "supervisor" TEXT NOT NULL DEFAULT '',
    "drawingNo" TEXT NOT NULL DEFAULT '',
    "tag" TEXT NOT NULL DEFAULT '',
    "formulaNo" TEXT NOT NULL DEFAULT '',
    "dieZoneTemps" JSONB NOT NULL DEFAULT '{}',
    "barrelZoneTemps" JSONB NOT NULL DEFAULT '{}',
    "motorSpeed" TEXT NOT NULL DEFAULT '',
    "ampere" TEXT NOT NULL DEFAULT '',
    "takeupSpeed" TEXT NOT NULL DEFAULT '',
    "vacuum" TEXT NOT NULL DEFAULT '',
    "extruderStartTime" TEXT NOT NULL DEFAULT '',
    "productSetTime" TEXT NOT NULL DEFAULT '',
    "shoreHardness" TEXT NOT NULL DEFAULT '',
    "productionPerHour" TEXT NOT NULL DEFAULT '',
    "moldNo" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL DEFAULT '',
    "coilWeights" TEXT[],
    "hourlyInspections" JSONB NOT NULL DEFAULT '[]',
    "traceabilityRows" JSONB NOT NULL DEFAULT '[]',
    "totalRollsProduced" TEXT NOT NULL DEFAULT '',
    "totalRollKgs" TEXT NOT NULL DEFAULT '',
    "processWasteKg" TEXT NOT NULL DEFAULT '',
    "lumpsWasteKg" TEXT NOT NULL DEFAULT '',
    "rejectionKg" TEXT NOT NULL DEFAULT '',
    "totalConsumedKg" TEXT NOT NULL DEFAULT '',
    "rejectionCounts" JSONB NOT NULL DEFAULT '{}',
    "meterCheckedBy" TEXT NOT NULL DEFAULT '',
    "meterCheckTime" TEXT NOT NULL DEFAULT '',
    "meter" TEXT NOT NULL DEFAULT '',
    "meterCountSet" TEXT NOT NULL DEFAULT '',
    "attachedImage" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineLogbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityInspection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rollNumber" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL DEFAULT '',
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "finish" TEXT NOT NULL DEFAULT 'pass',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "colour" TEXT NOT NULL DEFAULT 'pass',
    "tearingTest" TEXT NOT NULL DEFAULT 'pass',
    "remarks" TEXT NOT NULL DEFAULT '',
    "decision" TEXT NOT NULL DEFAULT 'pass',
    "inspectedBy" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rollNumber" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "palletNumber" TEXT NOT NULL DEFAULT '',
    "packingDate" TEXT NOT NULL DEFAULT '',
    "packedBy" TEXT NOT NULL DEFAULT '',
    "labelGenerated" BOOLEAN NOT NULL DEFAULT false,
    "qrCode" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT '',
    "lotNumber" TEXT,
    "reference" TEXT,
    "date" TEXT NOT NULL DEFAULT '',
    "handler" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL DEFAULT '',
    "transporter" TEXT NOT NULL DEFAULT '',
    "driverName" TEXT NOT NULL DEFAULT '',
    "dispatchDate" TEXT NOT NULL DEFAULT '',
    "deliveryAddress" TEXT NOT NULL DEFAULT '',
    "etaDate" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'shipped',
    "communicationTriggered" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "complaintNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL DEFAULT '',
    "product" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "photoUrl" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "rootCause" TEXT,
    "resolution" TEXT,
    "capaId" TEXT,
    "date" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CAPARecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "complaintId" TEXT,
    "rejectionId" TEXT,
    "rootCause" TEXT NOT NULL DEFAULT '',
    "correctiveAction" TEXT NOT NULL DEFAULT '',
    "preventiveAction" TEXT NOT NULL DEFAULT '',
    "responsiblePerson" TEXT NOT NULL DEFAULT '',
    "dueDate" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "closedDate" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CAPARecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "standardYieldPortion" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BOMItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "portion" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "BOMItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "taskName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL DEFAULT '',
    "frequency" TEXT NOT NULL DEFAULT 'Monthly',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "line" TEXT NOT NULL DEFAULT '',
    "family" TEXT NOT NULL DEFAULT 'PVC',
    "logbookFormat" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'running',
    "statusReason" TEXT,
    "currentProduct" TEXT,
    "currentFormula" TEXT,
    "currentLot" TEXT,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "material" TEXT NOT NULL DEFAULT '',
    "isReprocess" BOOLEAN NOT NULL DEFAULT false,
    "acceptRatePct" INTEGER,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "updatedBy" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delegation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "targetRole" TEXT NOT NULL DEFAULT '',
    "featureKey" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "durationMinutes" INTEGER NOT NULL DEFAULT 15,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedBy" TEXT NOT NULL DEFAULT '',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Delegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL DEFAULT '',
    "actorRole" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL DEFAULT '',
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_firebaseUid_key" ON "User"("firebaseUid");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_employeeCode_key" ON "Membership"("organizationId", "employeeCode");

-- CreateIndex
CREATE INDEX "Customer_organizationId_idx" ON "Customer"("organizationId");

-- CreateIndex
CREATE INDEX "Inquiry_organizationId_idx" ON "Inquiry"("organizationId");

-- CreateIndex
CREATE INDEX "Inquiry_customerId_idx" ON "Inquiry"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_organizationId_inquiryNumber_key" ON "Inquiry"("organizationId", "inquiryNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_inquiryId_key" ON "SalesOrder"("inquiryId");

-- CreateIndex
CREATE INDEX "SalesOrder_organizationId_idx" ON "SalesOrder"("organizationId");

-- CreateIndex
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_organizationId_soNumber_key" ON "SalesOrder"("organizationId", "soNumber");

-- CreateIndex
CREATE INDEX "ProductionPlan_organizationId_idx" ON "ProductionPlan"("organizationId");

-- CreateIndex
CREATE INDEX "ProductionPlan_salesOrderId_idx" ON "ProductionPlan"("salesOrderId");

-- CreateIndex
CREATE INDEX "LogbookTemplate_organizationId_idx" ON "LogbookTemplate"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MachineLogbook_productionPlanId_key" ON "MachineLogbook"("productionPlanId");

-- CreateIndex
CREATE INDEX "MachineLogbook_organizationId_idx" ON "MachineLogbook"("organizationId");

-- CreateIndex
CREATE INDEX "QualityInspection_organizationId_idx" ON "QualityInspection"("organizationId");

-- CreateIndex
CREATE INDEX "PackingRecord_organizationId_idx" ON "PackingRecord"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_organizationId_idx" ON "InventoryTransaction"("organizationId");

-- CreateIndex
CREATE INDEX "DispatchRecord_organizationId_idx" ON "DispatchRecord"("organizationId");

-- CreateIndex
CREATE INDEX "DispatchRecord_salesOrderId_idx" ON "DispatchRecord"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchRecord_organizationId_invoiceNumber_key" ON "DispatchRecord"("organizationId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "Complaint_organizationId_idx" ON "Complaint"("organizationId");

-- CreateIndex
CREATE INDEX "Complaint_customerId_idx" ON "Complaint"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_organizationId_complaintNumber_key" ON "Complaint"("organizationId", "complaintNumber");

-- CreateIndex
CREATE INDEX "CAPARecord_organizationId_idx" ON "CAPARecord"("organizationId");

-- CreateIndex
CREATE INDEX "Recipe_organizationId_idx" ON "Recipe"("organizationId");

-- CreateIndex
CREATE INDEX "BOMItem_organizationId_idx" ON "BOMItem"("organizationId");

-- CreateIndex
CREATE INDEX "BOMItem_recipeId_idx" ON "BOMItem"("recipeId");

-- CreateIndex
CREATE INDEX "MaintenanceTask_organizationId_idx" ON "MaintenanceTask"("organizationId");

-- CreateIndex
CREATE INDEX "Machine_organizationId_idx" ON "Machine"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_organizationId_code_key" ON "Machine"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Supplier_organizationId_idx" ON "Supplier"("organizationId");

-- CreateIndex
CREATE INDEX "PermissionRule_organizationId_idx" ON "PermissionRule"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionRule_organizationId_role_featureKey_key" ON "PermissionRule"("organizationId", "role", "featureKey");

-- CreateIndex
CREATE INDEX "EmployeeGrant_organizationId_idx" ON "EmployeeGrant"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeGrant_membershipId_idx" ON "EmployeeGrant"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeGrant_organizationId_membershipId_featureKey_key" ON "EmployeeGrant"("organizationId", "membershipId", "featureKey");

-- CreateIndex
CREATE INDEX "Delegation_organizationId_idx" ON "Delegation"("organizationId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_idx" ON "AuditEvent"("organizationId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_entity_entityId_idx" ON "AuditEvent"("organizationId", "entity", "entityId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogbookTemplate" ADD CONSTRAINT "LogbookTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineLogbook" ADD CONSTRAINT "MachineLogbook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineLogbook" ADD CONSTRAINT "MachineLogbook_productionPlanId_fkey" FOREIGN KEY ("productionPlanId") REFERENCES "ProductionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineLogbook" ADD CONSTRAINT "MachineLogbook_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "LogbookTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingRecord" ADD CONSTRAINT "PackingRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CAPARecord" ADD CONSTRAINT "CAPARecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOMItem" ADD CONSTRAINT "BOMItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOMItem" ADD CONSTRAINT "BOMItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTask" ADD CONSTRAINT "MaintenanceTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionRule" ADD CONSTRAINT "PermissionRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeGrant" ADD CONSTRAINT "EmployeeGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeGrant" ADD CONSTRAINT "EmployeeGrant_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
