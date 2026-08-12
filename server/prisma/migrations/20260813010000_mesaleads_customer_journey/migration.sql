-- MesaLeads customer journey: opaque per-lead portals, immutable versioned
-- quotations and customer-visible fulfillment milestones.

CREATE TABLE "LeadPortalLink" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expiresAt" TIMESTAMP(3),
  "lastOpenedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadPortalLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadQuote" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "sourceQuoteId" TEXT,
  "versionNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "title" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "validUntil" TIMESTAMP(3),
  "summary" TEXT NOT NULL DEFAULT '',
  "organizationRemarks" TEXT NOT NULL DEFAULT '',
  "customerRemark" TEXT NOT NULL DEFAULT '',
  "acceptanceText" TEXT NOT NULL DEFAULT '',
  "acceptedByName" TEXT NOT NULL DEFAULT '',
  "acceptedByEmail" TEXT NOT NULL DEFAULT '',
  "terms" JSONB NOT NULL DEFAULT '[]',
  "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "discountTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "taxTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "grandTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadQuote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadDecisionChallenge" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "emailHash" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadDecisionChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadQuoteLineItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "description" TEXT NOT NULL,
  "specification" TEXT NOT NULL DEFAULT '',
  "hsnSacCode" TEXT NOT NULL DEFAULT '',
  "quantity" DECIMAL(18,4) NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'nos',
  "unitPrice" DECIMAL(18,2) NOT NULL,
  "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "taxRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "taxableAmount" DECIMAL(18,2) NOT NULL,
  "taxAmount" DECIMAL(18,2) NOT NULL,
  "total" DECIMAL(18,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadQuoteLineItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadQuoteEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorEmail" TEXT NOT NULL DEFAULT '',
  "remark" TEXT NOT NULL DEFAULT '',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "idempotencyKey" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadQuoteEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadFulfillment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'not_started',
  "customerSummary" TEXT NOT NULL DEFAULT '',
  "estimatedCompletionDate" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadFulfillment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadMilestone" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "fulfillmentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "targetDate" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "customerNote" TEXT NOT NULL DEFAULT '',
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadMilestone_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LeadPortalLink" ADD CONSTRAINT "LeadPortalLink_status_check" CHECK ("status" IN ('active', 'revoked'));
ALTER TABLE "LeadQuote" ADD CONSTRAINT "LeadQuote_status_check" CHECK ("status" IN ('draft', 'sent', 'revision_requested', 'approved', 'superseded', 'withdrawn', 'expired'));
ALTER TABLE "LeadQuote" ADD CONSTRAINT "LeadQuote_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "LeadQuote" ADD CONSTRAINT "LeadQuote_version_positive" CHECK ("versionNumber" > 0);
ALTER TABLE "LeadQuote" ADD CONSTRAINT "LeadQuote_totals_nonnegative" CHECK ("subtotal" >= 0 AND "discountTotal" >= 0 AND "taxTotal" >= 0 AND "grandTotal" >= 0);
ALTER TABLE "LeadQuoteLineItem" ADD CONSTRAINT "LeadQuoteLineItem_values_check" CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "discountAmount" >= 0 AND "taxRate" >= 0 AND "taxRate" <= 100 AND "taxableAmount" >= 0 AND "taxAmount" >= 0 AND "total" >= 0);
ALTER TABLE "LeadQuoteEvent" ADD CONSTRAINT "LeadQuoteEvent_actor_check" CHECK ("actorType" IN ('organization', 'customer', 'system'));
ALTER TABLE "LeadFulfillment" ADD CONSTRAINT "LeadFulfillment_status_check" CHECK ("status" IN ('not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'));
ALTER TABLE "LeadMilestone" ADD CONSTRAINT "LeadMilestone_status_check" CHECK ("status" IN ('pending', 'in_progress', 'blocked', 'completed', 'cancelled'));

