-- DropForeignKey
ALTER TABLE "ProductionPlan" DROP CONSTRAINT "ProductionPlan_salesOrderId_fkey";

-- DropForeignKey
ALTER TABLE "DispatchRecord" DROP CONSTRAINT "DispatchRecord_salesOrderId_fkey";

-- AlterTable
ALTER TABLE "ProductionPlan" ADD COLUMN     "operationalOrderId" TEXT,
ADD COLUMN     "plannedQuantity" DECIMAL(18,6),
ADD COLUMN     "taskSequence" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "executionSnapshot" JSONB NOT NULL DEFAULT '{}',
ALTER COLUMN "salesOrderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DispatchRecord" ADD COLUMN "operationalOrderId" TEXT,
ADD COLUMN "gatePassNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN "eWayBillNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN "statutoryRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "statutoryArtifact" JSONB NOT NULL DEFAULT '{}',
ALTER COLUMN "salesOrderId" DROP NOT NULL;

-- Register MesaERP in the platform catalogue. Entitlement stays explicit: this
-- migration does not silently assign the new service to existing organizations.
INSERT INTO "Service" ("id", "name", "description", "status", "sortOrder", "createdAt", "updatedAt")
VALUES ('mesaerp', 'MesaERP', 'Manufacturing business ERP, accounting, procurement, costing and statutory control.', 'active', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "riskLevel" TEXT NOT NULL DEFAULT 'standard',

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Permission" ("id", "serviceId", "key", "label", "riskLevel") VALUES
  ('mesaerp.legal_entity.manage', 'mesaerp', 'mesaerp.legal_entity.manage', 'Manage legal entities', 'high'),
  ('mesaerp.vendor.read', 'mesaerp', 'mesaerp.vendor.read', 'View vendors', 'standard'),
  ('mesaerp.vendor.manage', 'mesaerp', 'mesaerp.vendor.manage', 'Manage vendor lifecycle', 'sensitive'),
  ('mesaerp.vendor.bank.verify', 'mesaerp', 'mesaerp.vendor.bank.verify', 'Verify vendor bank changes', 'high'),
  ('mesaerp.sourcing.manage', 'mesaerp', 'mesaerp.sourcing.manage', 'Manage sourcing and RFQs', 'sensitive'),
  ('mesaerp.procurement.manage', 'mesaerp', 'mesaerp.procurement.manage', 'Manage procurement', 'sensitive'),
  ('mesaerp.purchase.match', 'mesaerp', 'mesaerp.purchase.match', 'Approve three-way matches', 'high'),
  ('mesaerp.sales.manage', 'mesaerp', 'mesaerp.sales.manage', 'Manage sales documents', 'sensitive'),
  ('mesaerp.inventory.manage', 'mesaerp', 'mesaerp.inventory.manage', 'Manage valued inventory', 'high'),
  ('mesaerp.manufacturing.manage', 'mesaerp', 'mesaerp.manufacturing.manage', 'Manage manufacturing accounting', 'high'),
  ('mesaerp.voucher.read', 'mesaerp', 'mesaerp.voucher.read', 'View accounting vouchers', 'standard'),
  ('mesaerp.voucher.create', 'mesaerp', 'mesaerp.voucher.create', 'Create accounting vouchers', 'sensitive'),
  ('mesaerp.voucher.edit', 'mesaerp', 'mesaerp.voucher.edit', 'Edit draft vouchers', 'sensitive'),
  ('mesaerp.voucher.submit', 'mesaerp', 'mesaerp.voucher.submit', 'Submit vouchers', 'sensitive'),
  ('mesaerp.voucher.approve', 'mesaerp', 'mesaerp.voucher.approve', 'Approve vouchers', 'high'),
  ('mesaerp.voucher.post', 'mesaerp', 'mesaerp.voucher.post', 'Post vouchers', 'high'),
  ('mesaerp.voucher.reverse', 'mesaerp', 'mesaerp.voucher.reverse', 'Reverse posted vouchers', 'high'),
  ('mesaerp.banking.manage', 'mesaerp', 'mesaerp.banking.manage', 'Manage banking and reconciliation', 'high'),
  ('mesaerp.tax.manage', 'mesaerp', 'mesaerp.tax.manage', 'Manage tax and statutory documents', 'high'),
  ('mesaerp.asset.manage', 'mesaerp', 'mesaerp.asset.manage', 'Manage fixed assets', 'sensitive'),
  ('mesaerp.budget.manage', 'mesaerp', 'mesaerp.budget.manage', 'Manage budgets', 'sensitive'),
  ('mesaerp.reports.read', 'mesaerp', 'mesaerp.reports.read', 'View financial reports', 'standard'),
  ('mesaerp.handoff.manage', 'mesaerp', 'mesaerp.handoff.manage', 'Resolve service handoffs', 'high'),
  ('mesaerp.access.manage', 'mesaerp', 'mesaerp.access.manage', 'Manage MesaERP roles and access', 'high'),
  ('mesaerp.period.reopen', 'mesaerp', 'mesaerp.period.reopen', 'Reopen an accounting period', 'high')
ON CONFLICT ("id") DO NOTHING;

-- CreateTable
CREATE TABLE "LegalEntity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL DEFAULT '',
    "countryCode" TEXT NOT NULL DEFAULT 'IN',
    "baseCurrency" TEXT NOT NULL DEFAULT 'INR',
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 4,
    "pan" TEXT NOT NULL DEFAULT '',
    "cin" TEXT NOT NULL DEFAULT '',
    "gstRegistrations" JSONB NOT NULL DEFAULT '[]',
    "registeredAddress" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createIdempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialYear" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reopenedReason" TEXT NOT NULL DEFAULT '',
    "reopenedBy" TEXT NOT NULL DEFAULT '',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "effect" TEXT NOT NULL DEFAULT 'allow',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "legalEntityId" TEXT,
    "plantCode" TEXT,
    "warehouseId" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT,
    "serviceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "minimumAmount" DECIMAL(18,2),
    "maximumAmount" DECIMAL(18,2),
    "steps" JSONB NOT NULL DEFAULT '[]',
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delegation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromMembershipId" TEXT NOT NULL,
    "toMembershipId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "legalEntityId" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "parentId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "allowPosting" BOOLEAN NOT NULL DEFAULT true,
    "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpVendor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "vendorCode" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL DEFAULT '',
    "pan" TEXT NOT NULL DEFAULT '',
    "gstin" TEXT NOT NULL DEFAULT '',
    "msmeNumber" TEXT NOT NULL DEFAULT '',
    "registrations" JSONB NOT NULL DEFAULT '[]',
    "addresses" JSONB NOT NULL DEFAULT '[]',
    "categories" JSONB NOT NULL DEFAULT '[]',
    "plantCoverage" JSONB NOT NULL DEFAULT '[]',
    "geographyCoverage" JSONB NOT NULL DEFAULT '[]',
    "contacts" JSONB NOT NULL DEFAULT '[]',
    "paymentTerms" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "creditDays" INTEGER NOT NULL DEFAULT 0,
    "taxClassification" TEXT NOT NULL DEFAULT '',
    "tdsClassification" TEXT NOT NULL DEFAULT '',
    "avlStatus" TEXT NOT NULL DEFAULT 'not_listed',
    "lifecycleStatus" TEXT NOT NULL DEFAULT 'invited',
    "riskRating" TEXT NOT NULL DEFAULT 'unrated',
    "complianceStatus" TEXT NOT NULL DEFAULT 'pending',
    "performance" JSONB NOT NULL DEFAULT '{}',
    "originMetadata" JSONB NOT NULL DEFAULT '{}',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpVendorBankAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumberMasked" TEXT NOT NULL,
    "accountNumberCipher" BYTEA,
    "ifsc" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'pending_verification',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "changeCaseId" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpVendorBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpVendorDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL DEFAULT '',
    "issuedOn" DATE,
    "expiresOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "storageRef" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpVendorDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPortalUser" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "membershipId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPortalUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpCustomer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL DEFAULT '',
    "pan" TEXT NOT NULL DEFAULT '',
    "gstin" TEXT NOT NULL DEFAULT '',
    "addresses" JSONB NOT NULL DEFAULT '[]',
    "contacts" JSONB NOT NULL DEFAULT '[]',
    "paymentTerms" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "creditLimit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "creditDays" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "originMetadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemType" TEXT NOT NULL DEFAULT 'inventory',
    "category" TEXT NOT NULL DEFAULT '',
    "baseUom" TEXT NOT NULL,
    "uomConversions" JSONB NOT NULL DEFAULT '[]',
    "hsnSacCode" TEXT NOT NULL DEFAULT '',
    "gstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "valuationMethod" TEXT NOT NULL DEFAULT 'moving_average',
    "batchTracked" BOOLEAN NOT NULL DEFAULT false,
    "serialTracked" BOOLEAN NOT NULL DEFAULT false,
    "expiryTracked" BOOLEAN NOT NULL DEFAULT false,
    "inventoryAccount" TEXT NOT NULL DEFAULT '',
    "consumptionAccount" TEXT NOT NULL DEFAULT '',
    "salesAccount" TEXT NOT NULL DEFAULT '',
    "purchaseAccount" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpWarehouse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'warehouse',
    "plantCode" TEXT NOT NULL DEFAULT '',
    "branchCode" TEXT NOT NULL DEFAULT '',
    "address" JSONB NOT NULL DEFAULT '{}',
    "allowNegative" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpWarehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpNumberSeries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "suffix" TEXT NOT NULL DEFAULT '',
    "padding" INTEGER NOT NULL DEFAULT 5,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpNumberSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpIdempotencyRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ErpIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentDate" DATE NOT NULL,
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvalState" TEXT NOT NULL DEFAULT 'not_required',
    "vendorId" TEXT,
    "customerId" TEXT,
    "parentDocumentId" TEXT,
    "partySnapshot" JSONB NOT NULL DEFAULT '{}',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "roundingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "baseCurrencyTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxSummary" JSONB NOT NULL DEFAULT '{}',
    "terms" JSONB NOT NULL DEFAULT '[]',
    "shipping" JSONB NOT NULL DEFAULT '{}',
    "originType" TEXT NOT NULL DEFAULT 'manual',
    "originMetadata" JSONB NOT NULL DEFAULT '{}',
    "sourceSnapshotHash" TEXT NOT NULL DEFAULT '',
    "createIdempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL DEFAULT '',
    "approvedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpDocumentLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "hsnSacCode" TEXT NOT NULL DEFAULT '',
    "quantity" DECIMAL(18,6) NOT NULL,
    "uom" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "warehouseCode" TEXT NOT NULL DEFAULT '',
    "batchNumber" TEXT NOT NULL DEFAULT '',
    "promisedOn" DATE,
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "sourceLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpDocumentLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "fromDocumentId" TEXT NOT NULL,
    "toDocumentId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpDocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpMatchCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "inspectionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "quantityVariance" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "priceVariance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxVariance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalVariance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "details" JSONB NOT NULL DEFAULT '[]',
    "makerMembershipId" TEXT NOT NULL DEFAULT '',
    "checkerMembershipId" TEXT NOT NULL DEFAULT '',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpMatchCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpVoucher" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "accountingPeriodId" TEXT NOT NULL,
    "voucherType" TEXT NOT NULL,
    "voucherNumber" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "transactionDebit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "transactionCredit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "baseDebit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "baseCredit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reference" TEXT NOT NULL DEFAULT '',
    "narration" TEXT NOT NULL DEFAULT '',
    "sourceDocumentId" TEXT,
    "reversalOfId" TEXT,
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "originType" TEXT NOT NULL DEFAULT 'manual',
    "originMetadata" JSONB NOT NULL DEFAULT '{}',
    "sourceSnapshotHash" TEXT NOT NULL DEFAULT '',
    "createIdempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL DEFAULT '',
    "approvedBy" TEXT NOT NULL DEFAULT '',
    "postedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpVoucherLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountSnapshot" JSONB NOT NULL DEFAULT '{}',
    "transactionDebit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "transactionCredit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "baseDebit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "baseCredit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "billReference" TEXT NOT NULL DEFAULT '',
    "dueDate" DATE,
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "narration" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpVoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpStockMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "uom" TEXT NOT NULL,
    "unitCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "valuationMethod" TEXT NOT NULL,
    "valuationLayer" JSONB NOT NULL DEFAULT '{}',
    "batchNumber" TEXT NOT NULL DEFAULT '',
    "serialNumber" TEXT NOT NULL DEFAULT '',
    "expiryDate" DATE,
    "sourceDocumentId" TEXT,
    "voucherId" TEXT,
    "originType" TEXT NOT NULL DEFAULT 'manual',
    "originMetadata" JSONB NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpProductionDemand" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "demandNumber" TEXT NOT NULL,
    "demandType" TEXT NOT NULL DEFAULT 'sales_order',
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "uom" TEXT NOT NULL,
    "requiredOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "bomSnapshot" JSONB NOT NULL DEFAULT '{}',
    "materialRequirements" JSONB NOT NULL DEFAULT '[]',
    "suggestions" JSONB NOT NULL DEFAULT '[]',
    "originType" TEXT NOT NULL DEFAULT 'manual',
    "originMetadata" JSONB NOT NULL DEFAULT '{}',
    "sourceSnapshotHash" TEXT NOT NULL DEFAULT '',
    "createIdempotencyKey" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpProductionDemand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpManufacturingVoucher" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "productionDemandId" TEXT,
    "voucherNumber" TEXT NOT NULL,
    "voucherType" TEXT NOT NULL DEFAULT 'manufacturing',
    "businessDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "batchNumber" TEXT NOT NULL,
    "materialLines" JSONB NOT NULL DEFAULT '[]',
    "outputLines" JSONB NOT NULL DEFAULT '[]',
    "laborLines" JSONB NOT NULL DEFAULT '[]',
    "resourceLines" JSONB NOT NULL DEFAULT '[]',
    "overheadLines" JSONB NOT NULL DEFAULT '[]',
    "subcontractLines" JSONB NOT NULL DEFAULT '[]',
    "recoveryCredits" JSONB NOT NULL DEFAULT '[]',
    "qaDisposition" JSONB NOT NULL DEFAULT '{}',
    "materialValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "conversionValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "recoveryValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "actualCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "originType" TEXT NOT NULL DEFAULT 'manual',
    "originMetadata" JSONB NOT NULL DEFAULT '{}',
    "sourceSnapshotHash" TEXT NOT NULL DEFAULT '',
    "createIdempotencyKey" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpManufacturingVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpBatchCost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "productionDemandId" TEXT,
    "manufacturingVoucherId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "materialCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "laborCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "machineCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "overheadCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "subcontractCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "recoveryCredits" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "actualCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outputQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "costingMethod" TEXT NOT NULL DEFAULT 'actual',
    "calculationSnapshot" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sourceSnapshotHash" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpBatchCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpTaxDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "documentKind" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "providerReference" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "supplierGstin" TEXT NOT NULL DEFAULT '',
    "recipientGstin" TEXT NOT NULL DEFAULT '',
    "documentType" TEXT NOT NULL DEFAULT '',
    "documentNumber" TEXT NOT NULL DEFAULT '',
    "documentDate" DATE,
    "irn" TEXT NOT NULL DEFAULT '',
    "acknowledgementNumber" TEXT NOT NULL DEFAULT '',
    "acknowledgementAt" TIMESTAMP(3),
    "signedPayload" JSONB NOT NULL DEFAULT '{}',
    "submittedPayload" JSONB NOT NULL DEFAULT '{}',
    "qrData" TEXT NOT NULL DEFAULT '',
    "transporter" JSONB NOT NULL DEFAULT '{}',
    "vehicle" JSONB NOT NULL DEFAULT '{}',
    "validUntil" TIMESTAMP(3),
    "cancellation" JSONB NOT NULL DEFAULT '{}',
    "reconciliation" JSONB NOT NULL DEFAULT '{}',
    "itcStatus" TEXT NOT NULL DEFAULT 'pending',
    "ruleProfileVersion" TEXT NOT NULL DEFAULT '',
    "evidenceHash" TEXT NOT NULL DEFAULT '',
    "createIdempotencyKey" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpTaxDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpBankReconciliation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "statementReference" TEXT NOT NULL,
    "statementFrom" DATE NOT NULL,
    "statementTo" DATE NOT NULL,
    "openingBalance" DECIMAL(18,2) NOT NULL,
    "closingBalance" DECIMAL(18,2) NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "matchedTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unmatchedTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "createIdempotencyKey" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpBankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "acquisitionDate" DATE NOT NULL,
    "capitalizationDate" DATE,
    "acquisitionCost" DECIMAL(18,2) NOT NULL,
    "residualValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "depreciationMethod" TEXT NOT NULL DEFAULT 'wdv',
    "usefulLifeMonths" INTEGER NOT NULL,
    "depreciationRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "accumulatedDepreciation" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netBookValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "location" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'under_construction',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "disposedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpBudget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "budgetCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimensionType" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvalState" TEXT NOT NULL DEFAULT 'pending',
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT,
    "sourceService" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "destinationService" TEXT NOT NULL,
    "destinationType" TEXT NOT NULL,
    "destinationId" TEXT,
    "correlationId" TEXT NOT NULL,
    "sourceSnapshotHash" TEXT NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'unlinked',
    "conflictReason" TEXT NOT NULL DEFAULT '',
    "lastEventAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationOutboxEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT,
    "serviceId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "correlationId" TEXT NOT NULL,
    "causationId" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationInboxReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT,
    "consumer" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationInboxReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'local_customer',
    "sourceReference" TEXT NOT NULL DEFAULT '',
    "sourceLinkId" TEXT,
    "legacySalesOrderId" TEXT,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL DEFAULT '',
    "productCode" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'units',
    "dueDate" DATE,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "requirements" JSONB NOT NULL DEFAULT '{}',
    "originMetadata" JSONB NOT NULL DEFAULT '{}',
    "sourceSnapshotHash" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ready_to_plan',
    "createIdempotencyKey" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalOrder_pkey" PRIMARY KEY ("id")
);

