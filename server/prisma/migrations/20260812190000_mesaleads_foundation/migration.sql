-- MesaLeads: tenant-owned forms, questions, leads, submissions, activities and
-- private attachments. LeadFormLink is intentionally global: an unauthenticated
-- request must resolve its opaque token before a tenant GUC can be established.

CREATE TABLE "LeadForm" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "familyKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "privacyNotice" TEXT NOT NULL DEFAULT 'Your information will be used by this organization to review and respond to your enquiry.',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadForm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadFormQuestion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "helpText" TEXT NOT NULL DEFAULT '',
  "placeholder" TEXT NOT NULL DEFAULT '',
  "required" BOOLEAN NOT NULL DEFAULT false,
  "options" JSONB NOT NULL DEFAULT '[]',
  "validation" JSONB NOT NULL DEFAULT '{}',
  "visibilityRule" JSONB,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadFormQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MesaLead" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'direct',
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "stage" TEXT NOT NULL DEFAULT 'new',
  "contactName" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "companyName" TEXT NOT NULL DEFAULT '',
  "companyAddress" TEXT NOT NULL DEFAULT '',
  "gstNumber" TEXT NOT NULL DEFAULT '',
  "product" TEXT NOT NULL DEFAULT '',
  "requirement" TEXT NOT NULL DEFAULT '',
  "scope" TEXT NOT NULL DEFAULT 'machine_only',
  "ownerMembershipId" TEXT,
  "machineRecommendation" TEXT NOT NULL DEFAULT '',
  "clampTonnage" DOUBLE PRECISION,
  "shotCapacity" DOUBLE PRECISION,
  "moldStatus" TEXT NOT NULL DEFAULT '',
  "moldSupplier" TEXT NOT NULL DEFAULT '',
  "moldQuoteAmount" DOUBLE PRECISION,
  "quotationAmount" DOUBLE PRECISION,
  "quotationStatus" TEXT NOT NULL DEFAULT 'not_started',
  "nextFollowUpAt" TIMESTAMP(3),
  "followUpNote" TEXT NOT NULL DEFAULT '',
  "lostReason" TEXT NOT NULL DEFAULT '',
  "orderReference" TEXT NOT NULL DEFAULT '',
  "consentedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MesaLead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadFormLink" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "leadId" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'generic',
  "status" TEXT NOT NULL DEFAULT 'active',
  "expiresAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadFormLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadSubmission" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "linkId" TEXT NOT NULL,
  "formRevision" INTEGER NOT NULL,
  "respondentName" TEXT NOT NULL DEFAULT '',
  "respondentEmail" TEXT NOT NULL DEFAULT '',
  "respondentPhone" TEXT NOT NULL DEFAULT '',
  "answers" JSONB NOT NULL,
  "questionSnapshot" JSONB NOT NULL,
  "consentTextSnapshot" TEXT NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadActivity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "actorUserId" TEXT,
  "actorEmail" TEXT NOT NULL DEFAULT '',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadAttachment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "submissionId" TEXT,
  "questionKey" TEXT,
  "originalName" TEXT NOT NULL,
  "storageName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "bytes" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadFormQuestion_formId_key_key" ON "LeadFormQuestion"("formId", "key");
CREATE UNIQUE INDEX "LeadForm_organizationId_familyKey_revision_key" ON "LeadForm"("organizationId", "familyKey", "revision");
CREATE UNIQUE INDEX "MesaLead_organizationId_reference_key" ON "MesaLead"("organizationId", "reference");
CREATE UNIQUE INDEX "LeadFormLink_tokenHash_key" ON "LeadFormLink"("tokenHash");
CREATE UNIQUE INDEX "LeadAttachment_storageName_key" ON "LeadAttachment"("storageName");

ALTER TABLE "LeadForm" ADD CONSTRAINT "LeadForm_status_check" CHECK ("status" IN ('draft', 'published', 'archived'));
ALTER TABLE "LeadFormQuestion" ADD CONSTRAINT "LeadFormQuestion_type_check" CHECK ("type" IN ('section', 'short_text', 'long_text', 'email', 'phone', 'number', 'date', 'single_select', 'multi_select', 'yes_no', 'file'));
ALTER TABLE "MesaLead" ADD CONSTRAINT "MesaLead_stage_check" CHECK ("stage" IN ('new', 'discovery', 'questionnaire_sent', 'requirements_received', 'technical_review', 'mold_sourcing', 'quotation', 'follow_up', 'won', 'lost'));
ALTER TABLE "MesaLead" ADD CONSTRAINT "MesaLead_priority_check" CHECK ("priority" IN ('low', 'medium', 'high'));
ALTER TABLE "MesaLead" ADD CONSTRAINT "MesaLead_scope_check" CHECK ("scope" IN ('machine_only', 'machine_mold', 'mold_only'));
ALTER TABLE "LeadFormLink" ADD CONSTRAINT "LeadFormLink_kind_check" CHECK ("kind" IN ('generic', 'invitation'));
ALTER TABLE "LeadFormLink" ADD CONSTRAINT "LeadFormLink_status_check" CHECK ("status" IN ('active', 'submitted', 'revoked'));
ALTER TABLE "LeadSubmission" ADD CONSTRAINT "LeadSubmission_status_check" CHECK ("status" IN ('submitted'));