CREATE UNIQUE INDEX "LeadPortalLink_tokenHash_key" ON "LeadPortalLink"("tokenHash");
CREATE UNIQUE INDEX "LeadPortalLink_leadId_key" ON "LeadPortalLink"("leadId");
CREATE INDEX "LeadPortalLink_organizationId_idx" ON "LeadPortalLink"("organizationId");
CREATE INDEX "LeadDecisionChallenge_organizationId_idx" ON "LeadDecisionChallenge"("organizationId");
CREATE INDEX "LeadDecisionChallenge_leadId_expiresAt_idx" ON "LeadDecisionChallenge"("leadId", "expiresAt");
CREATE UNIQUE INDEX "LeadQuote_organizationId_leadId_versionNumber_key" ON "LeadQuote"("organizationId", "leadId", "versionNumber");
CREATE UNIQUE INDEX "LeadQuote_organizationId_createIdempotencyKey_key" ON "LeadQuote"("organizationId", "createIdempotencyKey");
CREATE INDEX "LeadQuote_organizationId_idx" ON "LeadQuote"("organizationId");
CREATE INDEX "LeadQuote_leadId_versionNumber_idx" ON "LeadQuote"("leadId", "versionNumber");
CREATE INDEX "LeadQuote_leadId_status_idx" ON "LeadQuote"("leadId", "status");
CREATE UNIQUE INDEX "LeadQuote_one_actionable_sent_per_lead_key" ON "LeadQuote"("organizationId", "leadId") WHERE "status" = 'sent';
CREATE INDEX "LeadQuoteLineItem_organizationId_idx" ON "LeadQuoteLineItem"("organizationId");
CREATE INDEX "LeadQuoteLineItem_quoteId_sortOrder_idx" ON "LeadQuoteLineItem"("quoteId", "sortOrder");
CREATE UNIQUE INDEX "LeadQuoteEvent_organizationId_idempotencyKey_key" ON "LeadQuoteEvent"("organizationId", "idempotencyKey");
CREATE INDEX "LeadQuoteEvent_organizationId_idx" ON "LeadQuoteEvent"("organizationId");
CREATE INDEX "LeadQuoteEvent_leadId_occurredAt_idx" ON "LeadQuoteEvent"("leadId", "occurredAt");
CREATE INDEX "LeadQuoteEvent_quoteId_occurredAt_idx" ON "LeadQuoteEvent"("quoteId", "occurredAt");
CREATE UNIQUE INDEX "LeadFulfillment_leadId_key" ON "LeadFulfillment"("leadId");
CREATE UNIQUE INDEX "LeadFulfillment_organizationId_createIdempotencyKey_key" ON "LeadFulfillment"("organizationId", "createIdempotencyKey");
CREATE INDEX "LeadFulfillment_organizationId_idx" ON "LeadFulfillment"("organizationId");
CREATE INDEX "LeadFulfillment_organizationId_status_idx" ON "LeadFulfillment"("organizationId", "status");
CREATE UNIQUE INDEX "LeadMilestone_organizationId_createIdempotencyKey_key" ON "LeadMilestone"("organizationId", "createIdempotencyKey");
CREATE INDEX "LeadMilestone_organizationId_idx" ON "LeadMilestone"("organizationId");
CREATE INDEX "LeadMilestone_fulfillmentId_sortOrder_idx" ON "LeadMilestone"("fulfillmentId", "sortOrder");
CREATE INDEX "LeadMilestone_leadId_idx" ON "LeadMilestone"("leadId");

