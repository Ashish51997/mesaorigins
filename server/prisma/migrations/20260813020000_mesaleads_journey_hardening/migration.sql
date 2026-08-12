-- Strengthen commercial-evidence retention and enforce tenant consistency on
-- every cross-table journey reference, including global portal resolvers.

CREATE OR REPLACE FUNCTION prevent_sent_lead_quote_delete() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'draft' AND current_setting('app.allow_commercial_purge', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'sent quote versions are retained commercial evidence';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_lead_quote_event_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_commercial_purge', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'quote events are immutable commercial evidence';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION assert_lead_portal_tenant() RETURNS trigger AS $$
DECLARE actual_org TEXT;
BEGIN
  SELECT "organizationId" INTO actual_org FROM "MesaLead" WHERE "id" = NEW."leadId";
  IF actual_org IS NULL OR actual_org IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'portal lead tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeadPortalLink_tenant_consistency"
BEFORE INSERT OR UPDATE OF "organizationId", "leadId" ON "LeadPortalLink"
FOR EACH ROW EXECUTE FUNCTION assert_lead_portal_tenant();

CREATE FUNCTION assert_decision_challenge_tenant() RETURNS trigger AS $$
DECLARE actual_org TEXT;
BEGIN
  SELECT "organizationId" INTO actual_org FROM "MesaLead" WHERE "id" = NEW."leadId";
  IF actual_org IS NULL OR actual_org IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'decision challenge lead tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeadDecisionChallenge_tenant_consistency"
BEFORE INSERT OR UPDATE OF "organizationId", "leadId" ON "LeadDecisionChallenge"
FOR EACH ROW EXECUTE FUNCTION assert_decision_challenge_tenant();

CREATE FUNCTION assert_lead_quote_tenant() RETURNS trigger AS $$
DECLARE lead_org TEXT; source_org TEXT; source_lead TEXT;
BEGIN
  SELECT "organizationId" INTO lead_org FROM "MesaLead" WHERE "id" = NEW."leadId";
  IF lead_org IS NULL OR lead_org IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'quote lead tenant mismatch';
  END IF;
  IF NEW."sourceQuoteId" IS NOT NULL THEN
    SELECT "organizationId", "leadId" INTO source_org, source_lead FROM "LeadQuote" WHERE "id" = NEW."sourceQuoteId";
    IF source_org IS NULL OR source_org IS DISTINCT FROM NEW."organizationId" OR source_lead IS DISTINCT FROM NEW."leadId" THEN
      RAISE EXCEPTION 'quote revision lineage mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeadQuote_tenant_consistency"
BEFORE INSERT OR UPDATE OF "organizationId", "leadId", "sourceQuoteId" ON "LeadQuote"
FOR EACH ROW EXECUTE FUNCTION assert_lead_quote_tenant();

CREATE FUNCTION assert_quote_line_tenant() RETURNS trigger AS $$
DECLARE quote_org TEXT;
BEGIN
  SELECT "organizationId" INTO quote_org FROM "LeadQuote" WHERE "id" = NEW."quoteId";
  IF quote_org IS NULL OR quote_org IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'quote line tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeadQuoteLineItem_tenant_consistency"
BEFORE INSERT OR UPDATE OF "organizationId", "quoteId" ON "LeadQuoteLineItem"
FOR EACH ROW EXECUTE FUNCTION assert_quote_line_tenant();

CREATE FUNCTION assert_quote_event_tenant() RETURNS trigger AS $$
DECLARE quote_org TEXT; quote_lead TEXT; lead_org TEXT;
BEGIN
  SELECT "organizationId", "leadId" INTO quote_org, quote_lead FROM "LeadQuote" WHERE "id" = NEW."quoteId";
  SELECT "organizationId" INTO lead_org FROM "MesaLead" WHERE "id" = NEW."leadId";
  IF quote_org IS NULL OR lead_org IS NULL OR quote_org IS DISTINCT FROM NEW."organizationId"
     OR lead_org IS DISTINCT FROM NEW."organizationId" OR quote_lead IS DISTINCT FROM NEW."leadId" THEN
    RAISE EXCEPTION 'quote event tenant or lead mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeadQuoteEvent_tenant_consistency"
BEFORE INSERT ON "LeadQuoteEvent"
FOR EACH ROW EXECUTE FUNCTION assert_quote_event_tenant();

CREATE FUNCTION assert_fulfillment_tenant() RETURNS trigger AS $$
DECLARE lead_org TEXT;
BEGIN
  SELECT "organizationId" INTO lead_org FROM "MesaLead" WHERE "id" = NEW."leadId";
  IF lead_org IS NULL OR lead_org IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'fulfillment lead tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeadFulfillment_tenant_consistency"
BEFORE INSERT OR UPDATE OF "organizationId", "leadId" ON "LeadFulfillment"
FOR EACH ROW EXECUTE FUNCTION assert_fulfillment_tenant();

CREATE FUNCTION assert_milestone_tenant() RETURNS trigger AS $$
DECLARE lead_org TEXT; fulfillment_org TEXT; fulfillment_lead TEXT;
BEGIN
  SELECT "organizationId" INTO lead_org FROM "MesaLead" WHERE "id" = NEW."leadId";
  SELECT "organizationId", "leadId" INTO fulfillment_org, fulfillment_lead FROM "LeadFulfillment" WHERE "id" = NEW."fulfillmentId";
  IF lead_org IS NULL OR fulfillment_org IS NULL OR lead_org IS DISTINCT FROM NEW."organizationId"
     OR fulfillment_org IS DISTINCT FROM NEW."organizationId" OR fulfillment_lead IS DISTINCT FROM NEW."leadId" THEN
    RAISE EXCEPTION 'milestone tenant or lead mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeadMilestone_tenant_consistency"
BEFORE INSERT OR UPDATE OF "organizationId", "leadId", "fulfillmentId" ON "LeadMilestone"
FOR EACH ROW EXECUTE FUNCTION assert_milestone_tenant();