-- Additive company cutover: every existing group tenant receives one company,
-- one current Indian financial year, and monthly accounting periods. Opening
-- balances remain an explicit reviewed import; this migration invents none.
INSERT INTO "LegalEntity" (
  "id", "organizationId", "code", "legalName", "countryCode", "baseCurrency",
  "fiscalYearStartMonth", "status", "createdAt", "updatedAt"
)
SELECT
  'le_' || md5(o."id"), o."id", 'PRIMARY', o."name", 'IN', 'INR', 4,
  'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
;

INSERT INTO "FinancialYear" (
  "id", "organizationId", "legalEntityId", "code", "startsOn", "endsOn",
  "status", "createdAt", "updatedAt"
)
SELECT
  'fy_' || md5(le."organizationId" || ':2026-27'), le."organizationId", le."id",
  '2026-27', DATE '2026-04-01', DATE '2027-03-31', 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "LegalEntity" le
WHERE le."code" = 'PRIMARY'
;

WITH account_seed("code", "name", "accountType") AS (
  VALUES
    ('1000', 'Cash', 'asset'), ('1010', 'Bank', 'asset'), ('1100', 'Trade receivables', 'asset'),
    ('1200', 'Raw material inventory', 'asset'), ('1210', 'Work in progress', 'asset'),
    ('1220', 'Finished goods inventory', 'asset'), ('1300', 'GST input credit', 'asset'),
    ('2000', 'Trade payables', 'liability'), ('2100', 'GST output payable', 'liability'),
    ('3000', 'Retained earnings', 'equity'), ('4000', 'Sales', 'income'),
    ('5000', 'Purchases and material consumption', 'expense'), ('5100', 'Cost of goods sold', 'expense'),
    ('5200', 'Direct labour', 'expense'), ('5300', 'Machine and factory overhead', 'expense')
)
INSERT INTO "ErpAccount" (
  "id", "organizationId", "legalEntityId", "code", "name", "accountType", "currency", "createdAt", "updatedAt"
)
SELECT
  'acct_' || md5(le."id" || ':' || account_seed."code"), le."organizationId", le."id",
  account_seed."code", account_seed."name", account_seed."accountType", le."baseCurrency",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "LegalEntity" le
