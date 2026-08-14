import { randomUUID } from 'node:crypto';
import { Prisma, type ErpAccount, type ErpAsset, type ErpBudget, type ErpVoucher } from '@prisma/client';
import { basePrisma, tenantTx } from '../db';
import { audit } from '../lib/audit';
import { tenantContext, type TenantCtx } from '../lib/tenantContext';
import { ApiError } from '../middleware/error';
import { hasMesaErpPermission } from './access';
import { hashCanonical } from './repository';
import type {
  AssetCapitalize, AssetCreate, AssetDepreciation, AssetDisposal, AssetImpairment, AssetTransfer,
  BankLineAction, BankStatementImport, BudgetCreate, ConsolidationEliminationCreate, ConsolidationReport, FinanceAccountCreate,
  FinanceAccountUpdate, FinanceReportQuery, IntercompanyCreate, PeriodTransition,
} from './financeControlSchemas';

type Db = typeof basePrisma;
type JsonRecord = Record<string, unknown>;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const zero = () => new Prisma.Decimal(0);
const day = (value: Date) => value.toISOString().slice(0, 10);
const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
const record = (value: Prisma.JsonValue | null): JsonRecord => (!value || Array.isArray(value) || typeof value !== 'object' ? {} : value as JsonRecord);
const rows = (value: Prisma.JsonValue): JsonRecord[] => Array.isArray(value)
  ? value.filter((entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)).map((entry) => entry as JsonRecord)
  : [];

function actor(): TenantCtx {
  const context = tenantContext.getStore();
  if (!context) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return context;
}

async function requireEntity(db: Db, context: TenantCtx, legalEntityId: string) {
  const entity = await db.legalEntity.findFirst({ where: { id: legalEntityId, organizationId: context.organizationId, status: 'active' } });
  if (!entity) throw new ApiError(404, 'legal_entity_not_found', 'Legal entity not found or inactive.');
  return entity;
}

async function yearAndPeriod(db: Db, legalEntityId: string, businessDate: Date) {
  const year = await db.financialYear.findFirst({ where: { legalEntityId, startsOn: { lte: businessDate }, endsOn: { gte: businessDate } } });
  if (!year) throw new ApiError(409, 'financial_year_missing', 'No financial year covers this business date.');
  const period = await db.accountingPeriod.findFirst({ where: { financialYearId: year.id, startsOn: { lte: businessDate }, endsOn: { gte: businessDate } } });
  if (!period) throw new ApiError(409, 'accounting_period_missing', 'No accounting period covers this business date.');
  if (period.status !== 'open') throw new ApiError(409, 'period_closed', `The ${period.name} period is ${period.status}.`);
  return { year, period };
}

async function replay<T>(db: Db, organizationId: string, scope: string, key: string, requestHash: string): Promise<T | null> {
  const saved = await db.erpIdempotencyRecord.findUnique({ where: { organizationId_scope_key: { organizationId, scope, key } } });
  if (!saved) return null;
  if (saved.requestHash !== requestHash) throw new ApiError(409, 'idempotency_conflict', 'This Idempotency-Key was already used with a different request.');
  return structuredClone(saved.response) as T;
}

async function runIdempotent<T>(input: {
  legalEntityId: string; scope: string; key: string; payload: unknown;
  execute: (db: Db, context: TenantCtx) => Promise<T>;
}): Promise<T> {
  const context = actor();
  const requestHash = hashCanonical({ legalEntityId: input.legalEntityId, payload: input.payload });
  const attempt = () => tenantTx(async (db) => {
    const existing = await replay<T>(db, context.organizationId, input.scope, input.key, requestHash);
    if (existing) return existing;
    await requireEntity(db, context, input.legalEntityId);
    await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.organizationId}:${input.scope}:${input.key}`}))`);
    const afterLock = await replay<T>(db, context.organizationId, input.scope, input.key, requestHash);
    if (afterLock) return afterLock;
    const response = await input.execute(db, context);
    await db.erpIdempotencyRecord.create({ data: { organizationId: context.organizationId, legalEntityId: input.legalEntityId, scope: input.scope, key: input.key, requestHash, response: json(response) } });
    return response;
  });
  try { return await attempt(); } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    return tenantTx(async (db) => {
      const existing = await replay<T>(db, context.organizationId, input.scope, input.key, requestHash);
      if (existing) return existing;
      throw error;
    });
  }
}

async function appendOutbox(db: Db, context: TenantCtx, legalEntityId: string, aggregateType: string, aggregateId: string, eventType: string, payload: unknown) {
  const payloadHash = hashCanonical(payload);
  await db.integrationOutboxEvent.create({ data: {
    organizationId: context.organizationId, legalEntityId, serviceId: 'mesaerp', aggregateType, aggregateId,
    eventType, correlationId: randomUUID(), payload: json(payload), payloadHash,
  } });
  return payloadHash;
}

function accountDto(account: ErpAccount) {
  return {
    id: account.id, organizationId: account.organizationId, legalEntityId: account.legalEntityId,
    code: account.code, name: account.name, accountType: account.accountType,
    classification: account.classification, cashFlowClass: account.cashFlowClass,
    parentId: account.parentId, currency: account.currency, allowPosting: account.allowPosting,
    reconciliationRequired: account.reconciliationRequired, active: account.active,
    rowVersion: account.rowVersion, createdAt: account.createdAt.toISOString(), updatedAt: account.updatedAt.toISOString(),
  };
}

function assetDto(asset: ErpAsset) {
  return {
    ...asset,
    acquisitionDate: day(asset.acquisitionDate), capitalizationDate: asset.capitalizationDate ? day(asset.capitalizationDate) : null,
    acquisitionCost: asset.acquisitionCost.toString(), residualValue: asset.residualValue.toString(), depreciationRate: asset.depreciationRate.toString(),
    accumulatedDepreciation: asset.accumulatedDepreciation.toString(), accumulatedImpairment: asset.accumulatedImpairment.toString(), netBookValue: asset.netBookValue.toString(),
    depreciationThrough: asset.depreciationThrough ? day(asset.depreciationThrough) : null,
    disposedAt: asset.disposedAt?.toISOString() ?? null, createdAt: asset.createdAt.toISOString(), updatedAt: asset.updatedAt.toISOString(),
  };
}

function budgetDto(budget: ErpBudget) {
  return {
    ...budget, totalAmount: budget.totalAmount.toString(), approvedAt: budget.approvedAt?.toISOString() ?? null,
    submittedAt: budget.submittedAt?.toISOString() ?? null, createdAt: budget.createdAt.toISOString(), updatedAt: budget.updatedAt.toISOString(),
  };
}

async function resolveAccounts(db: Db, legalEntityId: string, references: string[]) {
  const unique = [...new Set(references)];
  const found = await db.erpAccount.findMany({ where: { legalEntityId, active: true, OR: [{ id: { in: unique } }, { code: { in: unique } }] } });
  const byReference = new Map(found.flatMap((account) => [[account.id, account], [account.code, account]] as const));
  const missing = unique.filter((reference) => !byReference.has(reference));
  if (missing.length) throw new ApiError(422, 'ledger_account_missing', `Unknown company account: ${missing.join(', ')}.`);
  return byReference;
}

