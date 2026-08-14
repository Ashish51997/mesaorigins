-- Keep runtime audit/idempotency evidence append-only while allowing the
-- database owner, reached through DIRECT_DATABASE_URL, to perform an explicit
-- organization-retention purge. Updates remain forbidden for every role.
CREATE OR REPLACE FUNCTION reject_erp_evidence_mutation() RETURNS trigger AS $$
DECLARE privileged_purge BOOLEAN;
BEGIN
  SELECT pg_get_userbyid("relowner") = current_user INTO privileged_purge
  FROM pg_class WHERE "oid" = TG_RELID;

  IF TG_OP = 'DELETE' AND COALESCE(privileged_purge, false) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION '% is append-only evidence', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
