-- Allow explicitly-authorized legal/data-retention purge transactions while
-- continuing to block routine mutation/deletion of issued quote line items.
CREATE OR REPLACE FUNCTION protect_lead_quote_line_item() RETURNS trigger AS $$
DECLARE quote_status TEXT;
BEGIN
  IF current_setting('app.allow_commercial_purge', true) = 'true' THEN
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
