-- Remove the application-settable purge escape hatch. Commercial evidence can
-- now be purged only by the database role that owns the protected table, using
-- the privileged DIRECT_DATABASE_URL outside the runtime application.

CREATE OR REPLACE FUNCTION prevent_sent_lead_quote_delete() RETURNS trigger AS $$
DECLARE privileged_purge BOOLEAN;
BEGIN
  SELECT pg_get_userbyid("relowner") = current_user INTO privileged_purge
  FROM pg_class WHERE "oid" = '"LeadQuote"'::regclass;
  IF OLD."status" <> 'draft' AND NOT COALESCE(privileged_purge, false) THEN
    RAISE EXCEPTION 'sent quote versions are retained commercial evidence';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_lead_quote_event_mutation() RETURNS trigger AS $$
DECLARE privileged_purge BOOLEAN;
BEGIN
  SELECT pg_get_userbyid("relowner") = current_user INTO privileged_purge
  FROM pg_class WHERE "oid" = '"LeadQuoteEvent"'::regclass;
  IF NOT COALESCE(privileged_purge, false) THEN
    RAISE EXCEPTION 'quote events are immutable commercial evidence';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_lead_quote_line_item() RETURNS trigger AS $$
DECLARE quote_status TEXT;
DECLARE privileged_purge BOOLEAN;
BEGIN
  SELECT pg_get_userbyid("relowner") = current_user INTO privileged_purge
  FROM pg_class WHERE "oid" = '"LeadQuoteLineItem"'::regclass;
  IF COALESCE(privileged_purge, false) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT "status" INTO quote_status FROM "LeadQuote" WHERE "id" = COALESCE(NEW."quoteId", OLD."quoteId");
  IF quote_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'sent quote line items are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
