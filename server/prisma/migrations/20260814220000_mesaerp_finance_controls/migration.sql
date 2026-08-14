-- MesaERP finance controls. Additive only: existing accounting evidence is
-- preserved and no opening balance or customer record is rewritten.

ALTER TABLE "ErpAccount"
  ADD COLUMN "classification" TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN "cashFlowClass" TEXT NOT NULL DEFAULT 'operating';

UPDATE "ErpAccount" SET "classification" = CASE
  WHEN "code" = '1000' THEN 'cash' WHEN "code" = '1010' THEN 'bank'
  WHEN "code" = '1100' THEN 'receivable' WHEN "code" LIKE '20%' THEN 'payable'
  WHEN "code" = '3000' THEN 'equity' WHEN "code" = '4000' THEN 'revenue'
  WHEN "code" = '5100' THEN 'cogs' WHEN "code" LIKE '12%' THEN 'inventory'
  WHEN "code" LIKE '13%' OR "code" LIKE '21%' THEN 'tax'
  WHEN "accountType" = 'expense' THEN 'operating_expense' ELSE 'other' END,
  "cashFlowClass" = CASE WHEN "code" IN ('1000','1010') THEN 'cash'
    WHEN "code" LIKE '11%' OR "code" LIKE '12%' OR "code" LIKE '20%' OR "code" LIKE '4%' OR "code" LIKE '5%' THEN 'operating'
    ELSE 'non_cash' END,
  "reconciliationRequired" = CASE WHEN "code" = '1010' THEN true ELSE "reconciliationRequired" END;

ALTER TABLE "ErpBankReconciliation"
  ADD COLUMN "sourceHash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "requestHash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "completedBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "completionEvidence" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "ErpAsset"
  ADD COLUMN "accumulatedImpairment" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "depreciationThrough" DATE,
  ADD COLUMN "accountingProfile" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "originMetadata" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "sourceSnapshotHash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "createIdempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "approvedBy" TEXT NOT NULL DEFAULT '';

ALTER TABLE "ErpBudget"
  ADD COLUMN "createIdempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "sourceSnapshotHash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "approvedBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "submittedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ErpAsset_create_idempotency_key"
ON "ErpAsset"("organizationId", "legalEntityId", "createIdempotencyKey");
CREATE UNIQUE INDEX "ErpBudget_create_idempotency_key"
ON "ErpBudget"("organizationId", "legalEntityId", "createIdempotencyKey");