CROSS JOIN account_seed
WHERE le."code" = 'PRIMARY';

INSERT INTO "AccountingPeriod" (
  "id", "organizationId", "legalEntityId", "financialYearId", "periodNumber",
  "name", "startsOn", "endsOn", "status", "createdAt", "updatedAt"
)
SELECT
  'ap_' || md5(fy."id" || ':' || gs::text), fy."organizationId", fy."legalEntityId", fy."id", gs,
  to_char((DATE '2026-04-01' + ((gs - 1) || ' months')::interval), 'Mon YYYY'),
  (DATE '2026-04-01' + ((gs - 1) || ' months')::interval)::date,
  ((DATE '2026-04-01' + (gs || ' months')::interval) - INTERVAL '1 day')::date,
  'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "FinancialYear" fy
CROSS JOIN generate_series(1, 12) AS gs
WHERE fy."code" = '2026-27'
;

-- Seed a MesaERP-specific owner role and explicitly grant every current
-- MesaERP permission. Platform Owner/Administrator memberships receive a
-- company-scoped assignment, but still need an explicit service entitlement.
INSERT INTO "Role" (
  "id", "organizationId", "name", "screens", "isAdmin", "isSystem",
  "version", "createdAt", "updatedAt"
)
SELECT
  'role_mesaerp_' || md5(o."id"), o."id", 'MesaERP Owner', '[]'::jsonb,
  false, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
ON CONFLICT ("organizationId", "name") DO NOTHING;

INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId", "effect", "createdAt")
SELECT
  'rp_' || md5(r."id" || ':' || p."id"), r."organizationId", r."id", p."id", 'allow', CURRENT_TIMESTAMP
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."name" = 'MesaERP Owner' AND p."serviceId" = 'mesaerp'
;

INSERT INTO "RoleAssignment" (
  "id", "organizationId", "membershipId", "roleId", "serviceId", "legalEntityId",
  "status", "createdAt", "updatedAt"
)
SELECT
  'ra_' || md5(m."id" || ':' || le."id"), m."organizationId", m."id", r."id",
  'mesaerp', le."id", 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Membership" m
JOIN "Role" r ON r."organizationId" = m."organizationId" AND r."name" = 'MesaERP Owner'
JOIN "LegalEntity" le ON le."organizationId" = m."organizationId" AND le."code" = 'PRIMARY'
WHERE m."role" IN ('Owner', 'Administrator', 'Admin', 'Management') AND m."status" <> 'inactive'
;