CREATE INDEX "LeadForm_organizationId_idx" ON "LeadForm"("organizationId");
CREATE INDEX "LeadForm_organizationId_status_idx" ON "LeadForm"("organizationId", "status");
CREATE INDEX "LeadFormQuestion_organizationId_idx" ON "LeadFormQuestion"("organizationId");
CREATE INDEX "LeadFormQuestion_formId_sortOrder_idx" ON "LeadFormQuestion"("formId", "sortOrder");
CREATE INDEX "MesaLead_organizationId_idx" ON "MesaLead"("organizationId");
CREATE INDEX "MesaLead_organizationId_stage_idx" ON "MesaLead"("organizationId", "stage");
CREATE INDEX "MesaLead_organizationId_nextFollowUpAt_idx" ON "MesaLead"("organizationId", "nextFollowUpAt");
CREATE INDEX "LeadFormLink_organizationId_idx" ON "LeadFormLink"("organizationId");
CREATE INDEX "LeadFormLink_formId_idx" ON "LeadFormLink"("formId");
CREATE INDEX "LeadFormLink_leadId_idx" ON "LeadFormLink"("leadId");
CREATE INDEX "LeadSubmission_organizationId_idx" ON "LeadSubmission"("organizationId");
CREATE INDEX "LeadSubmission_formId_idx" ON "LeadSubmission"("formId");
CREATE INDEX "LeadSubmission_leadId_idx" ON "LeadSubmission"("leadId");
CREATE INDEX "LeadSubmission_linkId_idx" ON "LeadSubmission"("linkId");
CREATE INDEX "LeadActivity_organizationId_idx" ON "LeadActivity"("organizationId");
CREATE INDEX "LeadActivity_leadId_occurredAt_idx" ON "LeadActivity"("leadId", "occurredAt");
CREATE INDEX "LeadAttachment_organizationId_idx" ON "LeadAttachment"("organizationId");
CREATE INDEX "LeadAttachment_leadId_idx" ON "LeadAttachment"("leadId");
CREATE INDEX "LeadAttachment_submissionId_idx" ON "LeadAttachment"("submissionId");

ALTER TABLE "LeadForm" ADD CONSTRAINT "LeadForm_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadFormQuestion" ADD CONSTRAINT "LeadFormQuestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadFormQuestion" ADD CONSTRAINT "LeadFormQuestion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "LeadForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MesaLead" ADD CONSTRAINT "MesaLead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadFormLink" ADD CONSTRAINT "LeadFormLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadFormLink" ADD CONSTRAINT "LeadFormLink_formId_fkey" FOREIGN KEY ("formId") REFERENCES "LeadForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadFormLink" ADD CONSTRAINT "LeadFormLink_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MesaLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadSubmission" ADD CONSTRAINT "LeadSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadSubmission" ADD CONSTRAINT "LeadSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "LeadForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadSubmission" ADD CONSTRAINT "LeadSubmission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MesaLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadSubmission" ADD CONSTRAINT "LeadSubmission_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "LeadFormLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MesaLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadAttachment" ADD CONSTRAINT "LeadAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadAttachment" ADD CONSTRAINT "LeadAttachment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MesaLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadAttachment" ADD CONSTRAINT "LeadAttachment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "LeadSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fail-closed database isolation for every tenant-owned MesaLeads table.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'LeadForm', 'LeadFormQuestion', 'MesaLead', 'LeadSubmission',
    'LeadActivity', 'LeadAttachment'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_tenant'', true)) WITH CHECK ("organizationId" = current_setting(''app.current_tenant'', true));', t);
  END LOOP;
END $$;

-- Deliberately no RLS on LeadFormLink. Its high-entropy token digest is the
-- only public lookup key; all form/lead data remains behind an RLS transaction.

UPDATE "Service" SET "status" = 'active', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 'mesaleads';