type DraftLine = { accountId: string; debit: string; credit: string; narration?: string; dimensions?: JsonRecord };
async function createDraftVoucher(db: Db, context: TenantCtx, input: {
  legalEntityId: string; voucherType: string; businessDate: string; currency: string; reference: string; narration: string;
  originMetadata: JsonRecord; createIdempotencyKey: string; lines: DraftLine[];
}) {
  const entity = await requireEntity(db, context, input.legalEntityId);
  if (entity.baseCurrency !== input.currency) throw new ApiError(422, 'base_currency_required', 'Finance-control drafts must use the company base currency.');
  const when = dateOnly(input.businessDate);
  const { year, period } = await yearAndPeriod(db, input.legalEntityId, when);
  const accounts = await resolveAccounts(db, input.legalEntityId, input.lines.map((line) => line.accountId));
  const normalized = input.lines.map((line) => ({ ...line, account: accounts.get(line.accountId)! }));
  if (normalized.some((line) => !line.account.allowPosting)) throw new ApiError(422, 'control_account_not_postable', 'Every voucher line must reference a posting-enabled account.');
  const debit = normalized.reduce((total, line) => total.plus(line.debit), zero());
  const credit = normalized.reduce((total, line) => total.plus(line.credit), zero());
  if (debit.lte(0) || !debit.equals(credit)) throw new ApiError(422, 'voucher_unbalanced', 'Finance-control voucher lines must be non-zero and balanced.');
  const draft = await db.erpVoucher.create({ data: {
    organizationId: context.organizationId, legalEntityId: input.legalEntityId, financialYearId: year.id, accountingPeriodId: period.id,
    voucherType: input.voucherType, voucherNumber: `DRAFT-${randomUUID()}`, businessDate: when, currency: input.currency,
    transactionDebit: debit, transactionCredit: credit, baseDebit: debit, baseCredit: credit,
    reference: input.reference, narration: input.narration, originType: 'manual', originMetadata: {},
    createIdempotencyKey: input.createIdempotencyKey, requestHash: hashCanonical(input), createdBy: context.membershipId,
    lines: { create: normalized.map((line, index) => ({
      organizationId: context.organizationId, legalEntityId: input.legalEntityId, lineNumber: index + 1,
      accountId: line.account.id, accountSnapshot: { code: line.account.code, name: line.account.name },
      transactionDebit: line.debit, transactionCredit: line.credit, baseDebit: line.debit, baseCredit: line.credit,
      narration: line.narration ?? '', dimensions: json(line.dimensions ?? {}),
    })) },
  }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
  await db.erpVoucher.update({ where: { id: draft.id }, data: { originType: 'finance_control', originMetadata: json(input.originMetadata) } });
  return db.erpVoucher.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
}

function voucherSummary(voucher: ErpVoucher & { lines?: Array<{ id: string; lineNumber: number; accountId: string; baseDebit: Prisma.Decimal; baseCredit: Prisma.Decimal }> }) {
  return {
    id: voucher.id, legalEntityId: voucher.legalEntityId, voucherType: voucher.voucherType,
    voucherNumber: voucher.voucherNumber.startsWith('DRAFT-') ? null : voucher.voucherNumber,
    businessDate: day(voucher.businessDate), status: voucher.status, currency: voucher.currency,
    baseDebit: voucher.baseDebit.toString(), baseCredit: voucher.baseCredit.toString(), reference: voucher.reference,
    rowVersion: voucher.rowVersion,
    ...(voucher.lines ? { lines: voucher.lines.map((line) => ({ id: line.id, lineNumber: line.lineNumber, accountId: line.accountId, debit: line.baseDebit.toString(), credit: line.baseCredit.toString() })) } : {}),
  };
}

export class PrismaMesaErpFinanceControlService {
  hasPermission(input: { organizationId: string; membershipId: string; legalEntityId: string; permission: string }) { return hasMesaErpPermission(input); }

  async accountTree(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const accounts = await db.erpAccount.findMany({ where: { legalEntityId }, orderBy: [{ code: 'asc' }] });
      const nodes = new Map(accounts.map((account) => [account.id, { ...accountDto(account), children: [] as unknown[] }]));
      const roots: unknown[] = [];
      for (const account of accounts) {
        const node = nodes.get(account.id)!;
        const parent = account.parentId ? nodes.get(account.parentId) : undefined;
        if (parent) parent.children.push(node); else roots.push(node);
      }
      return roots;
    });
  }

  createAccount(legalEntityId: string, input: FinanceAccountCreate, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:account:create:${legalEntityId}`, key, payload: input, execute: async (db, context) => {
      const entity = await requireEntity(db, context, legalEntityId);
      if (input.parentId) {
        const parent = await db.erpAccount.findFirst({ where: { id: input.parentId, legalEntityId } });
        if (!parent) throw new ApiError(422, 'account_parent_missing', 'Parent account does not belong to this company.');
      }
      if (input.currency !== entity.baseCurrency) throw new ApiError(422, 'account_currency_unsupported', 'V1 posting accounts use the company base currency.');
      const created = await db.erpAccount.create({ data: { organizationId: context.organizationId, legalEntityId, ...input } });
      const response = accountDto(created);
      await audit(db, { action: 'mesaerp.account.create', entity: 'ErpAccount', entityId: created.id, after: response });
      await appendOutbox(db, context, legalEntityId, 'ErpAccount', created.id, 'mesaerp.account.created.v1', response);
      return response;
    } });
  }

  updateAccount(legalEntityId: string, accountId: string, input: FinanceAccountUpdate, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:account:${accountId}:update`, key, payload: input, execute: async (db, context) => {
      const existing = await db.erpAccount.findFirst({ where: { id: accountId, legalEntityId } });
      if (!existing) throw new ApiError(404, 'account_not_found', 'Account not found in this company.');
      if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Account changed since it was loaded.');
      if (input.parentId) {
        const parent = await db.erpAccount.findFirst({ where: { id: input.parentId, legalEntityId } });
        if (!parent) throw new ApiError(422, 'account_parent_missing', 'Parent account does not belong to this company.');
      }
      const used = await db.erpVoucherLine.findFirst({ where: { accountId }, select: { id: true } });
      if (used && ((input.accountType && input.accountType !== existing.accountType) || (input.currency && input.currency !== existing.currency))) {
        throw new ApiError(409, 'account_classification_immutable', 'Account type and currency cannot change after the first voucher line.');
      }
      const { expectedRowVersion: _version, ...changes } = input;
      const changed = await db.erpAccount.updateMany({ where: { id: accountId, legalEntityId, rowVersion: input.expectedRowVersion }, data: { ...changes, rowVersion: { increment: 1 } } });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Account changed while the update was saved.');
      const updated = await db.erpAccount.findUniqueOrThrow({ where: { id: accountId } });
      const response = accountDto(updated);
      await audit(db, { action: 'mesaerp.account.update', entity: 'ErpAccount', entityId: accountId, before: accountDto(existing), after: response });
      await appendOutbox(db, context, legalEntityId, 'ErpAccount', accountId, 'mesaerp.account.updated.v1', response);
      return response;
    } });
  }

  async listPeriods(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      return (await db.accountingPeriod.findMany({ where: { legalEntityId }, orderBy: [{ startsOn: 'desc' }] })).map((period) => ({
        ...period, startsOn: day(period.startsOn), endsOn: day(period.endsOn), createdAt: period.createdAt.toISOString(), updatedAt: period.updatedAt.toISOString(),
      }));
    });
  }

  transitionPeriod(legalEntityId: string, periodId: string, target: 'soft_closed' | 'locked' | 'open', input: PeriodTransition, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:period:${periodId}:${target}`, key, payload: input, execute: async (db, context) => {
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "AccountingPeriod" WHERE "id" = ${periodId} FOR UPDATE`);
      const existing = await db.accountingPeriod.findFirst({ where: { id: periodId, legalEntityId } });
      if (!existing) throw new ApiError(404, 'accounting_period_not_found', 'Accounting period not found in this company.');
      if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Accounting period changed since it was loaded.');
      const expected = target === 'soft_closed' ? 'open' : target === 'locked' ? 'soft_closed' : undefined;
      if ((expected && existing.status !== expected) || (target === 'open' && !['soft_closed', 'locked'].includes(existing.status))) {
        throw new ApiError(409, 'invalid_period_transition', `Cannot move an accounting period from ${existing.status} to ${target}.`);
      }
      const changed = await db.accountingPeriod.updateMany({ where: { id: periodId, legalEntityId, status: existing.status, rowVersion: input.expectedRowVersion }, data: {
        status: target, ...(target === 'open' ? { reopenedReason: input.reason, reopenedBy: context.membershipId } : {}), rowVersion: { increment: 1 },
      } });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Accounting period changed while the transition was saved.');
      const updated = await db.accountingPeriod.findUniqueOrThrow({ where: { id: periodId } });
      const response = { ...updated, startsOn: day(updated.startsOn), endsOn: day(updated.endsOn), createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() };
      const action = target === 'open' ? 'mesaerp.period.reopen' : target === 'locked' ? 'mesaerp.period.lock' : 'mesaerp.period.soft_close';
      const evidence = { period: response, reason: input.reason, actorMembershipId: context.membershipId };
      await audit(db, { action, entity: 'AccountingPeriod', entityId: periodId, before: existing, after: evidence });
      await appendOutbox(db, context, legalEntityId, 'AccountingPeriod', periodId, `${action}.v1`, evidence);
      return response;
    } });
  }

  async listBankReconciliations(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const reconciliations = await db.erpBankReconciliation.findMany({ where: { legalEntityId }, orderBy: [{ statementTo: 'desc' }, { createdAt: 'desc' }], take: 250 });
      return reconciliations.map((row) => this.bankDto(row));
    });
  }

  async getBankReconciliation(legalEntityId: string, reconciliationId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const found = await db.erpBankReconciliation.findFirst({ where: { id: reconciliationId, legalEntityId } });
      if (!found) throw new ApiError(404, 'bank_reconciliation_not_found', 'Bank reconciliation not found in this company.');
      return this.bankDto(found);
    });
  }

  private bankDto(row: Awaited<ReturnType<Db['erpBankReconciliation']['findFirstOrThrow']>>) {
    return {
      ...row, openingBalance: row.openingBalance.toString(), closingBalance: row.closingBalance.toString(),
      matchedTotal: row.matchedTotal.toString(), unmatchedTotal: row.unmatchedTotal.toString(),
      statementFrom: day(row.statementFrom), statementTo: day(row.statementTo), completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  importBankStatement(legalEntityId: string, input: BankStatementImport, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:bank-statement:import:${legalEntityId}`, key, payload: input, execute: async (db, context) => {
      const bankAccount = await db.erpAccount.findFirst({ where: { id: input.bankAccountId, legalEntityId, active: true } });
      if (!bankAccount || bankAccount.classification !== 'bank' || !bankAccount.reconciliationRequired) {
        throw new ApiError(422, 'bank_account_invalid', 'Statement account must be an active bank account marked for reconciliation.');
      }
      const lineIds = new Set(input.lines.map((line) => line.lineId));
      if (lineIds.size !== input.lines.length) throw new ApiError(422, 'statement_line_duplicate', 'Statement line IDs must be unique.');
      const sourceEvidence = {
        version: 1, bankAccountId: input.bankAccountId, statementReference: input.statementReference,
        statementFrom: input.statementFrom, statementTo: input.statementTo, openingBalance: input.openingBalance,
        closingBalance: input.closingBalance, lines: input.lines,
      };
      if (hashCanonical(sourceEvidence) !== input.sourceHash) throw new ApiError(422, 'statement_source_hash_mismatch', 'Source hash does not match the canonical imported statement evidence.');
      const debit = input.lines.reduce((total, line) => total.plus(line.debit), zero());
      const credit = input.lines.reduce((total, line) => total.plus(line.credit), zero());
      const calculatedClosing = money(input.openingBalance).plus(credit).minus(debit);
      if (!calculatedClosing.equals(money(input.closingBalance))) throw new ApiError(422, 'statement_balance_mismatch', `Opening + credits - debits is ${calculatedClosing.toFixed(2)}, not the supplied closing balance.`);
      const evidence = input.lines.map((line) => ({ ...line, valueDate: line.valueDate ?? line.transactionDate, matchStatus: 'unmatched', matchedVoucherId: '', matchedVoucherLineId: '', matchEvidence: {} }));
      const requestHash = hashCanonical(input);
      const created = await db.erpBankReconciliation.create({ data: {
        organizationId: context.organizationId, legalEntityId, bankAccountId: bankAccount.id, statementReference: input.statementReference,
        statementFrom: dateOnly(input.statementFrom), statementTo: dateOnly(input.statementTo), openingBalance: input.openingBalance, closingBalance: input.closingBalance,
        lines: json(evidence), matchedTotal: 0, unmatchedTotal: debit.plus(credit), status: 'in_progress', sourceHash: input.sourceHash,
        requestHash, createdBy: context.membershipId, createIdempotencyKey: key,
      } });
      const response = this.bankDto(created);
      await audit(db, { action: 'mesaerp.bank_statement.import', entity: 'ErpBankReconciliation', entityId: created.id, after: response });
      await appendOutbox(db, context, legalEntityId, 'ErpBankReconciliation', created.id, 'mesaerp.bank_statement.imported.v1', response);
      return response;
    } });
  }

  updateBankLine(legalEntityId: string, reconciliationId: string, lineId: string, input: BankLineAction, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:bank-reconciliation:${reconciliationId}:line:${lineId}:${input.action}`, key, payload: input, execute: async (db, context) => {
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpBankReconciliation" WHERE "id" = ${reconciliationId} FOR UPDATE`);
      const reconciliation = await db.erpBankReconciliation.findFirst({ where: { id: reconciliationId, legalEntityId } });
      if (!reconciliation) throw new ApiError(404, 'bank_reconciliation_not_found', 'Bank reconciliation not found in this company.');
      if (reconciliation.status !== 'in_progress') throw new ApiError(409, 'reconciliation_immutable', 'Completed reconciliation evidence is immutable.');
      if (reconciliation.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Reconciliation changed since it was loaded.');
      const lines = rows(reconciliation.lines);
      const index = lines.findIndex((line) => line.lineId === lineId);
      if (index < 0) throw new ApiError(404, 'bank_statement_line_not_found', 'Statement line not found.');
      const current = lines[index];
      if (input.action === 'match') {
        const voucherLine = await db.erpVoucherLine.findFirst({ where: { id: input.voucherLineId, legalEntityId }, include: { voucher: true } });
        if (!voucherLine || !['posted', 'reversed'].includes(voucherLine.voucher.status)) throw new ApiError(422, 'posted_voucher_line_required', 'Match requires a posted or subsequently reversed voucher line.');
        if (voucherLine.accountId !== reconciliation.bankAccountId) throw new ApiError(422, 'bank_account_mismatch', 'Voucher line does not use this reconciliation bank account.');
        const statementDebit = money(String(current.debit ?? '0')); const statementCredit = money(String(current.credit ?? '0'));
        if (!voucherLine.baseCredit.equals(statementDebit) || !voucherLine.baseDebit.equals(statementCredit)) throw new ApiError(422, 'bank_line_amount_mismatch', 'Bank debit must equal voucher bank credit, or bank credit must equal voucher bank debit.');
        const duplicate = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT reconciliation."id" FROM "ErpBankReconciliation" reconciliation,
          jsonb_array_elements(reconciliation."lines") line
          WHERE reconciliation."legalEntityId" = ${legalEntityId} AND reconciliation."id" <> ${reconciliationId}
            AND line->>'matchedVoucherLineId' = ${input.voucherLineId} LIMIT 1
        `);
        if (duplicate.length) throw new ApiError(409, 'voucher_line_already_reconciled', 'Voucher line is already used by another reconciliation.');
        lines[index] = { ...current, matchStatus: 'matched', matchedVoucherId: voucherLine.voucherId, matchedVoucherLineId: voucherLine.id, matchEvidence: { voucherNumber: voucherLine.voucher.voucherNumber, voucherStatus: voucherLine.voucher.status, matchedBy: context.membershipId, matchedAt: new Date().toISOString() } };
      } else if (input.action === 'unmatch') {
        lines[index] = { ...current, matchStatus: 'unmatched', matchedVoucherId: '', matchedVoucherLineId: '', matchEvidence: {} };
      } else {
        lines[index] = { ...current, matchStatus: 'ignored', matchedVoucherId: '', matchedVoucherLineId: '', matchEvidence: { reason: input.reason, ignoredBy: context.membershipId, ignoredAt: new Date().toISOString() } };
      }
      const matchedTotal = lines.filter((line) => line.matchStatus === 'matched').reduce((sum, line) => sum.plus(String(line.debit ?? '0')).plus(String(line.credit ?? '0')), zero());
      const unmatchedTotal = lines.filter((line) => line.matchStatus === 'unmatched').reduce((sum, line) => sum.plus(String(line.debit ?? '0')).plus(String(line.credit ?? '0')), zero());
      const changed = await db.erpBankReconciliation.updateMany({ where: { id: reconciliationId, legalEntityId, status: 'in_progress', rowVersion: input.expectedRowVersion }, data: { lines: json(lines), matchedTotal, unmatchedTotal, rowVersion: { increment: 1 } } });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Reconciliation changed while the line action was saved.');
      const updated = await db.erpBankReconciliation.findUniqueOrThrow({ where: { id: reconciliationId } });
      const response = this.bankDto(updated);
      await audit(db, { action: `mesaerp.bank_reconciliation.line.${input.action}`, entity: 'ErpBankReconciliation', entityId: reconciliationId, before: this.bankDto(reconciliation), after: response });
      await appendOutbox(db, context, legalEntityId, 'ErpBankReconciliation', reconciliationId, `mesaerp.bank_reconciliation.line_${input.action}.v1`, { reconciliationId, lineId, rowVersion: updated.rowVersion });
      return response;
    } });
  }

  completeBankReconciliation(legalEntityId: string, reconciliationId: string, input: { expectedRowVersion: number }, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:bank-reconciliation:${reconciliationId}:complete`, key, payload: input, execute: async (db, context) => {
      const existing = await db.erpBankReconciliation.findFirst({ where: { id: reconciliationId, legalEntityId } });
      if (!existing) throw new ApiError(404, 'bank_reconciliation_not_found', 'Bank reconciliation not found in this company.');
      if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Reconciliation changed since it was loaded.');
      if (existing.status !== 'in_progress') throw new ApiError(409, 'reconciliation_not_completable', `Reconciliation is ${existing.status}.`);
      if (existing.createdBy === context.membershipId) throw new ApiError(409, 'maker_checker_required', 'Statement importer cannot complete the same reconciliation.');
      const lines = rows(existing.lines);
      const unresolved = lines.filter((line) => !['matched', 'ignored'].includes(String(line.matchStatus)));
      if (unresolved.length) throw new ApiError(409, 'reconciliation_unresolved_lines', `${unresolved.length} statement line(s) remain unmatched.`);
      const completedAt = new Date();
      const evidence = { completedAt: completedAt.toISOString(), completedBy: context.membershipId, sourceHash: existing.sourceHash, lineEvidenceHash: hashCanonical(lines) };
      const changed = await db.erpBankReconciliation.updateMany({ where: { id: reconciliationId, legalEntityId, status: 'in_progress', rowVersion: input.expectedRowVersion }, data: { status: 'completed', completedAt, completedBy: context.membershipId, completionEvidence: json(evidence), unmatchedTotal: 0, rowVersion: { increment: 1 } } });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Reconciliation changed while completion was saved.');
      const completed = await db.erpBankReconciliation.findUniqueOrThrow({ where: { id: reconciliationId } });
      const response = this.bankDto(completed);
      await audit(db, { action: 'mesaerp.bank_reconciliation.complete', entity: 'ErpBankReconciliation', entityId: reconciliationId, before: this.bankDto(existing), after: response });
      await appendOutbox(db, context, legalEntityId, 'ErpBankReconciliation', reconciliationId, 'mesaerp.bank_reconciliation.completed.v1', response);
      return response;
    } });
  }

  async listAssets(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      return (await db.erpAsset.findMany({ where: { legalEntityId }, orderBy: [{ assetCode: 'asc' }], take: 1000 })).map(assetDto);
    });
  }

  async getAsset(legalEntityId: string, assetId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const asset = await db.erpAsset.findFirst({ where: { id: assetId, legalEntityId } });
      if (!asset) throw new ApiError(404, 'asset_not_found', 'Asset not found in this company.');
      const events = await db.erpAssetEvent.findMany({ where: { assetId, legalEntityId }, orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }] });
      return { ...assetDto(asset), events: events.map((event) => this.assetEventDto(event)) };
    });
  }

  private assetEventDto(event: Awaited<ReturnType<Db['erpAssetEvent']['findFirstOrThrow']>>) {
    return {
      ...event, businessDate: day(event.businessDate), amount: event.amount.toString(), proceeds: event.proceeds.toString(),
      completedAt: event.completedAt?.toISOString() ?? null, createdAt: event.createdAt.toISOString(), updatedAt: event.updatedAt.toISOString(),
    };
  }

  createAsset(legalEntityId: string, input: AssetCreate, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:asset:create:${legalEntityId}`, key, payload: input, execute: async (db, context) => {
      const entity = await requireEntity(db, context, legalEntityId);
      const year = await db.financialYear.findFirst({ where: { id: input.financialYearId, legalEntityId } });
      if (!year) throw new ApiError(422, 'financial_year_invalid', 'Financial year does not belong to this company.');
      const accounts = await resolveAccounts(db, legalEntityId, Object.values(input.accountingProfile));
      if (accounts.size < Object.values(input.accountingProfile).length) throw new ApiError(422, 'asset_account_mapping_invalid', 'Every asset accounting role requires a company account.');
      const requestHash = hashCanonical(input);
      const sourceSnapshotHash = hashCanonical({ ...input, organizationId: context.organizationId, legalEntityId });
      const asset = await db.erpAsset.create({ data: {
        organizationId: context.organizationId, legalEntityId, financialYearId: year.id,
        assetCode: input.assetCode, name: input.name, category: input.category, acquisitionDate: dateOnly(input.acquisitionDate),
        acquisitionCost: input.acquisitionCost, residualValue: input.residualValue, depreciationMethod: input.depreciationMethod,
        usefulLifeMonths: input.usefulLifeMonths, depreciationRate: input.depreciationRate, accumulatedDepreciation: 0,
        accumulatedImpairment: 0, netBookValue: input.acquisitionCost, location: json(input.location), accountingProfile: json(input.accountingProfile),
        originMetadata: json(input.originMetadata), status: 'under_construction', createIdempotencyKey: key,
        requestHash, sourceSnapshotHash, createdBy: context.membershipId,
      } });
      const response = assetDto(asset);
      await audit(db, { action: 'mesaerp.asset.acquire', entity: 'ErpAsset', entityId: asset.id, after: response });
      await appendOutbox(db, context, legalEntityId, 'ErpAsset', asset.id, 'mesaerp.asset.acquired.v1', response);
      return response;
    } });
  }

  private async requireAssetForProposal(db: Db, legalEntityId: string, assetId: string, expectedRowVersion: number, statuses: string[]) {
    await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpAsset" WHERE "id" = ${assetId} FOR UPDATE`);
    const asset = await db.erpAsset.findFirst({ where: { id: assetId, legalEntityId } });
    if (!asset) throw new ApiError(404, 'asset_not_found', 'Asset not found in this company.');
    if (asset.rowVersion !== expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Asset changed since it was loaded.');
    if (!statuses.includes(asset.status)) throw new ApiError(409, 'asset_state_invalid', `Asset is ${asset.status}; expected ${statuses.join(' or ')}.`);
    const pending = await db.erpAssetEvent.findFirst({ where: { assetId, legalEntityId, status: 'pending_voucher' }, select: { id: true, eventType: true } });
    if (pending) throw new ApiError(409, 'asset_proposal_pending', `Asset already has a pending ${pending.eventType} voucher proposal.`);
    return asset;
  }

  private async createAssetVoucherEvent(db: Db, context: TenantCtx, asset: ErpAsset, key: string, input: {
    eventType: 'capitalization' | 'depreciation' | 'impairment' | 'disposal'; businessDate: string;
    amount: Prisma.Decimal.Value; proceeds?: Prisma.Decimal.Value; calculation: JsonRecord; lines: DraftLine[]; voucherType?: string; narration: string;
  }) {
    const { year, period } = await yearAndPeriod(db, asset.legalEntityId, dateOnly(input.businessDate));
    const evidence = { assetId: asset.id, assetCode: asset.assetCode, eventType: input.eventType, businessDate: input.businessDate, amount: money(input.amount).toFixed(2), proceeds: money(input.proceeds ?? 0).toFixed(2), calculation: input.calculation };
    const sourceSnapshotHash = hashCanonical(evidence);
    const event = await db.erpAssetEvent.create({ data: {
      organizationId: context.organizationId, legalEntityId: asset.legalEntityId, assetId: asset.id, eventType: input.eventType,
      businessDate: dateOnly(input.businessDate), financialYearId: year.id, accountingPeriodId: period.id,
      amount: input.amount, proceeds: input.proceeds ?? 0, calculationSnapshot: json(input.calculation),
      fromLocation: json(asset.location), toLocation: json(asset.location), sourceSnapshotHash, createIdempotencyKey: key,
      requestHash: hashCanonical(input), createdBy: context.membershipId,
    } });
    const voucher = await createDraftVoucher(db, context, {
      legalEntityId: asset.legalEntityId, voucherType: input.voucherType ?? 'journal', businessDate: input.businessDate,
      currency: (await db.legalEntity.findUniqueOrThrow({ where: { id: asset.legalEntityId } })).baseCurrency,
      reference: `ASSET-${asset.assetCode}-${input.eventType.toUpperCase()}`, narration: input.narration,
      originMetadata: { mesaerpFinanceControl: true, assetEventId: event.id, assetId: asset.id, eventType: input.eventType, evidenceHash: sourceSnapshotHash },
      createIdempotencyKey: `asset-event:${event.id}`, lines: input.lines,
    });
    await db.erpAssetEvent.update({ where: { id: event.id }, data: { voucherId: voucher.id, rowVersion: { increment: 1 } } });
    const completedEvent = await db.erpAssetEvent.findUniqueOrThrow({ where: { id: event.id } });
    const response = { event: this.assetEventDto(completedEvent), voucher: voucherSummary(voucher) };
    await audit(db, { action: `mesaerp.asset.${input.eventType}.propose`, entity: 'ErpAssetEvent', entityId: event.id, after: response });
    await appendOutbox(db, context, asset.legalEntityId, 'ErpAssetEvent', event.id, `mesaerp.asset.${input.eventType}_proposed.v1`, response);
    return response;
  }

  capitalizeAsset(legalEntityId: string, assetId: string, input: AssetCapitalize, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:asset:${assetId}:capitalize`, key, payload: input, execute: async (db, context) => {
      const asset = await this.requireAssetForProposal(db, legalEntityId, assetId, input.expectedRowVersion, ['under_construction']);
      if (input.businessDate !== input.capitalizationDate) throw new ApiError(422, 'capitalization_date_mismatch', 'Capitalization business date and capitalization date must match.');
      if (input.capitalizationDate < day(asset.acquisitionDate)) throw new ApiError(422, 'capitalization_before_acquisition', 'Capitalization cannot precede acquisition.');
      const profile = record(asset.accountingProfile);
      return this.createAssetVoucherEvent(db, context, asset, key, {
        eventType: 'capitalization', businessDate: input.businessDate, amount: asset.acquisitionCost,
        calculation: { capitalizationDate: input.capitalizationDate, acquisitionCost: asset.acquisitionCost.toString() }, narration: `Capitalize asset ${asset.assetCode}`,
        lines: [
          { accountId: String(profile.assetAccountId), debit: asset.acquisitionCost.toString(), credit: '0' },
          { accountId: String(profile.capitalizationClearingAccountId), debit: '0', credit: asset.acquisitionCost.toString() },
        ],
      });
    } });
  }

  transferAsset(legalEntityId: string, assetId: string, input: AssetTransfer, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:asset:${assetId}:transfer`, key, payload: input, execute: async (db, context) => {
      const asset = await this.requireAssetForProposal(db, legalEntityId, assetId, input.expectedRowVersion, ['active']);
      const evidence = { assetId, businessDate: input.businessDate, fromLocation: asset.location, toLocation: input.toLocation, reason: input.reason };
      const sourceSnapshotHash = hashCanonical(evidence);
      const event = await db.erpAssetEvent.create({ data: {
        organizationId: context.organizationId, legalEntityId, assetId, eventType: 'transfer', businessDate: dateOnly(input.businessDate),
        amount: 0, status: 'completed', fromLocation: json(asset.location), toLocation: json(input.toLocation), calculationSnapshot: json({ reason: input.reason }),
        sourceSnapshotHash, createIdempotencyKey: key, requestHash: hashCanonical(input), createdBy: context.membershipId,
        completedBy: context.membershipId, completedAt: new Date(),
      } });
      const changed = await db.erpAsset.updateMany({ where: { id: assetId, legalEntityId, status: 'active', rowVersion: input.expectedRowVersion }, data: { location: json(input.toLocation), rowVersion: { increment: 1 } } });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Asset changed while the transfer was saved.');
      const updated = await db.erpAsset.findUniqueOrThrow({ where: { id: assetId } });
      const response = { asset: assetDto(updated), event: this.assetEventDto(event) };
      await audit(db, { action: 'mesaerp.asset.transfer', entity: 'ErpAsset', entityId: assetId, before: assetDto(asset), after: response });
      await appendOutbox(db, context, legalEntityId, 'ErpAssetEvent', event.id, 'mesaerp.asset.transferred.v1', response);
      return response;
    } });
  }

  proposeDepreciation(legalEntityId: string, assetId: string, input: AssetDepreciation, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:asset:${assetId}:depreciation`, key, payload: input, execute: async (db, context) => {
      const asset = await this.requireAssetForProposal(db, legalEntityId, assetId, input.expectedRowVersion, ['active']);
      if (asset.depreciationThrough && input.throughDate <= day(asset.depreciationThrough)) throw new ApiError(409, 'depreciation_period_overlap', 'Depreciation through date must advance the last posted depreciation date.');
      const remaining = money(asset.netBookValue.minus(asset.residualValue));
      if (remaining.lte(0)) throw new ApiError(409, 'asset_fully_depreciated', 'Asset has no remaining depreciable value.');
      const proposed = asset.depreciationMethod === 'slm'
        ? asset.acquisitionCost.minus(asset.residualValue).div(asset.usefulLifeMonths).mul(input.months)
        : asset.netBookValue.mul(asset.depreciationRate).div(100).div(12).mul(input.months);
      const amount = money(Prisma.Decimal.min(remaining, proposed));
      if (amount.lte(0)) throw new ApiError(409, 'depreciation_zero', 'Calculated depreciation is zero.');
      const profile = record(asset.accountingProfile);
      return this.createAssetVoucherEvent(db, context, asset, key, {
        eventType: 'depreciation', voucherType: 'depreciation', businessDate: input.businessDate, amount,
        calculation: { method: asset.depreciationMethod, months: input.months, throughDate: input.throughDate, openingNetBookValue: asset.netBookValue.toString(), residualValue: asset.residualValue.toString(), annualRate: asset.depreciationRate.toString(), amount: amount.toFixed(2) },
        narration: `Depreciation ${asset.assetCode} through ${input.throughDate}`,
        lines: [
          { accountId: String(profile.depreciationExpenseAccountId), debit: amount.toString(), credit: '0' },
          { accountId: String(profile.accumulatedDepreciationAccountId), debit: '0', credit: amount.toString() },
        ],
      });
    } });
  }

  proposeImpairment(legalEntityId: string, assetId: string, input: AssetImpairment, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:asset:${assetId}:impairment`, key, payload: input, execute: async (db, context) => {
      const asset = await this.requireAssetForProposal(db, legalEntityId, assetId, input.expectedRowVersion, ['active']);
      const amount = money(input.amount);
      if (amount.gt(asset.netBookValue)) throw new ApiError(422, 'impairment_exceeds_nbv', 'Impairment cannot exceed current net book value.');
      const profile = record(asset.accountingProfile);
      return this.createAssetVoucherEvent(db, context, asset, key, {
        eventType: 'impairment', businessDate: input.businessDate, amount,
        calculation: { reason: input.reason, openingNetBookValue: asset.netBookValue.toString(), amount: amount.toFixed(2) },
        narration: `Impair asset ${asset.assetCode}: ${input.reason}`,
        lines: [
          { accountId: String(profile.impairmentExpenseAccountId), debit: amount.toString(), credit: '0' },
          { accountId: String(profile.accumulatedImpairmentAccountId), debit: '0', credit: amount.toString() },
        ],
      });
    } });
  }

  proposeDisposal(legalEntityId: string, assetId: string, input: AssetDisposal, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:asset:${assetId}:disposal`, key, payload: input, execute: async (db, context) => {
      const asset = await this.requireAssetForProposal(db, legalEntityId, assetId, input.expectedRowVersion, ['active']);
      const proceeds = money(input.proceeds); const nbv = money(asset.netBookValue); const delta = proceeds.minus(nbv);
      const profile = record(asset.accountingProfile);
      const lines: DraftLine[] = [
        { accountId: String(profile.assetAccountId), debit: '0', credit: asset.acquisitionCost.toString() },
        { accountId: String(profile.disposalProceedsAccountId), debit: proceeds.toString(), credit: '0' },
      ];
      if (asset.accumulatedDepreciation.gt(0)) lines.push({ accountId: String(profile.accumulatedDepreciationAccountId), debit: asset.accumulatedDepreciation.toString(), credit: '0' });
      if (asset.accumulatedImpairment.gt(0)) lines.push({ accountId: String(profile.accumulatedImpairmentAccountId), debit: asset.accumulatedImpairment.toString(), credit: '0' });
      if (delta.gt(0)) lines.push({ accountId: String(profile.disposalGainAccountId), debit: '0', credit: delta.toString() });
      if (delta.lt(0)) lines.push({ accountId: String(profile.disposalLossAccountId), debit: delta.abs().toString(), credit: '0' });
      return this.createAssetVoucherEvent(db, context, asset, key, {
        eventType: 'disposal', businessDate: input.businessDate, amount: nbv, proceeds,
        calculation: { reason: input.reason, acquisitionCost: asset.acquisitionCost.toString(), accumulatedDepreciation: asset.accumulatedDepreciation.toString(), accumulatedImpairment: asset.accumulatedImpairment.toString(), netBookValue: nbv.toFixed(2), proceeds: proceeds.toFixed(2), gainOrLoss: delta.toFixed(2) },
        narration: `Dispose asset ${asset.assetCode}: ${input.reason}`, lines,
      });
    } });
  }

  async listBudgets(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      return (await db.erpBudget.findMany({ where: { legalEntityId }, orderBy: [{ createdAt: 'desc' }], take: 500 })).map(budgetDto);
    });
  }

  async getBudget(legalEntityId: string, budgetId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const budget = await db.erpBudget.findFirst({ where: { id: budgetId, legalEntityId } });
      if (!budget) throw new ApiError(404, 'budget_not_found', 'Budget not found in this company.');
      return budgetDto(budget);
    });
  }

  createBudget(legalEntityId: string, input: BudgetCreate, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:budget:create:${legalEntityId}`, key, payload: input, execute: async (db, context) => {
      const entity = await requireEntity(db, context, legalEntityId);
      const year = await db.financialYear.findFirst({ where: { id: input.financialYearId, legalEntityId } });
      if (!year) throw new ApiError(422, 'financial_year_invalid', 'Financial year does not belong to this company.');
      if (input.currency !== entity.baseCurrency) throw new ApiError(422, 'budget_currency_unsupported', 'V1 budget control uses the company base currency.');
      const accounts = await resolveAccounts(db, legalEntityId, input.lines.map((line) => line.accountId));
      const normalizedLines = input.lines.map((line) => ({ ...line, accountId: accounts.get(line.accountId)!.id }));
      const duplicateKeys = normalizedLines.map((line) => `${line.accountId}:${line.periodNumber}:${line.costCenterId ?? ''}:${line.plantId ?? ''}`);
      if (new Set(duplicateKeys).size !== duplicateKeys.length) throw new ApiError(422, 'budget_line_duplicate', 'Budget account, period and dimension combinations must be unique.');
      const totalAmount = normalizedLines.reduce((total, line) => total.plus(line.amount), zero());
      const sourceSnapshotHash = hashCanonical({ ...input, lines: normalizedLines });
      const budget = await db.erpBudget.create({ data: {
        organizationId: context.organizationId, legalEntityId, financialYearId: year.id, budgetCode: input.budgetCode,
        name: input.name, dimensionType: input.dimensionType, currency: input.currency, lines: json(normalizedLines), status: 'draft', approvalState: 'pending',
        totalAmount, createIdempotencyKey: key, requestHash: hashCanonical(input), sourceSnapshotHash, createdBy: context.membershipId,
      } });
      const response = budgetDto(budget);
      await audit(db, { action: 'mesaerp.budget.create', entity: 'ErpBudget', entityId: budget.id, after: response });
      await appendOutbox(db, context, legalEntityId, 'ErpBudget', budget.id, 'mesaerp.budget.created.v1', response);
      return response;
    } });
  }

  transitionBudget(legalEntityId: string, budgetId: string, target: 'submitted' | 'approved', input: { expectedRowVersion: number }, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:budget:${budgetId}:${target}`, key, payload: input, execute: async (db, context) => {
      const budget = await db.erpBudget.findFirst({ where: { id: budgetId, legalEntityId } });
      if (!budget) throw new ApiError(404, 'budget_not_found', 'Budget not found in this company.');
      if (budget.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Budget changed since it was loaded.');
      const expected = target === 'submitted' ? 'draft' : 'submitted';
      if (budget.status !== expected) throw new ApiError(409, 'budget_transition_invalid', `Budget is ${budget.status}; expected ${expected}.`);
      if (target === 'approved' && budget.createdBy === context.membershipId) throw new ApiError(409, 'maker_checker_required', 'Budget maker cannot approve the same budget.');
      const now = new Date();
      const changed = await db.erpBudget.updateMany({ where: { id: budgetId, legalEntityId, status: expected, rowVersion: input.expectedRowVersion }, data: {
        status: target, approvalState: target === 'approved' ? 'approved' : 'submitted',
        ...(target === 'submitted' ? { submittedAt: now } : { approvedAt: now, approvedBy: context.membershipId }), rowVersion: { increment: 1 },
      } });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Budget changed while the transition was saved.');
      const updated = await db.erpBudget.findUniqueOrThrow({ where: { id: budgetId } });
      const response = budgetDto(updated);
      await audit(db, { action: `mesaerp.budget.${target}`, entity: 'ErpBudget', entityId: budgetId, before: budgetDto(budget), after: response });
      await appendOutbox(db, context, legalEntityId, 'ErpBudget', budgetId, `mesaerp.budget.${target}.v1`, response);
      return response;
    } });
  }

  async budgetVariance(legalEntityId: string, budgetId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const budget = await db.erpBudget.findFirst({ where: { id: budgetId, legalEntityId } });
      if (!budget) throw new ApiError(404, 'budget_not_found', 'Budget not found in this company.');
      const budgetLines = rows(budget.lines);
      const actualLines = await db.erpVoucherLine.findMany({ where: {
        legalEntityId, voucher: { financialYearId: budget.financialYearId, status: { in: ['posted', 'reversed'] } },
      }, include: { voucher: { select: { accountingPeriod: { select: { periodNumber: true } } } } } });
      const actualByKey = new Map<string, Prisma.Decimal>();
      for (const line of actualLines) {
        const dimensions = record(line.dimensions);
        const key = `${line.accountId}:${line.voucher.accountingPeriod.periodNumber}:${String(dimensions.costCenterId ?? '')}:${String(dimensions.plantId ?? '')}`;
        actualByKey.set(key, (actualByKey.get(key) ?? zero()).plus(line.baseDebit).minus(line.baseCredit));
      }
      const result = budgetLines.map((line) => {
        const key = `${line.accountId}:${line.periodNumber}:${String(line.costCenterId ?? '')}:${String(line.plantId ?? '')}`;
        const planned = money(String(line.amount ?? '0')); const actual = money(actualByKey.get(key) ?? 0);
        return { ...line, planned: planned.toFixed(2), actual: actual.toFixed(2), variance: planned.minus(actual).toFixed(2) };
      });
      return { budgetId, financialYearId: budget.financialYearId, currency: budget.currency, status: budget.status, lines: result, generatedAt: new Date().toISOString(), basis: 'posted_and_reversed_voucher_lines' };
    });
  }

  async createIntercompanyPair(sourceLegalEntityId: string, input: IntercompanyCreate, key: string) {
    const context = actor();
    if (sourceLegalEntityId === input.targetLegalEntityId) throw new ApiError(422, 'intercompany_entities_same', 'Intercompany vouchers require two different legal entities.');
    const [sourceAllowed, targetAllowed] = await Promise.all([
      hasMesaErpPermission({ organizationId: context.organizationId, membershipId: context.membershipId, legalEntityId: sourceLegalEntityId, permission: 'mesaerp.intercompany.manage' }),
      hasMesaErpPermission({ organizationId: context.organizationId, membershipId: context.membershipId, legalEntityId: input.targetLegalEntityId, permission: 'mesaerp.intercompany.manage' }),
    ]);
    if (!sourceAllowed || !targetAllowed) throw new ApiError(403, 'intercompany_dual_company_permission_required', 'Explicit mesaerp.intercompany.manage permission is required in both companies.');
    return runIdempotent({ legalEntityId: sourceLegalEntityId, scope: `finance:intercompany:create:${sourceLegalEntityId}`, key, payload: input, execute: async (db, ctx) => {
      const sourceEntity = await requireEntity(db, ctx, sourceLegalEntityId);
      const targetEntity = await requireEntity(db, ctx, input.targetLegalEntityId);
      if (input.source.currency !== sourceEntity.baseCurrency || input.target.currency !== targetEntity.baseCurrency) {
        throw new ApiError(422, 'intercompany_base_currency_required', 'Each intercompany side must use its company base currency.');
      }
      const sideAmount = (side: IntercompanyCreate['source']) => {
        const debit = side.lines.reduce((sum, line) => sum.plus(line.debit), zero());
        const credit = side.lines.reduce((sum, line) => sum.plus(line.credit), zero());
        if (debit.lte(0) || !debit.equals(credit)) throw new ApiError(422, 'intercompany_side_unbalanced', 'Each company voucher must independently balance.');
        return money(debit);
      };
      const sourceAmount = sideAmount(input.source); const targetAmount = sideAmount(input.target);
      const converted = money(sourceAmount.mul(input.exchangeRate));
      if (!converted.equals(targetAmount)) throw new ApiError(422, 'intercompany_fx_mismatch', `Source amount translated at the supplied rate is ${converted.toFixed(2)}, not ${targetAmount.toFixed(2)}.`);
      if (sourceEntity.baseCurrency === targetEntity.baseCurrency && !new Prisma.Decimal(input.exchangeRate).equals(1)) throw new ApiError(422, 'same_currency_rate_must_be_one', 'Same-currency intercompany pairs require an exchange rate of 1.');
      const pairId = randomUUID();
      const sourceVoucher = await createDraftVoucher(db, ctx, {
        legalEntityId: sourceLegalEntityId, voucherType: 'intercompany', businessDate: input.businessDate, currency: input.source.currency,
        reference: input.reference, narration: `Intercompany with ${targetEntity.code}`,
        originMetadata: { mesaerpFinanceControl: true, intercompanyPairId: pairId, counterpartyLegalEntityId: targetEntity.id, rateSourceReference: input.rateSourceReference },
        createIdempotencyKey: `intercompany:${pairId}:source`, lines: input.source.lines.map((line) => ({ accountId: line.ledgerAccountId, debit: line.debit, credit: line.credit, narration: line.narration, dimensions: line.dimensions })),
      });
      const targetVoucher = await createDraftVoucher(db, ctx, {
        legalEntityId: targetEntity.id, voucherType: 'intercompany', businessDate: input.businessDate, currency: input.target.currency,
        reference: input.reference, narration: `Intercompany with ${sourceEntity.code}`,
        originMetadata: { mesaerpFinanceControl: true, intercompanyPairId: pairId, counterpartyLegalEntityId: sourceEntity.id, rateSourceReference: input.rateSourceReference },
        createIdempotencyKey: `intercompany:${pairId}:target`, lines: input.target.lines.map((line) => ({ accountId: line.ledgerAccountId, debit: line.debit, credit: line.credit, narration: line.narration, dimensions: line.dimensions })),
      });
      const snapshot = {
        pairId, sourceLegalEntityId, targetLegalEntityId: targetEntity.id, reference: input.reference, businessDate: input.businessDate,
        sourceCurrency: input.source.currency, targetCurrency: input.target.currency, sourceAmount: sourceAmount.toFixed(2), targetAmount: targetAmount.toFixed(2),
        exchangeRate: input.exchangeRate, rateEffectiveFrom: input.rateEffectiveFrom, rateEffectiveTo: input.rateEffectiveTo ?? null,
        rateSourceReference: input.rateSourceReference, sourceVoucherId: sourceVoucher.id, targetVoucherId: targetVoucher.id,
      };
      const pair = await db.erpIntercompanyPair.create({ data: {
        id: pairId, organizationId: ctx.organizationId, sourceLegalEntityId, targetLegalEntityId: targetEntity.id,
        sourceVoucherId: sourceVoucher.id, targetVoucherId: targetVoucher.id, reference: input.reference, businessDate: dateOnly(input.businessDate),
        sourceCurrency: input.source.currency, targetCurrency: input.target.currency, sourceAmount, targetAmount, exchangeRate: input.exchangeRate,
        rateEffectiveFrom: dateOnly(input.rateEffectiveFrom), rateEffectiveTo: input.rateEffectiveTo ? dateOnly(input.rateEffectiveTo) : null,
        rateSourceReference: input.rateSourceReference, sourceSnapshot: json(snapshot), sourceSnapshotHash: hashCanonical(snapshot),
        createIdempotencyKey: key, requestHash: hashCanonical(input), createdBy: ctx.membershipId,
      } });
      const response = {
        id: pair.id, organizationId: pair.organizationId, sourceLegalEntityId, targetLegalEntityId: targetEntity.id,
        reference: pair.reference, businessDate: day(pair.businessDate), sourceAmount: pair.sourceAmount.toString(), targetAmount: pair.targetAmount.toString(),
        exchangeRate: pair.exchangeRate.toString(), rateEffectiveFrom: day(pair.rateEffectiveFrom), rateEffectiveTo: pair.rateEffectiveTo ? day(pair.rateEffectiveTo) : null,
        rateSourceReference: pair.rateSourceReference, sourceSnapshotHash: pair.sourceSnapshotHash, status: pair.status, rowVersion: pair.rowVersion,
        sourceVoucher: voucherSummary(sourceVoucher), targetVoucher: voucherSummary(targetVoucher),
      };
      await audit(db, { action: 'mesaerp.intercompany.pair.create', entity: 'ErpIntercompanyPair', entityId: pair.id, after: response });
      await appendOutbox(db, ctx, sourceLegalEntityId, 'ErpIntercompanyPair', pair.id, 'mesaerp.intercompany.pair_created.v1', response);
      await appendOutbox(db, ctx, targetEntity.id, 'ErpIntercompanyPair', pair.id, 'mesaerp.intercompany.pair_created.v1', response);
      return response;
    } });
  }

  async listIntercompanyPairs(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const pairs = await db.erpIntercompanyPair.findMany({ where: { OR: [{ sourceLegalEntityId: legalEntityId }, { targetLegalEntityId: legalEntityId }] }, orderBy: [{ businessDate: 'desc' }], take: 500 });
      return pairs.map((pair) => ({ ...pair, businessDate: day(pair.businessDate), sourceAmount: pair.sourceAmount.toString(), targetAmount: pair.targetAmount.toString(), exchangeRate: pair.exchangeRate.toString(), rateEffectiveFrom: day(pair.rateEffectiveFrom), rateEffectiveTo: pair.rateEffectiveTo ? day(pair.rateEffectiveTo) : null, createdAt: pair.createdAt.toISOString(), updatedAt: pair.updatedAt.toISOString() }));
    });
  }

  createConsolidationElimination(legalEntityId: string, input: ConsolidationEliminationCreate, key: string) {
    return runIdempotent({ legalEntityId, scope: `finance:consolidation:elimination:create:${legalEntityId}`, key, payload: input, execute: async (db, context) => {
      const voucher = await createDraftVoucher(db, context, {
        legalEntityId, voucherType: 'consolidation_elimination', businessDate: input.businessDate, currency: input.currency,
        reference: input.reference, narration: input.narration,
        originMetadata: { mesaerpFinanceControl: true, consolidationElimination: true, sourceSnapshotHash: hashCanonical(input) },
        createIdempotencyKey: `elimination:${key}`,
        lines: input.lines.map((line) => ({ accountId: line.ledgerAccountId, debit: line.debit, credit: line.credit, narration: line.narration, dimensions: line.dimensions })),
      });
      const response = voucherSummary(voucher);
      await audit(db, { action: 'mesaerp.consolidation_elimination.create', entity: 'ErpVoucher', entityId: voucher.id, after: response });
      await appendOutbox(db, context, legalEntityId, 'ErpVoucher', voucher.id, 'mesaerp.consolidation_elimination.draft_created.v1', response);
      return response;
    } });
  }

  private reportDateFilter(query: FinanceReportQuery) {
    return {
      ...(query.from || query.to ? { businessDate: { ...(query.from ? { gte: dateOnly(query.from) } : {}), ...(query.to ? { lte: dateOnly(query.to) } : {}) } } : {}),
      ...(query.asOf ? { businessDate: { lte: dateOnly(query.asOf) } } : {}),
      ...(query.financialYearId ? { financialYearId: query.financialYearId } : {}),
    };
  }

  async report(legalEntityId: string, kind: 'day-book' | 'general-ledger' | 'trial-balance' | 'profit-and-loss' | 'balance-sheet' | 'cash-bank-book' | 'cash-flow' | 'bill-ageing' | 'dimensions', query: FinanceReportQuery) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      if (kind === 'general-ledger' && !query.accountId) throw new ApiError(422, 'account_filter_required', 'General ledger requires accountId.');
      const vouchers = await db.erpVoucher.findMany({ where: {
        legalEntityId, status: { in: ['posted', 'reversed'] }, ...this.reportDateFilter(query),
      }, include: { lines: { include: { account: true }, orderBy: { lineNumber: 'asc' } } }, orderBy: [{ businessDate: 'asc' }, { voucherNumber: 'asc' }], take: 20001 });
      if (vouchers.length > 20000) throw new ApiError(413, 'report_scope_too_large', 'Report scope exceeds 20,000 vouchers; narrow the date, year or dimension filters.');
      const allLines = vouchers.flatMap((voucher) => voucher.lines.map((line) => ({ voucher, line, account: line.account, dimensions: record(line.dimensions), net: line.baseDebit.minus(line.baseCredit) })))
        .filter(({ dimensions }) => (!query.costCenterId || dimensions.costCenterId === query.costCenterId) && (!query.plantId || dimensions.plantId === query.plantId));
      const generatedAt = new Date().toISOString(); const basis = 'posted_and_reversed_vouchers_in_company_base_currency';
      if (kind === 'day-book') return { kind, generatedAt, basis, vouchers: vouchers.map((voucher) => voucherSummary(voucher)) };
      if (kind === 'general-ledger') {
        const selected = allLines.filter(({ line }) => line.accountId === query.accountId);
        let opening = zero();
        if (query.from) {
          const openingLines = await db.erpVoucherLine.findMany({ where: {
            legalEntityId, accountId: query.accountId,
            voucher: { status: { in: ['posted', 'reversed'] }, businessDate: { lt: dateOnly(query.from) }, ...(query.financialYearId ? { financialYearId: query.financialYearId } : {}) },
          }, select: { baseDebit: true, baseCredit: true, dimensions: true } });
          opening = openingLines.filter((line) => {
            const dimensions = record(line.dimensions);
            return (!query.costCenterId || dimensions.costCenterId === query.costCenterId) && (!query.plantId || dimensions.plantId === query.plantId);
          }).reduce((total, line) => total.plus(line.baseDebit).minus(line.baseCredit), zero());
        }
        let running = opening;
        const movements = selected.map(({ voucher, line }) => {
          running = running.plus(line.baseDebit).minus(line.baseCredit);
          return { voucherId: voucher.id, voucherNumber: voucher.voucherNumber, businessDate: day(voucher.businessDate), status: voucher.status, reference: voucher.reference, debit: line.baseDebit.toString(), credit: line.baseCredit.toString(), runningBalance: running.toFixed(2), billReference: line.billReference, dueDate: line.dueDate ? day(line.dueDate) : null, dimensions: line.dimensions };
        });
        return { kind, generatedAt, basis, accountId: query.accountId, openingBalance: opening.toFixed(2), closingBalance: running.toFixed(2), movements };
      }
      const grouped = new Map<string, { account: ErpAccount; debit: Prisma.Decimal; credit: Prisma.Decimal }>();
      for (const { line, account } of allLines) {
        const entry = grouped.get(account.id) ?? { account, debit: zero(), credit: zero() };
        entry.debit = entry.debit.plus(line.baseDebit); entry.credit = entry.credit.plus(line.baseCredit); grouped.set(account.id, entry);
      }
      const accountRows = [...grouped.values()].map(({ account, debit, credit }) => ({ ...accountDto(account), debit: debit.toFixed(2), credit: credit.toFixed(2), balance: debit.minus(credit).toFixed(2) }));
      if (kind === 'trial-balance') {
        const totalDebit = accountRows.reduce((sum, row) => sum.plus(row.debit), zero()); const totalCredit = accountRows.reduce((sum, row) => sum.plus(row.credit), zero());
        return { kind, generatedAt, basis, totalDebit: totalDebit.toFixed(2), totalCredit: totalCredit.toFixed(2), balanced: totalDebit.equals(totalCredit), accounts: accountRows };
      }
      if (kind === 'profit-and-loss') {
        const income = accountRows.filter((row) => row.accountType === 'income').reduce((sum, row) => sum.plus(row.credit).minus(row.debit), zero());
        const expense = accountRows.filter((row) => row.accountType === 'expense').reduce((sum, row) => sum.plus(row.debit).minus(row.credit), zero());
        return { kind, generatedAt, basis, income: income.toFixed(2), expense: expense.toFixed(2), netProfit: income.minus(expense).toFixed(2), accounts: accountRows.filter((row) => ['income', 'expense'].includes(row.accountType)) };
      }
      if (kind === 'balance-sheet') {
        const assets = accountRows.filter((row) => row.accountType === 'asset').reduce((sum, row) => sum.plus(row.debit).minus(row.credit), zero());
        const liabilities = accountRows.filter((row) => row.accountType === 'liability').reduce((sum, row) => sum.plus(row.credit).minus(row.debit), zero());
        const equity = accountRows.filter((row) => row.accountType === 'equity').reduce((sum, row) => sum.plus(row.credit).minus(row.debit), zero());
        const income = accountRows.filter((row) => row.accountType === 'income').reduce((sum, row) => sum.plus(row.credit).minus(row.debit), zero());
        const expense = accountRows.filter((row) => row.accountType === 'expense').reduce((sum, row) => sum.plus(row.debit).minus(row.credit), zero());
        return { kind, generatedAt, basis, assets: assets.toFixed(2), liabilities: liabilities.toFixed(2), equity: equity.toFixed(2), unclosedCurrentProfit: income.minus(expense).toFixed(2), equationDifference: assets.minus(liabilities).minus(equity).minus(income.minus(expense)).toFixed(2), accounts: accountRows.filter((row) => ['asset', 'liability', 'equity'].includes(row.accountType)) };
      }
      if (kind === 'cash-bank-book') {
        const cashLines = allLines.filter(({ account }) => ['cash', 'bank'].includes(account.classification));
        return { kind, generatedAt, basis, movements: cashLines.map(({ voucher, line, account }) => ({ voucherId: voucher.id, voucherNumber: voucher.voucherNumber, businessDate: day(voucher.businessDate), accountId: account.id, accountCode: account.code, classification: account.classification, debit: line.baseDebit.toString(), credit: line.baseCredit.toString(), reference: voucher.reference })) };
      }
      if (kind === 'cash-flow') {
        const flows = vouchers.flatMap((voucher) => {
          const cash = voucher.lines.filter((line) => ['cash', 'bank'].includes(line.account.classification));
          if (!cash.length) return [];
          const amount = cash.reduce((sum, line) => sum.plus(line.baseDebit).minus(line.baseCredit), zero());
          const classifications = [...new Set(voucher.lines.filter((line) => !['cash', 'bank'].includes(line.account.classification)).map((line) => line.account.cashFlowClass))];
          return [{ voucherId: voucher.id, voucherNumber: voucher.voucherNumber, businessDate: day(voucher.businessDate), amount: amount.toFixed(2), classifications, allocation: classifications.length === 1 ? 'direct' : 'mixed_voucher_unallocated' }];
        });
        const totals = flows.reduce<Record<string, Prisma.Decimal>>((acc, flow) => { const key = flow.classifications.length === 1 ? flow.classifications[0] : 'mixed'; acc[key] = (acc[key] ?? zero()).plus(flow.amount); return acc; }, {});
        return { kind, generatedAt, basis, totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value.toFixed(2)])), flows };
      }
      if (kind === 'bill-ageing') {
        const asOf = query.asOf ? dateOnly(query.asOf) : new Date();
        const groups = new Map<string, { partyType: string; accountId: string; billReference: string; dueDate: Date | null; amount: Prisma.Decimal }>();
        for (const { line, account } of allLines.filter(({ line, account }) => line.billReference && ['receivable', 'payable'].includes(account.classification))) {
          const key = `${account.id}:${line.billReference}`; const existing = groups.get(key) ?? { partyType: account.classification, accountId: account.id, billReference: line.billReference, dueDate: line.dueDate, amount: zero() };
          existing.amount = existing.amount.plus(account.classification === 'receivable' ? line.baseDebit.minus(line.baseCredit) : line.baseCredit.minus(line.baseDebit)); groups.set(key, existing);
        }
        return { kind, generatedAt, basis, limitation: 'Outstanding is netted by account and billReference; dedicated allocation records are not yet available.', bills: [...groups.values()].filter((bill) => !bill.amount.isZero()).map((bill) => ({ ...bill, dueDate: bill.dueDate ? day(bill.dueDate) : null, daysPastDue: bill.dueDate ? Math.max(0, Math.floor((asOf.getTime() - bill.dueDate.getTime()) / 86400000)) : null, outstanding: bill.amount.toFixed(2) })) };
      }
      const dimensionGroups = new Map<string, Prisma.Decimal>();
      for (const { dimensions, net } of allLines) {
        const key = `${String(dimensions.costCenterId ?? 'unassigned')}|${String(dimensions.plantId ?? 'unassigned')}`;
        dimensionGroups.set(key, (dimensionGroups.get(key) ?? zero()).plus(net));
      }
      return { kind, generatedAt, basis, dimensions: [...dimensionGroups.entries()].map(([key, value]) => { const [costCenterId, plantId] = key.split('|'); return { costCenterId, plantId, netDebitBalance: value.toFixed(2) }; }) };
    });
  }

  async consolidationReport(input: ConsolidationReport) {
    const context = actor();
    const entityIds = [...new Set(input.legalEntityIds)];
    if (entityIds.length !== input.legalEntityIds.length) throw new ApiError(422, 'consolidation_entity_duplicate', 'Legal entity IDs must be unique.');
    const grants = await Promise.all(entityIds.map((legalEntityId) => hasMesaErpPermission({ organizationId: context.organizationId, membershipId: context.membershipId, legalEntityId, permission: 'mesaerp.consolidation.manage' })));
    if (grants.some((allowed) => !allowed)) throw new ApiError(403, 'consolidation_company_permission_required', 'Explicit mesaerp.consolidation.manage permission is required in every selected company.');
    return tenantTx(async (db) => {
      const entities = await db.legalEntity.findMany({ where: { id: { in: entityIds }, status: 'active' } });
      if (entities.length !== entityIds.length) throw new ApiError(404, 'consolidation_entity_missing', 'One or more selected legal entities are unavailable.');
      const rateByEntity = new Map(input.rates.map((rate) => [rate.legalEntityId, rate]));
      for (const entity of entities) {
        const rate = rateByEntity.get(entity.id);
        if (!rate || rate.currency !== entity.baseCurrency || input.reportDate < rate.effectiveFrom || (rate.effectiveTo && input.reportDate > rate.effectiveTo)) {
          throw new ApiError(422, 'consolidation_fx_rate_invalid', `A source-backed effective FX rate is required for ${entity.code}.`);
        }
        if (entity.baseCurrency === input.groupCurrency && !new Prisma.Decimal(rate.rate).equals(1)) throw new ApiError(422, 'consolidation_same_currency_rate', `${entity.code} must use rate 1 for the group currency.`);
      }
      const vouchers = await db.erpVoucher.findMany({ where: { legalEntityId: { in: entityIds }, status: { in: ['posted', 'reversed'] }, businessDate: { lte: dateOnly(input.reportDate) }, voucherType: { not: 'consolidation_elimination' } }, include: { lines: { include: { account: true } } } });
      const entityBalances = entities.map((entity) => {
        const rate = rateByEntity.get(entity.id)!; const fx = new Prisma.Decimal(rate.rate);
        const byType = new Map<string, Prisma.Decimal>();
        for (const line of vouchers.filter((voucher) => voucher.legalEntityId === entity.id).flatMap((voucher) => voucher.lines)) {
          byType.set(line.account.accountType, (byType.get(line.account.accountType) ?? zero()).plus(line.baseDebit).minus(line.baseCredit));
        }
        return { legalEntityId: entity.id, code: entity.code, baseCurrency: entity.baseCurrency, rate: rate.rate, rateSourceReference: rate.sourceReference, translated: Object.fromEntries([...byType.entries()].map(([type, balance]) => [type, money(balance.mul(fx)).toFixed(2)])) };
      });
      const eliminations = await db.erpVoucher.findMany({ where: { id: { in: input.eliminationVoucherIds }, legalEntityId: { in: entityIds }, voucherType: 'consolidation_elimination', status: { in: ['posted', 'reversed'] }, businessDate: { lte: dateOnly(input.reportDate) } }, include: { lines: { include: { account: true } } } });
      if (eliminations.length !== input.eliminationVoucherIds.length) throw new ApiError(422, 'elimination_voucher_invalid', 'Every supplied elimination must be a posted/reversed consolidation-elimination voucher in the selected companies.');
      const pre = new Map<string, Prisma.Decimal>();
      for (const entity of entityBalances) for (const [type, amount] of Object.entries(entity.translated)) pre.set(type, (pre.get(type) ?? zero()).plus(amount));
      const eliminationByType = new Map<string, Prisma.Decimal>();
      for (const voucher of eliminations) for (const line of voucher.lines) eliminationByType.set(line.account.accountType, (eliminationByType.get(line.account.accountType) ?? zero()).plus(line.baseDebit).minus(line.baseCredit));
      const types = new Set([...pre.keys(), ...eliminationByType.keys()]);
      return {
        reportDate: input.reportDate, groupCurrency: input.groupCurrency, generatedAt: new Date().toISOString(),
        translationPolicy: 'One caller-supplied effective rate per entity; no historical or average-rate inference.', entityBalances,
        explicitEliminations: eliminations.map((voucher) => voucherSummary(voucher)),
        consolidated: Object.fromEntries([...types].map((type) => [type, money((pre.get(type) ?? zero()).plus(eliminationByType.get(type) ?? zero())).toFixed(2)])),
        silentNettingApplied: false,
      };
    });
  }
}