CREATE TABLE "ErpAssetEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "voucherId" TEXT,
  "eventType" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "financialYearId" TEXT,
  "accountingPeriodId" TEXT,
  "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "proceeds" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending_voucher',
  "calculationSnapshot" JSONB NOT NULL DEFAULT '{}',
  "fromLocation" JSONB NOT NULL DEFAULT '{}',
  "toLocation" JSONB NOT NULL DEFAULT '{}',
  "sourceSnapshotHash" TEXT NOT NULL,
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "completedBy" TEXT NOT NULL DEFAULT '',
  "completedAt" TIMESTAMP(3),
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpAssetEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpAssetEvent_type_check" CHECK ("eventType" IN ('capitalization','transfer','depreciation','impairment','disposal')),
  CONSTRAINT "ErpAssetEvent_status_check" CHECK ("status" IN ('pending_voucher','completed')),
  CONSTRAINT "ErpAssetEvent_amount_check" CHECK ("amount" >= 0 AND "proceeds" >= 0),
  CONSTRAINT "ErpAssetEvent_hash_check" CHECK ("sourceSnapshotHash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "ErpIntercompanyPair" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceLegalEntityId" TEXT NOT NULL,
  "targetLegalEntityId" TEXT NOT NULL,
  "sourceVoucherId" TEXT NOT NULL,
  "targetVoucherId" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "sourceCurrency" TEXT NOT NULL,
  "targetCurrency" TEXT NOT NULL,
  "sourceAmount" DECIMAL(18,2) NOT NULL,
  "targetAmount" DECIMAL(18,2) NOT NULL,
  "exchangeRate" DECIMAL(18,8) NOT NULL,
  "rateEffectiveFrom" DATE NOT NULL,
  "rateEffectiveTo" DATE,
  "rateSourceReference" TEXT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "sourceSnapshotHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpIntercompanyPair_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ErpIntercompanyPair_entities_check" CHECK ("sourceLegalEntityId" <> "targetLegalEntityId"),
  CONSTRAINT "ErpIntercompanyPair_values_check" CHECK ("sourceAmount" > 0 AND "targetAmount" > 0 AND "exchangeRate" > 0),
  CONSTRAINT "ErpIntercompanyPair_dates_check" CHECK ("rateEffectiveTo" IS NULL OR "rateEffectiveTo" >= "rateEffectiveFrom"),
  CONSTRAINT "ErpIntercompanyPair_hash_check" CHECK ("sourceSnapshotHash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "ErpAssetEvent_idempotency_key" ON "ErpAssetEvent"("organizationId", "legalEntityId", "createIdempotencyKey");
CREATE UNIQUE INDEX "ErpAssetEvent_voucher_key" ON "ErpAssetEvent"("organizationId", "voucherId");
CREATE INDEX "ErpAssetEvent_org_idx" ON "ErpAssetEvent"("organizationId");
CREATE INDEX "ErpAssetEvent_asset_idx" ON "ErpAssetEvent"("legalEntityId", "assetId", "businessDate");
CREATE UNIQUE INDEX "ErpIntercompanyPair_idempotency_key" ON "ErpIntercompanyPair"("organizationId", "createIdempotencyKey");
CREATE UNIQUE INDEX "ErpIntercompanyPair_source_voucher_key" ON "ErpIntercompanyPair"("organizationId", "sourceVoucherId");
CREATE UNIQUE INDEX "ErpIntercompanyPair_target_voucher_key" ON "ErpIntercompanyPair"("organizationId", "targetVoucherId");
CREATE INDEX "ErpIntercompanyPair_org_idx" ON "ErpIntercompanyPair"("organizationId");
CREATE INDEX "ErpIntercompanyPair_entities_idx" ON "ErpIntercompanyPair"("sourceLegalEntityId", "targetLegalEntityId", "businessDate");

ALTER TABLE "ErpAssetEvent" ADD CONSTRAINT "ErpAssetEvent_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpAssetEvent" ADD CONSTRAINT "ErpAssetEvent_entity_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpAssetEvent" ADD CONSTRAINT "ErpAssetEvent_asset_fkey" FOREIGN KEY ("assetId") REFERENCES "ErpAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpAssetEvent" ADD CONSTRAINT "ErpAssetEvent_voucher_fkey" FOREIGN KEY ("voucherId") REFERENCES "ErpVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpAssetEvent" ADD CONSTRAINT "ErpAssetEvent_year_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpAssetEvent" ADD CONSTRAINT "ErpAssetEvent_period_fkey" FOREIGN KEY ("accountingPeriodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpIntercompanyPair" ADD CONSTRAINT "ErpIntercompanyPair_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpIntercompanyPair" ADD CONSTRAINT "ErpIntercompanyPair_source_entity_fkey" FOREIGN KEY ("sourceLegalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpIntercompanyPair" ADD CONSTRAINT "ErpIntercompanyPair_target_entity_fkey" FOREIGN KEY ("targetLegalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpIntercompanyPair" ADD CONSTRAINT "ErpIntercompanyPair_source_voucher_fkey" FOREIGN KEY ("sourceVoucherId") REFERENCES "ErpVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ErpIntercompanyPair" ADD CONSTRAINT "ErpIntercompanyPair_target_voucher_fkey" FOREIGN KEY ("targetVoucherId") REFERENCES "ErpVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ErpVoucher" DROP CONSTRAINT "ErpVoucher_type_check";
ALTER TABLE "ErpVoucher" ADD CONSTRAINT "ErpVoucher_type_check" CHECK ("voucherType" IN (
  'contra','payment','receipt','journal','sales','purchase','credit_note','debit_note',
  'stock_journal','manufacturing_journal','opening','depreciation','fx_adjustment',
  'intercompany','consolidation_elimination'
));

ALTER TABLE "ErpAccount" ADD CONSTRAINT "ErpAccount_classification_check" CHECK ("classification" IN (
  'cash','bank','receivable','inventory','fixed_asset','accumulated_depreciation','payable','tax',
  'equity','revenue','cogs','operating_expense','other_income','other_expense','intercompany','elimination','other'
));
ALTER TABLE "ErpAccount" ADD CONSTRAINT "ErpAccount_cashflow_check" CHECK ("cashFlowClass" IN ('operating','investing','financing','cash','non_cash'));
ALTER TABLE "ErpBankReconciliation" ADD CONSTRAINT "ErpBankReconciliation_status_check" CHECK ("status" IN ('in_progress','completed'));
ALTER TABLE "ErpAsset" ADD CONSTRAINT "ErpAsset_method_check" CHECK ("depreciationMethod" IN ('slm','wdv'));
ALTER TABLE "ErpAsset" ADD CONSTRAINT "ErpAsset_status_check" CHECK ("status" IN ('under_construction','active','disposed'));
ALTER TABLE "ErpAsset" ADD CONSTRAINT "ErpAsset_values_check" CHECK (
  "acquisitionCost" > 0 AND "residualValue" >= 0 AND "residualValue" <= "acquisitionCost"
  AND "usefulLifeMonths" > 0 AND "accumulatedDepreciation" >= 0 AND "accumulatedImpairment" >= 0 AND "netBookValue" >= 0
);
ALTER TABLE "ErpBudget" ADD CONSTRAINT "ErpBudget_status_check" CHECK ("status" IN ('draft','submitted','approved'));

-- Parent ledgers must stay within the same tenant and company, and a ledger
-- cannot be placed beneath one of its descendants.
CREATE OR REPLACE FUNCTION enforce_erp_account_tree() RETURNS trigger AS $$
DECLARE parent_org TEXT; parent_entity TEXT;
BEGIN
  IF NEW."parentId" IS NULL THEN RETURN NEW; END IF;
  IF NEW."parentId" = NEW."id" THEN RAISE EXCEPTION 'account cannot parent itself'; END IF;
  SELECT "organizationId", "legalEntityId" INTO parent_org, parent_entity FROM "ErpAccount" WHERE "id" = NEW."parentId";
  IF parent_org IS NULL OR parent_org <> NEW."organizationId" OR parent_entity <> NEW."legalEntityId" THEN
    RAISE EXCEPTION 'account parent must belong to the same company';
  END IF;
  IF EXISTS (
    WITH RECURSIVE descendants AS (
      SELECT "id" FROM "ErpAccount" WHERE "parentId" = NEW."id"
      UNION ALL SELECT account."id" FROM "ErpAccount" account JOIN descendants d ON account."parentId" = d."id"
    ) SELECT 1 FROM descendants WHERE "id" = NEW."parentId"
  ) THEN RAISE EXCEPTION 'account hierarchy cycle'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpAccount_tree_integrity" BEFORE INSERT OR UPDATE OF "parentId", "legalEntityId", "organizationId" ON "ErpAccount" FOR EACH ROW EXECUTE FUNCTION enforce_erp_account_tree();

-- Period states only advance open -> soft_closed -> locked. Reopening requires
-- an explicit reason and actor; the API additionally enforces the dedicated
-- mesaerp.period.reopen permission and optimistic row version.
CREATE OR REPLACE FUNCTION enforce_erp_period_transition() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = OLD."status" THEN RETURN NEW; END IF;
  IF OLD."status" = 'open' AND NEW."status" = 'soft_closed' THEN RETURN NEW; END IF;
  IF OLD."status" = 'soft_closed' AND NEW."status" = 'locked' THEN RETURN NEW; END IF;
  IF NEW."status" = 'open' AND OLD."status" IN ('soft_closed','locked')
     AND length(trim(NEW."reopenedReason")) >= 5 AND length(trim(NEW."reopenedBy")) > 0 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid accounting period lifecycle transition';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AccountingPeriod_lifecycle" BEFORE UPDATE OF "status" ON "AccountingPeriod" FOR EACH ROW EXECUTE FUNCTION enforce_erp_period_transition();

-- Evidence identity is immutable. The posting hook may only attach a voucher
-- and complete the event while preserving the approved calculation snapshot.
CREATE OR REPLACE FUNCTION protect_erp_asset_event() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'asset event evidence is immutable'; END IF;
  IF ROW(NEW."organizationId",NEW."legalEntityId",NEW."assetId",NEW."eventType",NEW."businessDate",NEW."amount",NEW."proceeds",NEW."calculationSnapshot",NEW."fromLocation",NEW."toLocation",NEW."sourceSnapshotHash",NEW."createdBy",NEW."createdAt")
     IS DISTINCT FROM ROW(OLD."organizationId",OLD."legalEntityId",OLD."assetId",OLD."eventType",OLD."businessDate",OLD."amount",OLD."proceeds",OLD."calculationSnapshot",OLD."fromLocation",OLD."toLocation",OLD."sourceSnapshotHash",OLD."createdBy",OLD."createdAt") THEN
    RAISE EXCEPTION 'asset event calculation evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpAssetEvent_immutable_evidence" BEFORE UPDATE OR DELETE ON "ErpAssetEvent" FOR EACH ROW EXECUTE FUNCTION protect_erp_asset_event();

-- Dedicated finance workflows insert a complete draft and then seal it by
-- changing originType to finance_control. Once sealed, the accounting mapping
-- and every line are immutable while ordinary lifecycle fields may advance.
CREATE OR REPLACE FUNCTION protect_erp_finance_control_voucher() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."originType" = 'finance_control' THEN
    RAISE EXCEPTION 'finance-control voucher evidence is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."originType" = 'finance_control' AND ROW(
    NEW."organizationId",NEW."legalEntityId",NEW."financialYearId",NEW."accountingPeriodId",NEW."voucherType",NEW."businessDate",
    NEW."currency",NEW."exchangeRate",NEW."transactionDebit",NEW."transactionCredit",NEW."baseDebit",NEW."baseCredit",
    NEW."reference",NEW."narration",NEW."sourceDocumentId",NEW."reversalOfId",NEW."dimensions",NEW."originType",NEW."originMetadata",NEW."requestHash",NEW."createdBy"
  ) IS DISTINCT FROM ROW(
    OLD."organizationId",OLD."legalEntityId",OLD."financialYearId",OLD."accountingPeriodId",OLD."voucherType",OLD."businessDate",
    OLD."currency",OLD."exchangeRate",OLD."transactionDebit",OLD."transactionCredit",OLD."baseDebit",OLD."baseCredit",
    OLD."reference",OLD."narration",OLD."sourceDocumentId",OLD."reversalOfId",OLD."dimensions",OLD."originType",OLD."originMetadata",OLD."requestHash",OLD."createdBy"
  ) THEN RAISE EXCEPTION 'finance-control voucher mapping is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpVoucher_protect_finance_control" BEFORE UPDATE OR DELETE ON "ErpVoucher" FOR EACH ROW EXECUTE FUNCTION protect_erp_finance_control_voucher();

CREATE OR REPLACE FUNCTION protect_erp_finance_control_voucher_line() RETURNS trigger AS $$
DECLARE finance_control BOOLEAN;
BEGIN
  SELECT "originType" = 'finance_control' INTO finance_control FROM "ErpVoucher" WHERE "id" = COALESCE(NEW."voucherId", OLD."voucherId");
  IF finance_control THEN RAISE EXCEPTION 'finance-control voucher lines are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ErpVoucherLine_protect_finance_control" BEFORE INSERT OR UPDATE OR DELETE ON "ErpVoucherLine" FOR EACH ROW EXECUTE FUNCTION protect_erp_finance_control_voucher_line();

INSERT INTO "Permission" ("id","serviceId","key","label","description","riskLevel") VALUES
  ('mesaerp.account.manage','mesaerp','mesaerp.account.manage','Manage chart of accounts','Create and change company ledger accounts.','high'),
  ('mesaerp.period.manage','mesaerp','mesaerp.period.manage','Close accounting periods','Soft-close and lock company accounting periods.','high'),
  ('mesaerp.intercompany.manage','mesaerp','mesaerp.intercompany.manage','Manage intercompany pairs','Create paired intercompany voucher drafts across explicitly authorized companies.','high'),
  ('mesaerp.consolidation.manage','mesaerp','mesaerp.consolidation.manage','Run consolidation reports','Translate supplied company balances and include only explicit eliminations.','high')
ON CONFLICT ("id") DO UPDATE SET "label" = EXCLUDED."label", "description" = EXCLUDED."description", "riskLevel" = EXCLUDED."riskLevel";

INSERT INTO "RolePermission" ("id","organizationId","roleId","permissionId","effect","createdAt")
SELECT 'finance-control-' || md5(role."id" || permission."id"), role."organizationId", role."id", permission."id", 'allow', CURRENT_TIMESTAMP
FROM "Role" role JOIN "Permission" permission ON permission."id" IN ('mesaerp.account.manage','mesaerp.period.manage','mesaerp.intercompany.manage','mesaerp.consolidation.manage')
WHERE role."erpLegalEntityId" IS NOT NULL AND role."name" LIKE '% MesaERP Administrator'
ON CONFLICT ("organizationId","roleId","permissionId") DO NOTHING;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['ErpAssetEvent','ErpIntercompanyPair'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_tenant'', true)) WITH CHECK ("organizationId" = current_setting(''app.current_tenant'', true));', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO app_user;', table_name);
  END LOOP;
END $$;
