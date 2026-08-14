-- AlterTable
ALTER TABLE "ErpVendorDocument" ADD COLUMN     "createIdempotencyKey" TEXT,
ADD COLUMN     "requestHash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "submittedByPortalUserId" TEXT;

-- CreateTable
CREATE TABLE "SupplierPortalInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPortalInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPortalSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpRfq" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "rfqNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "responseDueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "commercialTerms" JSONB NOT NULL DEFAULT '{}',
    "technicalTerms" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL DEFAULT '',
    "selectedBy" TEXT NOT NULL DEFAULT '',
    "selectedQuotationId" TEXT,
    "createIdempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "selectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpRfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpRfqLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "uom" TEXT NOT NULL,
    "requiredOn" DATE,
    "technicalSpecification" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpRfqLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpRfqInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'shortlisted',
    "issuedAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpRfqInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSupplierQuotation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(18,2) NOT NULL,
    "taxTotal" DECIMAL(18,2) NOT NULL,
    "grandTotal" DECIMAL(18,2) NOT NULL,
    "validUntil" DATE NOT NULL,
    "promisedOn" DATE,
    "commercialResponse" JSONB NOT NULL DEFAULT '{}',
    "technicalResponse" JSONB NOT NULL DEFAULT '{}',
    "createIdempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpSupplierQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSupplierQuotationLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "rfqLineId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitRate" DECIMAL(18,6) NOT NULL,
    "taxRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "promisedOn" DATE,
    "technicalResponse" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpSupplierQuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpRateAgreement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "rfqId" TEXT,
    "quotationId" TEXT,
    "agreementNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "validFrom" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "terms" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "activatedBy" TEXT NOT NULL DEFAULT '',
    "createIdempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpRateAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpPoAcknowledgement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseNote" TEXT NOT NULL DEFAULT '',
    "proposedChanges" JSONB NOT NULL DEFAULT '{}',
    "createIdempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpPoAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpAdvanceShipmentNotice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "asnNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "dispatchedOn" DATE NOT NULL,
    "expectedArrivalOn" DATE NOT NULL,
    "carrier" TEXT NOT NULL DEFAULT '',
    "vehicleNumber" TEXT NOT NULL DEFAULT '',
    "trackingReference" TEXT NOT NULL DEFAULT '',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "createIdempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpAdvanceShipmentNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpVendorChangeCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "proposedValues" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decisionReason" TEXT NOT NULL DEFAULT '',
    "decidedBy" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "createIdempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpVendorChangeCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpVendorDispute" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "supplierInvoiceId" TEXT,
    "matchCaseId" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "requestedDebitAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vendorResponse" TEXT NOT NULL DEFAULT '',
    "resolution" TEXT NOT NULL DEFAULT '',
    "createdByActorType" TEXT NOT NULL,
    "createdByRef" TEXT NOT NULL,
    "resolvedBy" TEXT NOT NULL DEFAULT '',
    "resolvedAt" TIMESTAMP(3),
    "createIdempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpVendorDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpVendorPaymentProposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "paymentVoucherId" TEXT,
    "proposalNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "proposedPaymentOn" DATE NOT NULL,
    "payableAccountId" TEXT NOT NULL,
    "settlementAccountId" TEXT NOT NULL,
    "narration" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3),
    "createIdempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpVendorPaymentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSupplierInvoiceEvidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "storageRef" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createIdempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpSupplierInvoiceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPortalInvite_tokenHash_key" ON "SupplierPortalInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "SupplierPortalInvite_organizationId_portalUserId_idx" ON "SupplierPortalInvite"("organizationId", "portalUserId");

-- CreateIndex
CREATE INDEX "SupplierPortalInvite_expiresAt_idx" ON "SupplierPortalInvite"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPortalInvite_organizationId_idempotencyKey_key" ON "SupplierPortalInvite"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPortalSession_tokenHash_key" ON "SupplierPortalSession"("tokenHash");

-- CreateIndex
CREATE INDEX "SupplierPortalSession_organizationId_portalUserId_idx" ON "SupplierPortalSession"("organizationId", "portalUserId");

-- CreateIndex
CREATE INDEX "SupplierPortalSession_expiresAt_idx" ON "SupplierPortalSession"("expiresAt");

