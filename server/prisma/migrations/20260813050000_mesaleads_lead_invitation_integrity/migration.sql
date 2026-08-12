-- Each organization-created MesaLead owns one current customer journey. Repair
-- legacy duplicate active invitations without deleting evidence, then enforce
-- the invariant for all future concurrent writers.
WITH ranked AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "leadId"
           ORDER BY ("status" = 'submitted') DESC, ("openedAt" IS NOT NULL) DESC, "createdAt" DESC, "id" DESC
         ) AS position
  FROM "LeadFormLink"
  WHERE "kind" = 'invitation' AND "status" IN ('active', 'submitted') AND "leadId" IS NOT NULL
)
UPDATE "LeadFormLink" AS link
SET "status" = 'revoked', "updatedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE link."id" = ranked."id" AND ranked.position > 1;

CREATE UNIQUE INDEX "LeadFormLink_one_journey_per_lead"
ON "LeadFormLink"("leadId")
WHERE "kind" = 'invitation' AND "status" IN ('active', 'submitted');

ALTER TABLE "LeadFormLink"
ADD CONSTRAINT "LeadFormLink_kind_lead_check"
CHECK (
  ("kind" = 'generic' AND "leadId" IS NULL)
  OR ("kind" = 'invitation' AND "leadId" IS NOT NULL)
);

CREATE FUNCTION assert_lead_form_link_tenant() RETURNS trigger AS $$
DECLARE form_org TEXT; lead_org TEXT;
BEGIN
  SELECT "organizationId" INTO form_org FROM "LeadForm" WHERE "id" = NEW."formId";
  IF form_org IS NULL OR form_org IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'questionnaire link form tenant mismatch';
  END IF;
  IF NEW."kind" = 'invitation' THEN
    SELECT "organizationId" INTO lead_org FROM "MesaLead" WHERE "id" = NEW."leadId";
    IF lead_org IS NULL OR lead_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'questionnaire link lead tenant mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeadFormLink_tenant_consistency"
BEFORE INSERT OR UPDATE OF "organizationId", "formId", "leadId", "kind" ON "LeadFormLink"
FOR EACH ROW EXECUTE FUNCTION assert_lead_form_link_tenant();