ALTER TABLE "LeadPortalLink" ADD CONSTRAINT "LeadPortalLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadPortalLink" ADD CONSTRAINT "LeadPortalLink_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MesaLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadDecisionChallenge" ADD CONSTRAINT "LeadDecisionChallenge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadDecisionChallenge" ADD CONSTRAINT "LeadDecisionChallenge_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MesaLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadQuote" ADD CONSTRAINT "LeadQuote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadQuote" ADD CONSTRAINT "LeadQuote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MesaLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadQuote" ADD CONSTRAINT "LeadQuote_sourceQuoteId_fkey" FOREIGN KEY ("sourceQuoteId") REFERENCES "LeadQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadQuoteLineItem" ADD CONSTRAINT "LeadQuoteLineItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadQuoteLineItem" ADD CONSTRAINT "LeadQuoteLineItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "LeadQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadQuoteEvent" ADD CONSTRAINT "LeadQuoteEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadQuoteEvent" ADD CONSTRAINT "LeadQuoteEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MesaLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadQuoteEvent" ADD CONSTRAINT "LeadQuoteEvent_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "LeadQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadFulfillment" ADD CONSTRAINT "LeadFulfillment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadFulfillment" ADD CONSTRAINT "LeadFulfillment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MesaLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadMilestone" ADD CONSTRAINT "LeadMilestone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadMilestone" ADD CONSTRAINT "LeadMilestone_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MesaLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadMilestone" ADD CONSTRAINT "LeadMilestone_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "LeadFulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sent commercial content and quote events are append-only. Status, customer
-- decision fields and rowVersion remain mutable for explicit lifecycle APIs.
CREATE FUNCTION protect_sent_lead_quote() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'draft' AND (
    NEW."leadId" IS DISTINCT FROM OLD."leadId" OR
    NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber" OR
    NEW."title" IS DISTINCT FROM OLD."title" OR
    NEW."currency" IS DISTINCT FROM OLD."currency" OR
    NEW."validUntil" IS DISTINCT FROM OLD."validUntil" OR
    NEW."summary" IS DISTINCT FROM OLD."summary" OR
    NEW."organizationRemarks" IS DISTINCT FROM OLD."organizationRemarks" OR
    NEW."terms" IS DISTINCT FROM OLD."terms" OR
    NEW."subtotal" IS DISTINCT FROM OLD."subtotal" OR
    NEW."discountTotal" IS DISTINCT FROM OLD."discountTotal" OR
    NEW."taxTotal" IS DISTINCT FROM OLD."taxTotal" OR
    NEW."grandTotal" IS DISTINCT FROM OLD."grandTotal"
  ) THEN
    RAISE EXCEPTION 'sent quote commercial content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeadQuote_protect_sent"
BEFORE UPDATE ON "LeadQuote"
FOR EACH ROW EXECUTE FUNCTION protect_sent_lead_quote();

CREATE FUNCTION prevent_sent_lead_quote_delete() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'draft' THEN
    RAISE EXCEPTION 'sent quote versions are immutable';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeadQuote_protect_sent_delete"
BEFORE DELETE ON "LeadQuote"
FOR EACH ROW EXECUTE FUNCTION prevent_sent_lead_quote_delete();

CREATE FUNCTION protect_lead_quote_line_item() RETURNS trigger AS $$
DECLARE quote_status TEXT;
BEGIN
  SELECT "status" INTO quote_status FROM "LeadQuote" WHERE "id" = COALESCE(NEW."quoteId", OLD."quoteId");
  IF quote_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'sent quote line items are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeadQuoteLineItem_protect_sent"
BEFORE INSERT OR UPDATE OR DELETE ON "LeadQuoteLineItem"
FOR EACH ROW EXECUTE FUNCTION protect_lead_quote_line_item();

CREATE FUNCTION prevent_lead_quote_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'quote events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeadQuoteEvent_append_only"
BEFORE UPDATE OR DELETE ON "LeadQuoteEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_lead_quote_event_mutation();

-- PortalLink is intentionally global for token-to-tenant resolution. Every
-- commercial/fulfillment row is tenant-owned and FORCE RLS protected.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'LeadDecisionChallenge', 'LeadQuote', 'LeadQuoteLineItem', 'LeadQuoteEvent',
    'LeadFulfillment', 'LeadMilestone'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_tenant'', true)) WITH CHECK ("organizationId" = current_setting(''app.current_tenant'', true));', t);
  END LOOP;
END $$;