-- CreateIndex
CREATE INDEX "ErpRfq_organizationId_idx" ON "ErpRfq"("organizationId");

-- CreateIndex
CREATE INDEX "ErpRfq_legalEntityId_status_responseDueAt_idx" ON "ErpRfq"("legalEntityId", "status", "responseDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErpRfq_organizationId_legalEntityId_rfqNumber_key" ON "ErpRfq"("organizationId", "legalEntityId", "rfqNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErpRfq_organizationId_legalEntityId_createIdempotencyKey_key" ON "ErpRfq"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "ErpRfqLine_organizationId_idx" ON "ErpRfqLine"("organizationId");

-- CreateIndex
CREATE INDEX "ErpRfqLine_rfqId_idx" ON "ErpRfqLine"("rfqId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpRfqLine_organizationId_rfqId_lineNumber_key" ON "ErpRfqLine"("organizationId", "rfqId", "lineNumber");

-- CreateIndex
CREATE INDEX "ErpRfqInvitation_organizationId_idx" ON "ErpRfqInvitation"("organizationId");

-- CreateIndex
CREATE INDEX "ErpRfqInvitation_vendorId_status_idx" ON "ErpRfqInvitation"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpRfqInvitation_organizationId_rfqId_vendorId_key" ON "ErpRfqInvitation"("organizationId", "rfqId", "vendorId");

-- CreateIndex
CREATE INDEX "ErpSupplierQuotation_organizationId_idx" ON "ErpSupplierQuotation"("organizationId");

-- CreateIndex
CREATE INDEX "ErpSupplierQuotation_rfqId_status_idx" ON "ErpSupplierQuotation"("rfqId", "status");

-- CreateIndex
CREATE INDEX "ErpSupplierQuotation_vendorId_submittedAt_idx" ON "ErpSupplierQuotation"("vendorId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErpSupplierQuotation_organizationId_rfqId_vendorId_quotatio_key" ON "ErpSupplierQuotation"("organizationId", "rfqId", "vendorId", "quotationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErpSupplierQuotation_organizationId_legalEntityId_createIde_key" ON "ErpSupplierQuotation"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "ErpSupplierQuotationLine_organizationId_idx" ON "ErpSupplierQuotationLine"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpSupplierQuotationLine_organizationId_quotationId_lineNum_key" ON "ErpSupplierQuotationLine"("organizationId", "quotationId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErpSupplierQuotationLine_organizationId_quotationId_rfqLine_key" ON "ErpSupplierQuotationLine"("organizationId", "quotationId", "rfqLineId");

-- CreateIndex
CREATE INDEX "ErpRateAgreement_organizationId_idx" ON "ErpRateAgreement"("organizationId");

-- CreateIndex
CREATE INDEX "ErpRateAgreement_vendorId_status_validUntil_idx" ON "ErpRateAgreement"("vendorId", "status", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ErpRateAgreement_organizationId_legalEntityId_agreementNumb_key" ON "ErpRateAgreement"("organizationId", "legalEntityId", "agreementNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErpRateAgreement_organizationId_legalEntityId_createIdempot_key" ON "ErpRateAgreement"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "ErpPoAcknowledgement_organizationId_idx" ON "ErpPoAcknowledgement"("organizationId");

-- CreateIndex
CREATE INDEX "ErpPoAcknowledgement_vendorId_status_idx" ON "ErpPoAcknowledgement"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpPoAcknowledgement_organizationId_purchaseOrderId_vendorI_key" ON "ErpPoAcknowledgement"("organizationId", "purchaseOrderId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpPoAcknowledgement_organizationId_legalEntityId_createIde_key" ON "ErpPoAcknowledgement"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "ErpAdvanceShipmentNotice_organizationId_idx" ON "ErpAdvanceShipmentNotice"("organizationId");

-- CreateIndex
CREATE INDEX "ErpAdvanceShipmentNotice_vendorId_status_expectedArrivalOn_idx" ON "ErpAdvanceShipmentNotice"("vendorId", "status", "expectedArrivalOn");

-- CreateIndex
CREATE UNIQUE INDEX "ErpAdvanceShipmentNotice_organizationId_purchaseOrderId_asn_key" ON "ErpAdvanceShipmentNotice"("organizationId", "purchaseOrderId", "asnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErpAdvanceShipmentNotice_organizationId_legalEntityId_creat_key" ON "ErpAdvanceShipmentNotice"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "ErpVendorChangeCase_organizationId_idx" ON "ErpVendorChangeCase"("organizationId");

-- CreateIndex
CREATE INDEX "ErpVendorChangeCase_vendorId_status_createdAt_idx" ON "ErpVendorChangeCase"("vendorId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErpVendorChangeCase_organizationId_legalEntityId_createIdem_key" ON "ErpVendorChangeCase"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "ErpVendorDispute_organizationId_idx" ON "ErpVendorDispute"("organizationId");

-- CreateIndex
CREATE INDEX "ErpVendorDispute_vendorId_status_createdAt_idx" ON "ErpVendorDispute"("vendorId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErpVendorDispute_organizationId_legalEntityId_createIdempot_key" ON "ErpVendorDispute"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE INDEX "ErpVendorPaymentProposal_organizationId_idx" ON "ErpVendorPaymentProposal"("organizationId");

-- CreateIndex
CREATE INDEX "ErpVendorPaymentProposal_vendorId_status_proposedPaymentOn_idx" ON "ErpVendorPaymentProposal"("vendorId", "status", "proposedPaymentOn");

-- CreateIndex
CREATE UNIQUE INDEX "ErpVendorPaymentProposal_organizationId_legalEntityId_propo_key" ON "ErpVendorPaymentProposal"("organizationId", "legalEntityId", "proposalNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErpVendorPaymentProposal_organizationId_legalEntityId_creat_key" ON "ErpVendorPaymentProposal"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ErpVendorPaymentProposal_organizationId_paymentVoucherId_key" ON "ErpVendorPaymentProposal"("organizationId", "paymentVoucherId");

-- CreateIndex
CREATE INDEX "ErpSupplierInvoiceEvidence_organizationId_idx" ON "ErpSupplierInvoiceEvidence"("organizationId");

-- CreateIndex
CREATE INDEX "ErpSupplierInvoiceEvidence_vendorId_supplierInvoiceId_idx" ON "ErpSupplierInvoiceEvidence"("vendorId", "supplierInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpSupplierInvoiceEvidence_organizationId_legalEntityId_cre_key" ON "ErpSupplierInvoiceEvidence"("organizationId", "legalEntityId", "createIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ErpVendorDocument_organizationId_legalEntityId_createIdempo_key" ON "ErpVendorDocument"("organizationId", "legalEntityId", "createIdempotencyKey");

-- AddForeignKey
ALTER TABLE "ErpVendorDocument" ADD CONSTRAINT "ErpVendorDocument_submittedByPortalUserId_fkey" FOREIGN KEY ("submittedByPortalUserId") REFERENCES "SupplierPortalUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalInvite" ADD CONSTRAINT "SupplierPortalInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPortalSession" ADD CONSTRAINT "SupplierPortalSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRfq" ADD CONSTRAINT "ErpRfq_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRfq" ADD CONSTRAINT "ErpRfq_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRfq" ADD CONSTRAINT "ErpRfq_selectedQuotationId_fkey" FOREIGN KEY ("selectedQuotationId") REFERENCES "ErpSupplierQuotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRfqLine" ADD CONSTRAINT "ErpRfqLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRfqLine" ADD CONSTRAINT "ErpRfqLine_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRfqLine" ADD CONSTRAINT "ErpRfqLine_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "ErpRfq"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRfqInvitation" ADD CONSTRAINT "ErpRfqInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRfqInvitation" ADD CONSTRAINT "ErpRfqInvitation_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRfqInvitation" ADD CONSTRAINT "ErpRfqInvitation_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "ErpRfq"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRfqInvitation" ADD CONSTRAINT "ErpRfqInvitation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierQuotation" ADD CONSTRAINT "ErpSupplierQuotation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierQuotation" ADD CONSTRAINT "ErpSupplierQuotation_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierQuotation" ADD CONSTRAINT "ErpSupplierQuotation_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "ErpRfq"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierQuotation" ADD CONSTRAINT "ErpSupplierQuotation_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "ErpRfqInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierQuotation" ADD CONSTRAINT "ErpSupplierQuotation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierQuotation" ADD CONSTRAINT "ErpSupplierQuotation_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "SupplierPortalUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierQuotationLine" ADD CONSTRAINT "ErpSupplierQuotationLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierQuotationLine" ADD CONSTRAINT "ErpSupplierQuotationLine_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierQuotationLine" ADD CONSTRAINT "ErpSupplierQuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "ErpSupplierQuotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierQuotationLine" ADD CONSTRAINT "ErpSupplierQuotationLine_rfqLineId_fkey" FOREIGN KEY ("rfqLineId") REFERENCES "ErpRfqLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRateAgreement" ADD CONSTRAINT "ErpRateAgreement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRateAgreement" ADD CONSTRAINT "ErpRateAgreement_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRateAgreement" ADD CONSTRAINT "ErpRateAgreement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRateAgreement" ADD CONSTRAINT "ErpRateAgreement_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "ErpRfq"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRateAgreement" ADD CONSTRAINT "ErpRateAgreement_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "ErpSupplierQuotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpPoAcknowledgement" ADD CONSTRAINT "ErpPoAcknowledgement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpPoAcknowledgement" ADD CONSTRAINT "ErpPoAcknowledgement_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpPoAcknowledgement" ADD CONSTRAINT "ErpPoAcknowledgement_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpPoAcknowledgement" ADD CONSTRAINT "ErpPoAcknowledgement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpPoAcknowledgement" ADD CONSTRAINT "ErpPoAcknowledgement_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "SupplierPortalUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAdvanceShipmentNotice" ADD CONSTRAINT "ErpAdvanceShipmentNotice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAdvanceShipmentNotice" ADD CONSTRAINT "ErpAdvanceShipmentNotice_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAdvanceShipmentNotice" ADD CONSTRAINT "ErpAdvanceShipmentNotice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAdvanceShipmentNotice" ADD CONSTRAINT "ErpAdvanceShipmentNotice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpAdvanceShipmentNotice" ADD CONSTRAINT "ErpAdvanceShipmentNotice_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "SupplierPortalUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorChangeCase" ADD CONSTRAINT "ErpVendorChangeCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorChangeCase" ADD CONSTRAINT "ErpVendorChangeCase_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorChangeCase" ADD CONSTRAINT "ErpVendorChangeCase_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorChangeCase" ADD CONSTRAINT "ErpVendorChangeCase_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "SupplierPortalUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorDispute" ADD CONSTRAINT "ErpVendorDispute_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorDispute" ADD CONSTRAINT "ErpVendorDispute_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorDispute" ADD CONSTRAINT "ErpVendorDispute_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorPaymentProposal" ADD CONSTRAINT "ErpVendorPaymentProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorPaymentProposal" ADD CONSTRAINT "ErpVendorPaymentProposal_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorPaymentProposal" ADD CONSTRAINT "ErpVendorPaymentProposal_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorPaymentProposal" ADD CONSTRAINT "ErpVendorPaymentProposal_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpVendorPaymentProposal" ADD CONSTRAINT "ErpVendorPaymentProposal_paymentVoucherId_fkey" FOREIGN KEY ("paymentVoucherId") REFERENCES "ErpVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierInvoiceEvidence" ADD CONSTRAINT "ErpSupplierInvoiceEvidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierInvoiceEvidence" ADD CONSTRAINT "ErpSupplierInvoiceEvidence_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierInvoiceEvidence" ADD CONSTRAINT "ErpSupplierInvoiceEvidence_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ErpVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierInvoiceEvidence" ADD CONSTRAINT "ErpSupplierInvoiceEvidence_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSupplierInvoiceEvidence" ADD CONSTRAINT "ErpSupplierInvoiceEvidence_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "SupplierPortalUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cross-table business references which are intentionally scalar in Prisma so
-- the payment and dispute services can validate account/document type before
-- writing while the database still enforces referential integrity.
ALTER TABLE "ErpVendorDispute" ADD CONSTRAINT "ErpVendorDispute_supplierInvoiceId_fkey"
FOREIGN KEY ("supplierInvoiceId") REFERENCES "ErpDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpVendorDispute" ADD CONSTRAINT "ErpVendorDispute_matchCaseId_fkey"
FOREIGN KEY ("matchCaseId") REFERENCES "ErpMatchCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpVendorPaymentProposal" ADD CONSTRAINT "ErpVendorPaymentProposal_payableAccountId_fkey"
FOREIGN KEY ("payableAccountId") REFERENCES "ErpAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpVendorPaymentProposal" ADD CONSTRAINT "ErpVendorPaymentProposal_settlementAccountId_fkey"
FOREIGN KEY ("settlementAccountId") REFERENCES "ErpAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Explicit lifecycle and numeric guards keep invalid portal writes out even if
-- a future caller bypasses the HTTP schemas.
ALTER TABLE "ErpRfq" ADD CONSTRAINT "ErpRfq_status_check"
CHECK ("status" IN ('draft', 'issued', 'awarded', 'closed', 'cancelled'));
ALTER TABLE "ErpRfqLine" ADD CONSTRAINT "ErpRfqLine_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "ErpRfqInvitation" ADD CONSTRAINT "ErpRfqInvitation_status_check"
CHECK ("status" IN ('shortlisted', 'issued', 'viewed', 'responded', 'declined'));
ALTER TABLE "ErpSupplierQuotation" ADD CONSTRAINT "ErpSupplierQuotation_status_check"
CHECK ("status" IN ('submitted', 'withdrawn', 'selected', 'rejected'));
ALTER TABLE "ErpSupplierQuotation" ADD CONSTRAINT "ErpSupplierQuotation_totals_check"
CHECK ("subtotal" >= 0 AND "taxTotal" >= 0 AND "grandTotal" >= 0);
ALTER TABLE "ErpSupplierQuotationLine" ADD CONSTRAINT "ErpSupplierQuotationLine_values_check"
CHECK ("quantity" > 0 AND "unitRate" >= 0 AND "taxRate" >= 0 AND "taxRate" <= 100 AND "taxAmount" >= 0 AND "lineTotal" >= 0);
ALTER TABLE "ErpRateAgreement" ADD CONSTRAINT "ErpRateAgreement_status_check"
CHECK ("status" IN ('draft', 'active', 'expired', 'terminated') AND "validUntil" >= "validFrom");
ALTER TABLE "ErpPoAcknowledgement" ADD CONSTRAINT "ErpPoAcknowledgement_status_check"
CHECK ("status" IN ('accepted', 'change_requested'));
ALTER TABLE "ErpAdvanceShipmentNotice" ADD CONSTRAINT "ErpAdvanceShipmentNotice_status_check"
CHECK ("status" IN ('submitted', 'received', 'cancelled') AND "expectedArrivalOn" >= "dispatchedOn");
ALTER TABLE "ErpVendorChangeCase" ADD CONSTRAINT "ErpVendorChangeCase_status_check"
CHECK ("status" IN ('pending', 'approved', 'rejected') AND "changeType" IN ('profile', 'legal', 'gstin', 'bank'));
ALTER TABLE "ErpVendorDispute" ADD CONSTRAINT "ErpVendorDispute_status_check"
CHECK ("status" IN ('open', 'vendor_response', 'resolved', 'rejected') AND "createdByActorType" IN ('employee', 'supplier') AND "requestedDebitAmount" >= 0);
ALTER TABLE "ErpVendorPaymentProposal" ADD CONSTRAINT "ErpVendorPaymentProposal_status_check"
CHECK ("status" IN ('draft', 'approved', 'rejected') AND "amount" > 0);
ALTER TABLE "ErpSupplierInvoiceEvidence" ADD CONSTRAINT "ErpSupplierInvoiceEvidence_type_check"
CHECK ("evidenceType" IN ('invoice', 'e_invoice', 'supporting') AND "checksum" ~ '^[a-f0-9]{64}$');

-- Invite/session tables are intentionally in the authentication plane because
-- their opaque token digest must resolve the tenant before RLS can be entered.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "SupplierPortalInvite" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "SupplierPortalSession" TO app_user;

-- Every supplier business row is company isolated, including FORCE RLS for
-- table owners. Portal services set this GUC only after resolving a token hash.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ErpRfq', 'ErpRfqLine', 'ErpRfqInvitation', 'ErpSupplierQuotation',
    'ErpSupplierQuotationLine', 'ErpRateAgreement', 'ErpPoAcknowledgement',
    'ErpAdvanceShipmentNotice', 'ErpVendorChangeCase', 'ErpVendorDispute',
    'ErpVendorPaymentProposal', 'ErpSupplierInvoiceEvidence'
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
