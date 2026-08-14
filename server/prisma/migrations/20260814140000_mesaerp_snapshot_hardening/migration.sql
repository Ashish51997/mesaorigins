-- Once submitted, the exact accounting content reviewed by the checker is
-- frozen. Approval and posting may add lifecycle evidence only.
CREATE OR REPLACE FUNCTION protect_reviewed_erp_voucher() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'submitted' AND NEW."status" <> 'approved' THEN
    RAISE EXCEPTION 'submitted vouchers may only move to approved';
  END IF;
  IF OLD."status" = 'approved' AND NEW."status" <> 'posted' THEN
    RAISE EXCEPTION 'approved vouchers may only move to posted';
  END IF;
  IF OLD."status" IN ('submitted', 'approved') AND ROW(
    NEW."organizationId", NEW."legalEntityId", NEW."financialYearId", NEW."accountingPeriodId",
    NEW."voucherType", NEW."businessDate", NEW."currency", NEW."exchangeRate",
    NEW."transactionDebit", NEW."transactionCredit", NEW."baseDebit", NEW."baseCredit",
    NEW."reference", NEW."narration", NEW."sourceDocumentId", NEW."reversalOfId",
    NEW."dimensions", NEW."originType", NEW."originMetadata", NEW."createdBy", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."organizationId", OLD."legalEntityId", OLD."financialYearId", OLD."accountingPeriodId",
    OLD."voucherType", OLD."businessDate", OLD."currency", OLD."exchangeRate",
    OLD."transactionDebit", OLD."transactionCredit", OLD."baseDebit", OLD."baseCredit",
    OLD."reference", OLD."narration", OLD."sourceDocumentId", OLD."reversalOfId",
    OLD."dimensions", OLD."originType", OLD."originMetadata", OLD."createdBy", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'submitted and approved voucher content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpVoucher_protect_reviewed"
BEFORE UPDATE ON "ErpVoucher"
FOR EACH ROW EXECUTE FUNCTION protect_reviewed_erp_voucher();

CREATE OR REPLACE FUNCTION protect_posted_erp_voucher_line() RETURNS trigger AS $$
DECLARE parent_status TEXT;
BEGIN
  SELECT "status" INTO parent_status FROM "ErpVoucher" WHERE "id" = COALESCE(NEW."voucherId", OLD."voucherId");
  IF parent_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'voucher lines are immutable after submission';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Source snapshots retain their identity and content. Link state may advance,
-- and a destination id may be filled exactly once after local draft creation.
CREATE OR REPLACE FUNCTION protect_source_link_snapshot() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'source links are retained handoff evidence';
  END IF;
  IF ROW(
    NEW."organizationId", NEW."legalEntityId", NEW."sourceService", NEW."sourceType", NEW."sourceId",
    NEW."destinationService", NEW."destinationType", NEW."correlationId",
    NEW."sourceSnapshotHash", NEW."sourceSnapshot", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."organizationId", OLD."legalEntityId", OLD."sourceService", OLD."sourceType", OLD."sourceId",
    OLD."destinationService", OLD."destinationType", OLD."correlationId",
    OLD."sourceSnapshotHash", OLD."sourceSnapshot", OLD."createdAt"
  ) OR (OLD."destinationId" IS NOT NULL AND NEW."destinationId" IS DISTINCT FROM OLD."destinationId") THEN
    RAISE EXCEPTION 'source link identity and snapshot are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SourceLink_protect_snapshot"
BEFORE UPDATE OR DELETE ON "SourceLink"
FOR EACH ROW EXECUTE FUNCTION protect_source_link_snapshot();

-- Delivery workers may update attempts, errors and publication timestamps, but
-- never the committed event identity or payload.
CREATE OR REPLACE FUNCTION protect_outbox_payload() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outbox events are retained integration evidence';
  END IF;
  IF ROW(
    NEW."organizationId", NEW."legalEntityId", NEW."serviceId", NEW."aggregateType", NEW."aggregateId",
    NEW."eventType", NEW."schemaVersion", NEW."correlationId", NEW."causationId",
    NEW."payload", NEW."payloadHash", NEW."occurredAt", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."organizationId", OLD."legalEntityId", OLD."serviceId", OLD."aggregateType", OLD."aggregateId",
    OLD."eventType", OLD."schemaVersion", OLD."correlationId", OLD."causationId",
    OLD."payload", OLD."payloadHash", OLD."occurredAt", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'outbox event identity and payload are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "IntegrationOutboxEvent_protect_payload"
BEFORE UPDATE OR DELETE ON "IntegrationOutboxEvent"
FOR EACH ROW EXECUTE FUNCTION protect_outbox_payload();

CREATE OR REPLACE FUNCTION retain_inbox_receipt() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inbox receipts are retained deduplication evidence';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "IntegrationInboxReceipt_retain"
BEFORE DELETE ON "IntegrationInboxReceipt"
FOR EACH ROW EXECUTE FUNCTION retain_inbox_receipt();