-- Convert the current MesaOps commercial orders into MesaOps-owned operational
-- demand. IDs and references stay stable; planning can now also accept orders
-- that have no legacy sales row at all.
INSERT INTO "OperationalOrder" (
  "id", "organizationId", "orderNumber", "sourceType", "sourceReference",
  "legacySalesOrderId", "customerId", "customerName", "productName", "quantity",
  "uom", "dueDate", "priority", "requirements", "originMetadata", "status",
  "createdAt", "updatedAt"
)
SELECT
  so."id", so."organizationId", so."soNumber", 'local_customer', so."soNumber",
  so."id", so."customerId", c."name", so."product", so."quantity"::numeric(18,6),
  'units',
  CASE
    WHEN so."deliveryDate" ~ '^\d{4}-\d{2}-\d{2}' THEN substring(so."deliveryDate" from 1 for 10)::date
    ELSE NULL
  END,
  so."priority", jsonb_build_object('specialInstructions', so."specialInstructions"),
  jsonb_build_object('migratedFrom', 'SalesOrder', 'legacyStatus', so."status"),
  CASE so."status"
    WHEN 'planned' THEN 'planned'
    WHEN 'dispatched' THEN 'dispatched'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'ready_to_plan'
  END,
  so."createdAt", so."updatedAt"
FROM "SalesOrder" so
JOIN "Customer" c ON c."id" = so."customerId"
;

UPDATE "ProductionPlan"
SET "operationalOrderId" = "salesOrderId"
WHERE "operationalOrderId" IS NULL;

UPDATE "ProductionPlan" pp
SET "plannedQuantity" = oo."quantity"
FROM "OperationalOrder" oo
WHERE oo."id" = pp."operationalOrderId" AND pp."plannedQuantity" IS NULL;

ALTER TABLE "ProductionPlan" ALTER COLUMN "operationalOrderId" SET NOT NULL;
ALTER TABLE "ProductionPlan" ALTER COLUMN "plannedQuantity" SET NOT NULL;

UPDATE "DispatchRecord"
SET "operationalOrderId" = "salesOrderId"
WHERE "operationalOrderId" IS NULL;

ALTER TABLE "DispatchRecord" ALTER COLUMN "operationalOrderId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Permission_serviceId_idx" ON "Permission"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_serviceId_key_key" ON "Permission"("serviceId", "key");

-- CreateIndex
CREATE INDEX "LegalEntity_organizationId_idx" ON "LegalEntity"("organizationId");

