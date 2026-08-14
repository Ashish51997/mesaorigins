-- One submitted packed roll/unit may receive one recorded QA decision per
-- plant. Legacy data correctly contains several roll numbers within one lot,
-- so database finality keys on rollNumber; current MesaOps packed units use
-- their lot identifier as rollNumber when the inspection is recorded.
-- The retained-data preflight must show no duplicate nonblank roll identifiers
-- before deployment. A partial unique index then provides the database
-- serialization point for concurrent API, import and alternate-writer paths.
-- No historical inspection is rewritten or deleted.
CREATE INDEX "QualityInspection_organizationId_plantCode_lotNumber_idx"
ON "QualityInspection" ("organizationId", "plantCode", "lotNumber");

CREATE UNIQUE INDEX "QualityInspection_organizationId_plantCode_rollNumber_key"
ON "QualityInspection" ("organizationId", "plantCode", "rollNumber")
WHERE length(btrim("rollNumber")) > 0;

ALTER TABLE "QualityInspection"
ADD CONSTRAINT "QualityInspection_positive_weight"
CHECK ("weight" > 0) NOT VALID;

-- Existing legacy evidence is preserved. Every new or changed inspection is
-- checked immediately; a later controlled cleanup may VALIDATE the constraint.

CREATE OR REPLACE FUNCTION protect_quality_inspection_evidence() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'quality inspection evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "QualityInspection_immutable"
BEFORE UPDATE OR DELETE ON "QualityInspection"
FOR EACH ROW EXECUTE FUNCTION protect_quality_inspection_evidence();

CREATE OR REPLACE FUNCTION require_manufacturing_qa_before_review() RETURNS trigger AS $$
BEGIN
  IF ((OLD."status" = 'draft' AND NEW."status" = 'submitted')
       OR (OLD."status" = 'submitted' AND NEW."status" = 'approved'))
     AND NEW."voucherType" IN ('manufacturing', 'completion', 'rework')
     AND COALESCE(NEW."qaDisposition"->>'status', '') NOT IN ('accepted', 'not_applicable') THEN
    RAISE EXCEPTION 'manufacturing completion requires accepted QA before review';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ErpManufacturingVoucher_qa_before_review"
BEFORE UPDATE OF "status" ON "ErpManufacturingVoucher"
FOR EACH ROW EXECUTE FUNCTION require_manufacturing_qa_before_review();
