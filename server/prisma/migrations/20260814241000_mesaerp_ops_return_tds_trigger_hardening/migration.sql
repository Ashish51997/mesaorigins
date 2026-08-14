-- Follow-up for the checksum-frozen 240000 migration. PostgreSQL resolves
-- every NEW.field referenced inside one boolean expression, even when the
-- TG_TABLE_NAME predicate would be false. Nest table-specific branches so the
-- shared trigger never resolves a column that is absent from the current row.

CREATE OR REPLACE FUNCTION enforce_erp_return_tds_company_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "LegalEntity" entity WHERE entity."id" = NEW."legalEntityId" AND entity."organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'record legal entity must belong to its tenant';
  END IF;

  IF TG_TABLE_NAME = 'ErpHandoffInboxEvent' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "IntegrationOutboxEvent" event WHERE event."id" = NEW."sourceEventId" AND event."organizationId" = NEW."organizationId"
        AND event."serviceId" = 'mesaops' AND event."eventType" = NEW."eventType"
        AND event."schemaVersion" = NEW."schemaVersion" AND event."aggregateType" = NEW."aggregateType" AND event."aggregateId" = NEW."aggregateId"
        AND event."correlationId" = NEW."correlationId" AND event."payloadHash" = NEW."payloadHash"
        AND (
          event."legalEntityId" = NEW."legalEntityId"
          OR (event."legalEntityId" IS NULL AND EXISTS (
            SELECT 1 FROM "ErpHandoffEventRoute" route
            WHERE route."organizationId" = NEW."organizationId" AND route."legalEntityId" = NEW."legalEntityId"
              AND route."sourceEventId" = event."id" AND route."sourcePayloadHash" = event."payloadHash" AND route."status" = 'approved'
          ))
        )
    ) THEN RAISE EXCEPTION 'handoff inbox must reference the exact same-company MesaOps outbox event'; END IF;
  END IF;

  IF TG_TABLE_NAME = 'ErpPlantQaEvidence' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "ErpHandoffInboxEvent" inbox WHERE inbox."id" = NEW."handoffInboxEventId" AND inbox."organizationId" = NEW."organizationId" AND inbox."legalEntityId" = NEW."legalEntityId" AND inbox."eventType" = 'mesaops.qa-disposition.recorded.v1'
    ) THEN RAISE EXCEPTION 'QA evidence must reference a same-company QA handoff'; END IF;
  END IF;

  IF TG_TABLE_NAME = 'ErpPlantDispatchEvidence' THEN
    IF NOT EXISTS (SELECT 1 FROM "ErpHandoffInboxEvent" inbox WHERE inbox."id" = NEW."handoffInboxEventId" AND inbox."organizationId" = NEW."organizationId" AND inbox."legalEntityId" = NEW."legalEntityId" AND inbox."eventType" = 'mesaops.physical-dispatch.completed.v1') THEN RAISE EXCEPTION 'dispatch evidence must reference a same-company dispatch handoff'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpItem" item WHERE item."id" = NEW."itemId" AND item."organizationId" = NEW."organizationId" AND item."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'dispatch item must belong to the same company'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpWarehouse" warehouse WHERE warehouse."id" = NEW."warehouseId" AND warehouse."organizationId" = NEW."organizationId" AND warehouse."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'dispatch warehouse must belong to the same company'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpCustomer" customer WHERE customer."id" = NEW."customerId" AND customer."organizationId" = NEW."organizationId" AND customer."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'dispatch customer must belong to the same company'; END IF;
    IF NEW."salesInvoiceId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ErpDocument" document WHERE document."id" = NEW."salesInvoiceId" AND document."organizationId" = NEW."organizationId" AND document."legalEntityId" = NEW."legalEntityId" AND document."documentType" = 'sales_invoice') THEN RAISE EXCEPTION 'dispatch invoice must be a same-company sales invoice'; END IF;
  END IF;

  IF TG_TABLE_NAME = 'ErpTdsRate' THEN
    IF NOT EXISTS (SELECT 1 FROM "ErpTdsSection" section WHERE section."id" = NEW."sectionId" AND section."organizationId" = NEW."organizationId" AND section."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS rate section must belong to the same company'; END IF;
  END IF;

  IF TG_TABLE_NAME = 'ErpVendorTdsClassification' THEN
    IF NOT EXISTS (SELECT 1 FROM "ErpVendor" vendor WHERE vendor."id" = NEW."vendorId" AND vendor."organizationId" = NEW."organizationId" AND vendor."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS classification vendor must belong to the same company'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpTdsSection" section WHERE section."id" = NEW."sectionId" AND section."organizationId" = NEW."organizationId" AND section."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS classification section must belong to the same company'; END IF;
  END IF;

  IF TG_TABLE_NAME = 'ErpTdsDeduction' THEN
    IF NOT EXISTS (SELECT 1 FROM "FinancialYear" year WHERE year."id" = NEW."financialYearId" AND year."organizationId" = NEW."organizationId" AND year."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS deduction year must belong to the same company'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpVendor" vendor WHERE vendor."id" = NEW."vendorId" AND vendor."organizationId" = NEW."organizationId" AND vendor."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS deduction vendor must belong to the same company'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpTdsSection" section WHERE section."id" = NEW."sectionId" AND section."organizationId" = NEW."organizationId" AND section."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS deduction section must belong to the same company'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpTdsRate" rate WHERE rate."id" = NEW."rateId" AND rate."organizationId" = NEW."organizationId" AND rate."legalEntityId" = NEW."legalEntityId" AND rate."sectionId" = NEW."sectionId") THEN RAISE EXCEPTION 'TDS deduction rate must belong to its company section'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpVendorTdsClassification" classification WHERE classification."id" = NEW."vendorClassificationId" AND classification."organizationId" = NEW."organizationId" AND classification."legalEntityId" = NEW."legalEntityId" AND classification."vendorId" = NEW."vendorId" AND classification."sectionId" = NEW."sectionId") THEN RAISE EXCEPTION 'TDS deduction classification must match its vendor and section'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ErpVoucher" voucher WHERE voucher."id" = NEW."payableVoucherId" AND voucher."organizationId" = NEW."organizationId" AND voucher."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS payable voucher must belong to the same company'; END IF;
    IF NEW."paymentVoucherId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ErpVoucher" voucher WHERE voucher."id" = NEW."paymentVoucherId" AND voucher."organizationId" = NEW."organizationId" AND voucher."legalEntityId" = NEW."legalEntityId") THEN RAISE EXCEPTION 'TDS payment voucher must belong to the same company'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_erp_tds_evidence() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" <> 'draft' THEN RAISE EXCEPTION 'reviewed TDS evidence is immutable'; END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'approved' THEN RAISE EXCEPTION 'approved TDS evidence is immutable'; END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'ErpTdsDeduction' THEN
    IF OLD."status" = 'submitted' AND (
      NEW."status" <> 'approved'
      OR ROW(NEW."organizationId",NEW."legalEntityId",NEW."financialYearId",NEW."vendorId",NEW."sectionId",NEW."rateId",NEW."vendorClassificationId",NEW."payableVoucherId",NEW."paymentVoucherId",NEW."businessDate",NEW."grossAmount",NEW."priorAggregateBase",NEW."taxableBase",NEW."appliedRate",NEW."deductionAmount",NEW."calculationSnapshot",NEW."evidenceHash",NEW."createdBy",NEW."submittedAt",NEW."createdAt")
         IS DISTINCT FROM
         ROW(OLD."organizationId",OLD."legalEntityId",OLD."financialYearId",OLD."vendorId",OLD."sectionId",OLD."rateId",OLD."vendorClassificationId",OLD."payableVoucherId",OLD."paymentVoucherId",OLD."businessDate",OLD."grossAmount",OLD."priorAggregateBase",OLD."taxableBase",OLD."appliedRate",OLD."deductionAmount",OLD."calculationSnapshot",OLD."evidenceHash",OLD."createdBy",OLD."submittedAt",OLD."createdAt")
    ) THEN RAISE EXCEPTION 'submitted TDS calculation evidence is immutable'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