-- CreateIndex
CREATE INDEX "LegalEntity_organizationId_status_idx" ON "LegalEntity"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntity_organizationId_code_key" ON "LegalEntity"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntity_organizationId_createIdempotencyKey_key" ON "LegalEntity"("organizationId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "FinancialYear_organizationId_idx" ON "FinancialYear"("organizationId");

-- CreateIndex
CREATE INDEX "FinancialYear_legalEntityId_status_idx" ON "FinancialYear"("legalEntityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYear_organizationId_legalEntityId_code_key" ON "FinancialYear"("organizationId", "legalEntityId", "code");

-- CreateIndex
CREATE INDEX "AccountingPeriod_organizationId_idx" ON "AccountingPeriod"("organizationId");

-- CreateIndex
CREATE INDEX "AccountingPeriod_legalEntityId_startsOn_endsOn_idx" ON "AccountingPeriod"("legalEntityId", "startsOn", "endsOn");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_organizationId_legalEntityId_financialYear_key" ON "AccountingPeriod"("organizationId", "legalEntityId", "financialYearId", "periodNumber");

-- CreateIndex
CREATE INDEX "RolePermission_organizationId_idx" ON "RolePermission"("organizationId");

-- CreateIndex
CREATE INDEX "RolePermission_roleId_idx" ON "RolePermission"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_organizationId_roleId_permissionId_key" ON "RolePermission"("organizationId", "roleId", "permissionId");

-- CreateIndex
CREATE INDEX "RoleAssignment_organizationId_idx" ON "RoleAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "RoleAssignment_membershipId_serviceId_status_idx" ON "RoleAssignment"("membershipId", "serviceId", "status");

-- CreateIndex
CREATE INDEX "RoleAssignment_legalEntityId_idx" ON "RoleAssignment"("legalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleAssignment_organizationId_membershipId_roleId_serviceId_key" ON "RoleAssignment"("organizationId", "membershipId", "roleId", "serviceId", "legalEntityId", "plantCode", "warehouseId");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_organizationId_idx" ON "ApprovalPolicy"("organizationId");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_legalEntityId_action_active_idx" ON "ApprovalPolicy"("legalEntityId", "action", "active");

-- CreateIndex
CREATE INDEX "Delegation_organizationId_idx" ON "Delegation"("organizationId");

-- CreateIndex
CREATE INDEX "Delegation_fromMembershipId_status_idx" ON "Delegation"("fromMembershipId", "status");

-- CreateIndex
CREATE INDEX "Delegation_toMembershipId_status_idx" ON "Delegation"("toMembershipId", "status");

-- CreateIndex
CREATE INDEX "ErpAccount_organizationId_idx" ON "ErpAccount"("organizationId");

-- CreateIndex
CREATE INDEX "ErpAccount_legalEntityId_accountType_idx" ON "ErpAccount"("legalEntityId", "accountType");

-- CreateIndex
CREATE UNIQUE INDEX "ErpAccount_organizationId_legalEntityId_code_key" ON "ErpAccount"("organizationId", "legalEntityId", "code");

-- CreateIndex
CREATE INDEX "ErpVendor_organizationId_idx" ON "ErpVendor"("organizationId");

-- CreateIndex
CREATE INDEX "ErpVendor_legalEntityId_lifecycleStatus_idx" ON "ErpVendor"("legalEntityId", "lifecycleStatus");

-- CreateIndex
CREATE INDEX "ErpVendor_legalEntityId_gstin_idx" ON "ErpVendor"("legalEntityId", "gstin");

-- CreateIndex
CREATE UNIQUE INDEX "ErpVendor_organizationId_legalEntityId_vendorCode_key" ON "ErpVendor"("organizationId", "legalEntityId", "vendorCode");

-- CreateIndex
CREATE INDEX "ErpVendorBankAccount_organizationId_idx" ON "ErpVendorBankAccount"("organizationId");

-- CreateIndex
CREATE INDEX "ErpVendorBankAccount_vendorId_status_idx" ON "ErpVendorBankAccount"("vendorId", "status");

-- CreateIndex
CREATE INDEX "ErpVendorDocument_organizationId_idx" ON "ErpVendorDocument"("organizationId");

-- CreateIndex
CREATE INDEX "ErpVendorDocument_vendorId_expiresOn_idx" ON "ErpVendorDocument"("vendorId", "expiresOn");

-- CreateIndex
CREATE INDEX "SupplierPortalUser_organizationId_idx" ON "SupplierPortalUser"("organizationId");

-- CreateIndex
CREATE INDEX "SupplierPortalUser_vendorId_status_idx" ON "SupplierPortalUser"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPortalUser_organizationId_legalEntityId_vendorId_em_key" ON "SupplierPortalUser"("organizationId", "legalEntityId", "vendorId", "email");

-- CreateIndex
CREATE INDEX "ErpCustomer_organizationId_idx" ON "ErpCustomer"("organizationId");

-- CreateIndex
CREATE INDEX "ErpCustomer_legalEntityId_gstin_idx" ON "ErpCustomer"("legalEntityId", "gstin");

-- CreateIndex
CREATE UNIQUE INDEX "ErpCustomer_organizationId_legalEntityId_customerCode_key" ON "ErpCustomer"("organizationId", "legalEntityId", "customerCode");

-- CreateIndex
CREATE INDEX "ErpItem_organizationId_idx" ON "ErpItem"("organizationId");

-- CreateIndex
CREATE INDEX "ErpItem_legalEntityId_active_idx" ON "ErpItem"("legalEntityId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ErpItem_organizationId_legalEntityId_itemCode_key" ON "ErpItem"("organizationId", "legalEntityId", "itemCode");

-- CreateIndex
CREATE INDEX "ErpWarehouse_organizationId_idx" ON "ErpWarehouse"("organizationId");

-- CreateIndex
CREATE INDEX "ErpWarehouse_legalEntityId_active_idx" ON "ErpWarehouse"("legalEntityId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ErpWarehouse_organizationId_legalEntityId_code_key" ON "ErpWarehouse"("organizationId", "legalEntityId", "code");

-- CreateIndex
CREATE INDEX "ErpNumberSeries_organizationId_idx" ON "ErpNumberSeries"("organizationId");

-- CreateIndex
CREATE INDEX "ErpIdempotencyRecord_organizationId_idx" ON "ErpIdempotencyRecord"("organizationId");

-- CreateIndex
CREATE INDEX "ErpIdempotencyRecord_legalEntityId_createdAt_idx" ON "ErpIdempotencyRecord"("legalEntityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErpIdempotencyRecord_organizationId_scope_key_key" ON "ErpIdempotencyRecord"("organizationId", "scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ErpNumberSeries_organizationId_legalEntityId_financialYearI_key" ON "ErpNumberSeries"("organizationId", "legalEntityId", "financialYearId", "documentType");

-- CreateIndex
CREATE INDEX "ErpDocument_organizationId_idx" ON "ErpDocument"("organizationId");

-- CreateIndex
CREATE INDEX "ErpDocument_legalEntityId_documentType_status_idx" ON "ErpDocument"("legalEntityId", "documentType", "status");

-- CreateIndex
CREATE INDEX "ErpDocument_vendorId_documentDate_idx" ON "ErpDocument"("vendorId", "documentDate");

-- CreateIndex
CREATE INDEX "ErpDocument_customerId_documentDate_idx" ON "ErpDocument"("customerId", "documentDate");

-- CreateIndex
CREATE UNIQUE INDEX "ErpDocument_organizationId_legalEntityId_financialYearId_do_key" ON "ErpDocument"("organizationId", "legalEntityId", "financialYearId", "documentType", "documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErpDocument_organizationId_legalEntityId_createIdempotencyK_key" ON "ErpDocument"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "ErpDocumentLine_organizationId_idx" ON "ErpDocumentLine"("organizationId");

-- CreateIndex
CREATE INDEX "ErpDocumentLine_documentId_idx" ON "ErpDocumentLine"("documentId");

-- CreateIndex
CREATE INDEX "ErpDocumentLine_itemId_idx" ON "ErpDocumentLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpDocumentLine_organizationId_documentId_lineNumber_key" ON "ErpDocumentLine"("organizationId", "documentId", "lineNumber");

-- CreateIndex
CREATE INDEX "ErpDocumentLink_organizationId_idx" ON "ErpDocumentLink"("organizationId");

-- CreateIndex
CREATE INDEX "ErpDocumentLink_fromDocumentId_idx" ON "ErpDocumentLink"("fromDocumentId");

-- CreateIndex
CREATE INDEX "ErpDocumentLink_toDocumentId_idx" ON "ErpDocumentLink"("toDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpDocumentLink_organizationId_fromDocumentId_toDocumentId__key" ON "ErpDocumentLink"("organizationId", "fromDocumentId", "toDocumentId", "relationship");

-- CreateIndex
CREATE INDEX "ErpMatchCase_organizationId_idx" ON "ErpMatchCase"("organizationId");

-- CreateIndex
CREATE INDEX "ErpMatchCase_vendorId_status_idx" ON "ErpMatchCase"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpMatchCase_organizationId_supplierInvoiceId_key" ON "ErpMatchCase"("organizationId", "supplierInvoiceId");

-- CreateIndex
CREATE INDEX "ErpVoucher_organizationId_idx" ON "ErpVoucher"("organizationId");

-- CreateIndex
CREATE INDEX "ErpVoucher_legalEntityId_businessDate_status_idx" ON "ErpVoucher"("legalEntityId", "businessDate", "status");

-- CreateIndex
CREATE INDEX "ErpVoucher_sourceDocumentId_idx" ON "ErpVoucher"("sourceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpVoucher_organizationId_legalEntityId_financialYearId_vou_key" ON "ErpVoucher"("organizationId", "legalEntityId", "financialYearId", "voucherType", "voucherNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErpVoucher_organizationId_legalEntityId_createIdempotencyKe_key" ON "ErpVoucher"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "ErpVoucherLine_organizationId_idx" ON "ErpVoucherLine"("organizationId");

-- CreateIndex
CREATE INDEX "ErpVoucherLine_voucherId_idx" ON "ErpVoucherLine"("voucherId");

-- CreateIndex
CREATE INDEX "ErpVoucherLine_accountId_idx" ON "ErpVoucherLine"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpVoucherLine_organizationId_voucherId_lineNumber_key" ON "ErpVoucherLine"("organizationId", "voucherId", "lineNumber");

-- CreateIndex
CREATE INDEX "ErpStockMovement_organizationId_idx" ON "ErpStockMovement"("organizationId");

-- CreateIndex
CREATE INDEX "ErpStockMovement_legalEntityId_itemId_warehouseId_businessD_idx" ON "ErpStockMovement"("legalEntityId", "itemId", "warehouseId", "businessDate");

-- CreateIndex
CREATE INDEX "ErpStockMovement_batchNumber_idx" ON "ErpStockMovement"("batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErpStockMovement_organizationId_legalEntityId_idempotencyKe_key" ON "ErpStockMovement"("organizationId", "legalEntityId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ErpProductionDemand_organizationId_idx" ON "ErpProductionDemand"("organizationId");

-- CreateIndex
CREATE INDEX "ErpProductionDemand_legalEntityId_status_requiredOn_idx" ON "ErpProductionDemand"("legalEntityId", "status", "requiredOn");

-- CreateIndex
CREATE UNIQUE INDEX "ErpProductionDemand_organizationId_legalEntityId_financialY_key" ON "ErpProductionDemand"("organizationId", "legalEntityId", "financialYearId", "demandNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErpProductionDemand_organizationId_legalEntityId_createIdem_key" ON "ErpProductionDemand"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "ErpManufacturingVoucher_organizationId_idx" ON "ErpManufacturingVoucher"("organizationId");

-- CreateIndex
CREATE INDEX "ErpManufacturingVoucher_legalEntityId_status_businessDate_idx" ON "ErpManufacturingVoucher"("legalEntityId", "status", "businessDate");

-- CreateIndex
CREATE INDEX "ErpManufacturingVoucher_batchNumber_idx" ON "ErpManufacturingVoucher"("batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErpManufacturingVoucher_organizationId_legalEntityId_financ_key" ON "ErpManufacturingVoucher"("organizationId", "legalEntityId", "financialYearId", "voucherNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErpManufacturingVoucher_organizationId_legalEntityId_create_key" ON "ErpManufacturingVoucher"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ErpBatchCost_manufacturingVoucherId_key" ON "ErpBatchCost"("manufacturingVoucherId");

-- CreateIndex
CREATE INDEX "ErpBatchCost_organizationId_idx" ON "ErpBatchCost"("organizationId");

-- CreateIndex
CREATE INDEX "ErpBatchCost_legalEntityId_status_idx" ON "ErpBatchCost"("legalEntityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpBatchCost_organizationId_legalEntityId_batchNumber_key" ON "ErpBatchCost"("organizationId", "legalEntityId", "batchNumber");

-- CreateIndex
CREATE INDEX "ErpTaxDocument_organizationId_idx" ON "ErpTaxDocument"("organizationId");

-- CreateIndex
CREATE INDEX "ErpTaxDocument_legalEntityId_documentKind_status_idx" ON "ErpTaxDocument"("legalEntityId", "documentKind", "status");

-- CreateIndex
CREATE INDEX "ErpTaxDocument_legalEntityId_irn_idx" ON "ErpTaxDocument"("legalEntityId", "irn");

-- CreateIndex
CREATE INDEX "ErpTaxDocument_legalEntityId_supplierGstin_documentNumber_idx" ON "ErpTaxDocument"("legalEntityId", "supplierGstin", "documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErpTaxDocument_organizationId_legalEntityId_createIdempoten_key" ON "ErpTaxDocument"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "ErpBankReconciliation_organizationId_idx" ON "ErpBankReconciliation"("organizationId");

-- CreateIndex
CREATE INDEX "ErpBankReconciliation_legalEntityId_status_idx" ON "ErpBankReconciliation"("legalEntityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpBankReconciliation_organizationId_legalEntityId_statemen_key" ON "ErpBankReconciliation"("organizationId", "legalEntityId", "statementReference");

-- CreateIndex
CREATE UNIQUE INDEX "ErpBankReconciliation_organizationId_legalEntityId_createId_key" ON "ErpBankReconciliation"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "ErpAsset_organizationId_idx" ON "ErpAsset"("organizationId");

-- CreateIndex
CREATE INDEX "ErpAsset_legalEntityId_status_idx" ON "ErpAsset"("legalEntityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpAsset_organizationId_legalEntityId_assetCode_key" ON "ErpAsset"("organizationId", "legalEntityId", "assetCode");

-- CreateIndex
CREATE INDEX "ErpBudget_organizationId_idx" ON "ErpBudget"("organizationId");

-- CreateIndex
CREATE INDEX "ErpBudget_legalEntityId_status_idx" ON "ErpBudget"("legalEntityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpBudget_organizationId_legalEntityId_financialYearId_budg_key" ON "ErpBudget"("organizationId", "legalEntityId", "financialYearId", "budgetCode");

-- CreateIndex
CREATE INDEX "SourceLink_organizationId_idx" ON "SourceLink"("organizationId");

-- CreateIndex
CREATE INDEX "SourceLink_destinationService_destinationType_destinationId_idx" ON "SourceLink"("destinationService", "destinationType", "destinationId");

-- CreateIndex
CREATE INDEX "SourceLink_state_idx" ON "SourceLink"("state");

-- CreateIndex
CREATE UNIQUE INDEX "SourceLink_organizationId_sourceService_sourceType_sourceId_key" ON "SourceLink"("organizationId", "sourceService", "sourceType", "sourceId", "destinationService", "destinationType");

-- CreateIndex
CREATE UNIQUE INDEX "SourceLink_organizationId_correlationId_key" ON "SourceLink"("organizationId", "correlationId");

-- CreateIndex
CREATE INDEX "IntegrationOutboxEvent_organizationId_idx" ON "IntegrationOutboxEvent"("organizationId");

-- CreateIndex
CREATE INDEX "IntegrationOutboxEvent_publishedAt_nextAttemptAt_idx" ON "IntegrationOutboxEvent"("publishedAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "IntegrationOutboxEvent_aggregateType_aggregateId_idx" ON "IntegrationOutboxEvent"("aggregateType", "aggregateId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationOutboxEvent_organizationId_serviceId_id_key" ON "IntegrationOutboxEvent"("organizationId", "serviceId", "id");

-- CreateIndex
CREATE INDEX "IntegrationInboxReceipt_organizationId_idx" ON "IntegrationInboxReceipt"("organizationId");

-- CreateIndex
CREATE INDEX "IntegrationInboxReceipt_consumer_status_idx" ON "IntegrationInboxReceipt"("consumer", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationInboxReceipt_organizationId_consumer_eventId_key" ON "IntegrationInboxReceipt"("organizationId", "consumer", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalOrder_legacySalesOrderId_key" ON "OperationalOrder"("legacySalesOrderId");

-- CreateIndex
CREATE INDEX "OperationalOrder_organizationId_idx" ON "OperationalOrder"("organizationId");

-- CreateIndex
CREATE INDEX "OperationalOrder_organizationId_sourceType_status_idx" ON "OperationalOrder"("organizationId", "sourceType", "status");

-- CreateIndex
CREATE INDEX "OperationalOrder_sourceLinkId_idx" ON "OperationalOrder"("sourceLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalOrder_organizationId_orderNumber_key" ON "OperationalOrder"("organizationId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalOrder_organizationId_createIdempotencyKey_key" ON "OperationalOrder"("organizationId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "ProductionPlan_operationalOrderId_idx" ON "ProductionPlan"("operationalOrderId");

-- CreateIndex
CREATE INDEX "DispatchRecord_operationalOrderId_idx" ON "DispatchRecord"("operationalOrderId");

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_operationalOrderId_fkey" FOREIGN KEY ("operationalOrderId") REFERENCES "OperationalOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_operationalOrderId_fkey" FOREIGN KEY ("operationalOrderId") REFERENCES "OperationalOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialYear" ADD CONSTRAINT "FinancialYear_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialYear" ADD CONSTRAINT "FinancialYear_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_fromMembershipId_fkey" FOREIGN KEY ("fromMembershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_toMembershipId_fkey" FOREIGN KEY ("toMembershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAccount" ADD CONSTRAINT "ErpAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAccount" ADD CONSTRAINT "ErpAccount_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAccount" ADD CONSTRAINT "ErpAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ErpAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendor" ADD CONSTRAINT "ErpVendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendor" ADD CONSTRAINT "ErpVendor_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorBankAccount" ADD CONSTRAINT "ErpVendorBankAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorBankAccount" ADD CONSTRAINT "ErpVendorBankAccount_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorBankAccount" ADD CONSTRAINT "ErpVendorBankAccount_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorDocument" ADD CONSTRAINT "ErpVendorDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorDocument" ADD CONSTRAINT "ErpVendorDocument_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorDocument" ADD CONSTRAINT "ErpVendorDocument_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalUser" ADD CONSTRAINT "SupplierPortalUser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalUser" ADD CONSTRAINT "SupplierPortalUser_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalUser" ADD CONSTRAINT "SupplierPortalUser_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalUser" ADD CONSTRAINT "SupplierPortalUser_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpCustomer" ADD CONSTRAINT "ErpCustomer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpCustomer" ADD CONSTRAINT "ErpCustomer_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpItem" ADD CONSTRAINT "ErpItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpItem" ADD CONSTRAINT "ErpItem_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpWarehouse" ADD CONSTRAINT "ErpWarehouse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpWarehouse" ADD CONSTRAINT "ErpWarehouse_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpNumberSeries" ADD CONSTRAINT "ErpNumberSeries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpNumberSeries" ADD CONSTRAINT "ErpNumberSeries_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpNumberSeries" ADD CONSTRAINT "ErpNumberSeries_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpIdempotencyRecord" ADD CONSTRAINT "ErpIdempotencyRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpIdempotencyRecord" ADD CONSTRAINT "ErpIdempotencyRecord_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocument" ADD CONSTRAINT "ErpDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocument" ADD CONSTRAINT "ErpDocument_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocument" ADD CONSTRAINT "ErpDocument_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocument" ADD CONSTRAINT "ErpDocument_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocument" ADD CONSTRAINT "ErpDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "ErpCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocument" ADD CONSTRAINT "ErpDocument_parentDocumentId_fkey" FOREIGN KEY ("parentDocumentId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocumentLine" ADD CONSTRAINT "ErpDocumentLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocumentLine" ADD CONSTRAINT "ErpDocumentLine_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocumentLine" ADD CONSTRAINT "ErpDocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocumentLine" ADD CONSTRAINT "ErpDocumentLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ErpItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocumentLine" ADD CONSTRAINT "ErpDocumentLine_sourceLineId_fkey" FOREIGN KEY ("sourceLineId") REFERENCES "ErpDocumentLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocumentLink" ADD CONSTRAINT "ErpDocumentLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocumentLink" ADD CONSTRAINT "ErpDocumentLink_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocumentLink" ADD CONSTRAINT "ErpDocumentLink_fromDocumentId_fkey" FOREIGN KEY ("fromDocumentId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpDocumentLink" ADD CONSTRAINT "ErpDocumentLink_toDocumentId_fkey" FOREIGN KEY ("toDocumentId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpMatchCase" ADD CONSTRAINT "ErpMatchCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpMatchCase" ADD CONSTRAINT "ErpMatchCase_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpMatchCase" ADD CONSTRAINT "ErpMatchCase_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpMatchCase" ADD CONSTRAINT "ErpMatchCase_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpMatchCase" ADD CONSTRAINT "ErpMatchCase_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpMatchCase" ADD CONSTRAINT "ErpMatchCase_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpMatchCase" ADD CONSTRAINT "ErpMatchCase_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVoucher" ADD CONSTRAINT "ErpVoucher_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVoucher" ADD CONSTRAINT "ErpVoucher_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVoucher" ADD CONSTRAINT "ErpVoucher_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVoucher" ADD CONSTRAINT "ErpVoucher_accountingPeriodId_fkey" FOREIGN KEY ("accountingPeriodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVoucher" ADD CONSTRAINT "ErpVoucher_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVoucher" ADD CONSTRAINT "ErpVoucher_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "ErpVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVoucherLine" ADD CONSTRAINT "ErpVoucherLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVoucherLine" ADD CONSTRAINT "ErpVoucherLine_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVoucherLine" ADD CONSTRAINT "ErpVoucherLine_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "ErpVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVoucherLine" ADD CONSTRAINT "ErpVoucherLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ErpAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpStockMovement" ADD CONSTRAINT "ErpStockMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpStockMovement" ADD CONSTRAINT "ErpStockMovement_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpStockMovement" ADD CONSTRAINT "ErpStockMovement_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpStockMovement" ADD CONSTRAINT "ErpStockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ErpItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpStockMovement" ADD CONSTRAINT "ErpStockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "ErpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpStockMovement" ADD CONSTRAINT "ErpStockMovement_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpStockMovement" ADD CONSTRAINT "ErpStockMovement_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "ErpVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpProductionDemand" ADD CONSTRAINT "ErpProductionDemand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpProductionDemand" ADD CONSTRAINT "ErpProductionDemand_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpProductionDemand" ADD CONSTRAINT "ErpProductionDemand_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpProductionDemand" ADD CONSTRAINT "ErpProductionDemand_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ErpItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpManufacturingVoucher" ADD CONSTRAINT "ErpManufacturingVoucher_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpManufacturingVoucher" ADD CONSTRAINT "ErpManufacturingVoucher_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpManufacturingVoucher" ADD CONSTRAINT "ErpManufacturingVoucher_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpManufacturingVoucher" ADD CONSTRAINT "ErpManufacturingVoucher_productionDemandId_fkey" FOREIGN KEY ("productionDemandId") REFERENCES "ErpProductionDemand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpBatchCost" ADD CONSTRAINT "ErpBatchCost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpBatchCost" ADD CONSTRAINT "ErpBatchCost_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpBatchCost" ADD CONSTRAINT "ErpBatchCost_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpBatchCost" ADD CONSTRAINT "ErpBatchCost_productionDemandId_fkey" FOREIGN KEY ("productionDemandId") REFERENCES "ErpProductionDemand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpBatchCost" ADD CONSTRAINT "ErpBatchCost_manufacturingVoucherId_fkey" FOREIGN KEY ("manufacturingVoucherId") REFERENCES "ErpManufacturingVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpTaxDocument" ADD CONSTRAINT "ErpTaxDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpTaxDocument" ADD CONSTRAINT "ErpTaxDocument_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpTaxDocument" ADD CONSTRAINT "ErpTaxDocument_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpTaxDocument" ADD CONSTRAINT "ErpTaxDocument_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpBankReconciliation" ADD CONSTRAINT "ErpBankReconciliation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpBankReconciliation" ADD CONSTRAINT "ErpBankReconciliation_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAsset" ADD CONSTRAINT "ErpAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAsset" ADD CONSTRAINT "ErpAsset_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAsset" ADD CONSTRAINT "ErpAsset_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpBudget" ADD CONSTRAINT "ErpBudget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpBudget" ADD CONSTRAINT "ErpBudget_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpBudget" ADD CONSTRAINT "ErpBudget_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceLink" ADD CONSTRAINT "SourceLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceLink" ADD CONSTRAINT "SourceLink_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationOutboxEvent" ADD CONSTRAINT "IntegrationOutboxEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationOutboxEvent" ADD CONSTRAINT "IntegrationOutboxEvent_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationInboxReceipt" ADD CONSTRAINT "IntegrationInboxReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationInboxReceipt" ADD CONSTRAINT "IntegrationInboxReceipt_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalOrder" ADD CONSTRAINT "OperationalOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalOrder" ADD CONSTRAINT "OperationalOrder_sourceLinkId_fkey" FOREIGN KEY ("sourceLinkId") REFERENCES "SourceLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalOrder" ADD CONSTRAINT "OperationalOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalOrder" ADD CONSTRAINT "OperationalOrder_legacySalesOrderId_fkey" FOREIGN KEY ("legacySalesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Finance-grade invariants live in PostgreSQL as well as the API.
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_currency_check" CHECK ("baseCurrency" ~ '^[A-Z]{3}$');
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_fiscal_month_check" CHECK ("fiscalYearStartMonth" BETWEEN 1 AND 12);
ALTER TABLE "FinancialYear" ADD CONSTRAINT "FinancialYear_dates_check" CHECK ("endsOn" >= "startsOn");
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_dates_check" CHECK ("endsOn" >= "startsOn");
ALTER TABLE "ErpVendor" ADD CONSTRAINT "ErpVendor_lifecycle_check" CHECK ("lifecycleStatus" IN ('invited', 'onboarding', 'under_review', 'approved', 'conditionally_approved', 'suspended', 'blocked'));
ALTER TABLE "ErpItem" ADD CONSTRAINT "ErpItem_valuation_check" CHECK ("valuationMethod" IN ('moving_average', 'fifo'));
ALTER TABLE "ErpDocumentLine" ADD CONSTRAINT "ErpDocumentLine_values_check" CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "discountAmount" >= 0 AND "taxableAmount" >= 0 AND "taxRate" BETWEEN 0 AND 100 AND "taxAmount" >= 0 AND "lineTotal" >= 0);
ALTER TABLE "ErpVoucherLine" ADD CONSTRAINT "ErpVoucherLine_one_side_check" CHECK (
  (("baseDebit" > 0 AND "baseCredit" = 0) OR ("baseCredit" > 0 AND "baseDebit" = 0))
  AND (("transactionDebit" > 0 AND "transactionCredit" = 0) OR ("transactionCredit" > 0 AND "transactionDebit" = 0))
);
ALTER TABLE "ErpStockMovement" ADD CONSTRAINT "ErpStockMovement_quantity_nonzero" CHECK ("quantity" <> 0);
ALTER TABLE "ErpBatchCost" ADD CONSTRAINT "ErpBatchCost_formula_check" CHECK (
  "actualCost" = "materialCost" + "laborCost" + "machineCost" + "overheadCost" + "subcontractCost" - "recoveryCredits"
  AND "actualCost" >= 0 AND "outputQuantity" >= 0 AND "unitCost" >= 0
);
ALTER TABLE "OperationalOrder" ADD CONSTRAINT "OperationalOrder_source_check" CHECK ("sourceType" IN ('local_customer', 'internal', 'forecast', 'replenishment', 'trial', 'rework', 'import', 'mesaerp'));
ALTER TABLE "OperationalOrder" ADD CONSTRAINT "OperationalOrder_status_check" CHECK ("status" IN ('draft', 'ready_to_plan', 'partially_planned', 'planned', 'in_progress', 'qa', 'packed', 'dispatched', 'cancelled'));
ALTER TABLE "OperationalOrder" ADD CONSTRAINT "OperationalOrder_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_planned_quantity_positive" CHECK ("plannedQuantity" > 0);

CREATE UNIQUE INDEX "ErpTaxDocument_irn_unique" ON "ErpTaxDocument"("organizationId", "legalEntityId", "irn") WHERE "irn" <> '';
CREATE UNIQUE INDEX "ErpTaxDocument_outbound_identity_unique" ON "ErpTaxDocument"("organizationId", "legalEntityId", "recipientGstin", "documentType", "documentNumber", "financialYearId") WHERE "documentKind" = 'outbound_e_invoice';

CREATE OR REPLACE FUNCTION assert_erp_voucher_balanced() RETURNS trigger AS $$
DECLARE
  line_base_debit DECIMAL(18,2);
  line_base_credit DECIMAL(18,2);
  line_transaction_debit DECIMAL(18,2);
  line_transaction_credit DECIMAL(18,2);
BEGIN
  IF NEW."status" = 'posted' AND OLD."status" IS DISTINCT FROM 'posted' THEN
    SELECT COALESCE(SUM("baseDebit"), 0), COALESCE(SUM("baseCredit"), 0),
           COALESCE(SUM("transactionDebit"), 0), COALESCE(SUM("transactionCredit"), 0)
      INTO line_base_debit, line_base_credit, line_transaction_debit, line_transaction_credit
      FROM "ErpVoucherLine" WHERE "voucherId" = NEW."id";
    IF line_base_debit = 0 OR line_base_debit <> line_base_credit
       OR line_transaction_debit <> line_transaction_credit
       OR NEW."baseDebit" <> line_base_debit OR NEW."baseCredit" <> line_base_credit
       OR NEW."transactionDebit" <> line_transaction_debit OR NEW."transactionCredit" <> line_transaction_credit THEN
      RAISE EXCEPTION 'voucher debit and credit totals must balance before posting';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpVoucher_balance_before_post"
BEFORE UPDATE OF "status" ON "ErpVoucher"
FOR EACH ROW EXECUTE FUNCTION assert_erp_voucher_balanced();

CREATE OR REPLACE FUNCTION protect_posted_erp_voucher() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'posted vouchers are retained accounting evidence';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('posted', 'reversed') THEN
    IF NOT (
      OLD."status" = 'posted' AND NEW."status" = 'reversed'
      AND NEW."reversedAt" IS NOT NULL
      AND ROW(
        NEW."organizationId", NEW."legalEntityId", NEW."financialYearId", NEW."accountingPeriodId",
        NEW."voucherType", NEW."voucherNumber", NEW."businessDate", NEW."currency", NEW."exchangeRate",
        NEW."transactionDebit", NEW."transactionCredit", NEW."baseDebit", NEW."baseCredit", NEW."reference", NEW."narration",
        NEW."sourceDocumentId", NEW."dimensions", NEW."originType", NEW."originMetadata", NEW."sourceSnapshotHash",
        NEW."createIdempotencyKey", NEW."requestHash", NEW."submittedAt", NEW."approvedAt", NEW."postedAt",
        NEW."createdBy", NEW."approvedBy", NEW."postedBy", NEW."createdAt"
      ) IS NOT DISTINCT FROM ROW(
        OLD."organizationId", OLD."legalEntityId", OLD."financialYearId", OLD."accountingPeriodId",
        OLD."voucherType", OLD."voucherNumber", OLD."businessDate", OLD."currency", OLD."exchangeRate",
        OLD."transactionDebit", OLD."transactionCredit", OLD."baseDebit", OLD."baseCredit", OLD."reference", OLD."narration",
        OLD."sourceDocumentId", OLD."dimensions", OLD."originType", OLD."originMetadata", OLD."sourceSnapshotHash",
        OLD."createIdempotencyKey", OLD."requestHash", OLD."submittedAt", OLD."approvedAt", OLD."postedAt",
        OLD."createdBy", OLD."approvedBy", OLD."postedBy", OLD."createdAt"
      )
    ) THEN
      RAISE EXCEPTION 'posted vouchers are immutable; use a reversal or adjustment voucher';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpVoucher_protect_posted"
BEFORE UPDATE OR DELETE ON "ErpVoucher"
FOR EACH ROW EXECUTE FUNCTION protect_posted_erp_voucher();

CREATE OR REPLACE FUNCTION protect_posted_erp_voucher_line() RETURNS trigger AS $$
DECLARE parent_status TEXT;
BEGIN
  SELECT "status" INTO parent_status FROM "ErpVoucher" WHERE "id" = COALESCE(NEW."voucherId", OLD."voucherId");
  IF parent_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'posted voucher lines are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpVoucherLine_protect_posted"
BEFORE INSERT OR UPDATE OR DELETE ON "ErpVoucherLine"
FOR EACH ROW EXECUTE FUNCTION protect_posted_erp_voucher_line();

CREATE OR REPLACE FUNCTION protect_approved_batch_cost() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'approved' THEN
    RAISE EXCEPTION 'approved batch costs are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpBatchCost_protect_approved"
BEFORE UPDATE OR DELETE ON "ErpBatchCost"
FOR EACH ROW EXECUTE FUNCTION protect_approved_batch_cost();

-- Every business row remains group-tenant scoped even when workers process
-- events outside an HTTP request. Workers must set app.current_tenant first.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'LegalEntity', 'FinancialYear', 'AccountingPeriod', 'RolePermission', 'RoleAssignment',
    'ApprovalPolicy', 'Delegation', 'ErpAccount', 'ErpVendor', 'ErpVendorBankAccount',
    'ErpVendorDocument', 'SupplierPortalUser', 'ErpCustomer', 'ErpItem', 'ErpWarehouse',
    'ErpNumberSeries', 'ErpIdempotencyRecord', 'ErpDocument', 'ErpDocumentLine', 'ErpDocumentLink', 'ErpMatchCase',
    'ErpVoucher', 'ErpVoucherLine', 'ErpStockMovement', 'ErpProductionDemand',
    'ErpManufacturingVoucher', 'ErpBatchCost', 'ErpTaxDocument', 'ErpBankReconciliation',
    'ErpAsset', 'ErpBudget', 'SourceLink', 'IntegrationOutboxEvent',
    'IntegrationInboxReceipt', 'OperationalOrder'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_tenant'', true)) WITH CHECK ("organizationId" = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
