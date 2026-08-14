import { randomUUID } from 'node:crypto';
import { Prisma, type LegalEntity, type ErpVoucher, type ErpVoucherLine } from '@prisma/client';
import { basePrisma, withTenant } from '../db';
import { audit } from '../lib/audit';
import { ApiError } from '../middleware/error';
import { decimalSum, scaledToDecimal } from './decimal';
import {
  hashCanonical,
  type CreateLegalEntityCommand,
  type CreateVoucherReversalCommand,
  type CreateVoucherCommand,
  type ApproveVoucherCommand,
  type AccountRecord,
  type JournalEntryRecord,
  type LegalEntityRecord,
  type MesaErpRepository,
  type PostVoucherCommand,
  type PostedVoucherResult,
  type SubmitVoucherCommand,
  type UpdateVoucherCommand,
  type VoucherRecord,
} from './repository';
import { assertBalancedVoucherLines, type VoucherLineInput, type VoucherType } from './schemas';
import { applyInventoryPostingPlan, assertManufacturingSourceReadyForPosting } from './inventoryPosting';
import { applyFinanceControlPosting } from './financeControlPosting';

type Db = typeof basePrisma;
type VoucherWithLines = ErpVoucher & { lines: ErpVoucherLine[] };

const VOUCHER_CODE: Record<VoucherType, string> = {
  contra: 'CON', payment: 'PAY', receipt: 'REC', journal: 'JRN', sales: 'SAL', purchase: 'PUR',
  credit_note: 'CRN', debit_note: 'DBN', stock_journal: 'STJ', manufacturing_journal: 'MFG', opening: 'OPN',
  depreciation: 'DEP', fx_adjustment: 'FXA', intercompany: 'ICO', consolidation_elimination: 'ELM',
};

const STANDARD_ACCOUNTS = [
  ['1000', 'Cash', 'asset', 'cash', 'cash', false], ['1010', 'Bank', 'asset', 'bank', 'cash', true], ['1100', 'Trade receivables', 'asset', 'receivable', 'operating', true],
  ['1200', 'Raw material inventory', 'asset', 'inventory', 'operating', false], ['1210', 'Work in progress', 'asset', 'inventory', 'operating', false],
  ['1220', 'Finished goods inventory', 'asset', 'inventory', 'operating', false], ['1300', 'GST input credit', 'asset', 'tax', 'operating', false],
  ['2000', 'Trade payables', 'liability', 'payable', 'operating', true], ['2010', 'Goods received not invoiced', 'liability', 'payable', 'operating', false], ['2100', 'GST output payable', 'liability', 'tax', 'operating', false],
  ['3000', 'Retained earnings', 'equity', 'equity', 'financing', false], ['4000', 'Sales', 'income', 'revenue', 'operating', false],
  ['5000', 'Purchases and material consumption', 'expense', 'operating_expense', 'operating', false], ['5100', 'Cost of goods sold', 'expense', 'cogs', 'operating', false],
  ['5200', 'Direct labour', 'expense', 'operating_expense', 'operating', false], ['5300', 'Machine and factory overhead', 'expense', 'operating_expense', 'operating', false],
] as const;

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function financialYearFor(date: Date, startMonth: number) {
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  const startYear = month >= startMonth ? year : year - 1;
  const startsOn = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const endsOn = new Date(Date.UTC(startYear + 1, startMonth - 1, 0));
  return { code: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`, startsOn, endsOn };
}

function monthPeriods(startsOn: Date) {
  return Array.from({ length: 12 }, (_, index) => {
    const starts = new Date(Date.UTC(startsOn.getUTCFullYear(), startsOn.getUTCMonth() + index, 1));
    const ends = new Date(Date.UTC(startsOn.getUTCFullYear(), startsOn.getUTCMonth() + index + 1, 0));
    return {
      periodNumber: index + 1,
      name: starts.toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      startsOn: starts,
      endsOn: ends,
    };
  });
}

function entityDto(entity: LegalEntity): LegalEntityRecord {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    code: entity.code,
    name: entity.legalName,
    countryCode: entity.countryCode,
    baseCurrency: entity.baseCurrency,
    fiscalYearStartMonth: entity.fiscalYearStartMonth,
    version: entity.rowVersion,
    createdAt: entity.createdAt.toISOString(),
  };
}

function jsonObject(value: Prisma.JsonValue): Record<string, string> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function voucherDto(voucher: VoucherWithLines): VoucherRecord {
  return {
    id: voucher.id,
    organizationId: voucher.organizationId,
    legalEntityId: voucher.legalEntityId,
    voucherType: voucher.voucherType as VoucherType,
    voucherDate: isoDay(voucher.businessDate),
    currencyCode: voucher.currency,
    reference: voucher.reference,
    narration: voucher.narration,
    lines: voucher.lines
      .sort((left, right) => left.lineNumber - right.lineNumber)
      .map((line) => ({
        ledgerAccountId: line.accountId,
        debit: line.transactionDebit.toString(),
        credit: line.transactionCredit.toString(),
        narration: line.narration,
        dimensions: jsonObject(line.dimensions),
      })),
    status: voucher.status as VoucherRecord['status'],
    version: voucher.rowVersion,
    ...(voucher.voucherNumber.startsWith('DRAFT-') ? {} : { voucherNumber: voucher.voucherNumber }),
    ...(voucher.sourceSnapshotHash ? { snapshotHash: voucher.sourceSnapshotHash } : {}),
    ...(['posted', 'reversed'].includes(voucher.status) ? { journalEntryId: voucher.id } : {}),
    ...(voucher.reversalOfId ? { reversalOfId: voucher.reversalOfId } : {}),
    createdAt: voucher.createdAt.toISOString(),
    createdBy: voucher.createdBy,
    ...(voucher.submittedAt ? { submittedAt: voucher.submittedAt.toISOString() } : {}),
    ...(voucher.approvedAt ? { approvedAt: voucher.approvedAt.toISOString() } : {}),
    ...(voucher.approvedBy ? { approvedBy: voucher.approvedBy } : {}),
    ...(voucher.postedAt ? { postedAt: voucher.postedAt.toISOString() } : {}),
    ...(voucher.postedBy ? { postedBy: voucher.postedBy } : {}),
    ...(voucher.reversedAt ? { reversedAt: voucher.reversedAt.toISOString() } : {}),
  };
}

function journalDto(voucher: VoucherWithLines): JournalEntryRecord {
  const dto = voucherDto(voucher);
  if (!dto.voucherNumber || !dto.snapshotHash || !dto.postedAt || !dto.postedBy) {
    throw new ApiError(409, 'voucher_not_posted', 'This voucher has not been posted.');
  }
  return {
    id: voucher.id,
    organizationId: voucher.organizationId,
    legalEntityId: voucher.legalEntityId,
    voucherId: voucher.id,
    voucherNumber: dto.voucherNumber,
    voucherType: dto.voucherType,
    postingDate: dto.voucherDate,
    currencyCode: dto.currencyCode,
    lines: dto.lines,
    status: 'posted',
    snapshotHash: dto.snapshotHash,
    postedAt: dto.postedAt,
    postedBy: dto.postedBy,
  };
}

async function findYearAndPeriod(db: Db, legalEntityId: string, businessDate: Date) {
  const year = await db.financialYear.findFirst({
    where: { legalEntityId, startsOn: { lte: businessDate }, endsOn: { gte: businessDate } },
  });
  if (!year) throw new ApiError(409, 'financial_year_missing', 'No financial year covers this voucher date.');
  const period = await db.accountingPeriod.findFirst({
    where: { financialYearId: year.id, startsOn: { lte: businessDate }, endsOn: { gte: businessDate } },
  });
  if (!period) throw new ApiError(409, 'accounting_period_missing', 'No accounting period covers this voucher date.');
  if (period.status !== 'open') throw new ApiError(409, 'period_closed', `The ${period.name} accounting period is ${period.status}.`);
  return { year, period };
}

async function resolveAccounts(db: Db, legalEntityId: string, lines: VoucherLineInput[]) {
  const references = [...new Set(lines.map((line) => line.ledgerAccountId))];
  const accounts = await db.erpAccount.findMany({
    where: {
      legalEntityId,
      active: true,
      allowPosting: true,
      OR: [{ id: { in: references } }, { code: { in: references } }],
    },
  });
  const byReference = new Map(accounts.flatMap((account) => [[account.id, account], [account.code, account]] as const));
  const missing = references.filter((reference) => !byReference.has(reference));
  if (missing.length) throw new ApiError(422, 'ledger_account_missing', `Unknown posting account: ${missing.join(', ')}.`);
  return lines.map((line) => ({ line, account: byReference.get(line.ledgerAccountId)! }));
}

function totals(lines: VoucherLineInput[]) {
  assertBalancedVoucherLines(lines);
  const debit = scaledToDecimal(decimalSum(lines.map((line) => line.debit)));
  const credit = scaledToDecimal(decimalSum(lines.map((line) => line.credit)));
  return { debit, credit };
}

async function replay<T>(db: Db, organizationId: string, scope: string, key: string, requestHash: string): Promise<T | null> {
  const record = await db.erpIdempotencyRecord.findUnique({
    where: { organizationId_scope_key: { organizationId, scope, key } },
  });
  if (!record) return null;
  if (record.requestHash !== requestHash) {
    throw new ApiError(409, 'idempotency_conflict', 'This idempotency key was already used with a different request.');
  }
  return structuredClone(record.response) as T;
}

async function remember(db: Db, organizationId: string, legalEntityId: string | null, scope: string, key: string, requestHash: string, response: unknown) {
  await db.erpIdempotencyRecord.create({
    data: {
      organizationId, legalEntityId, scope, key, requestHash,
      response: response as Prisma.InputJsonValue,
    },
  });
}

export class PrismaMesaErpRepository implements MesaErpRepository {
  async listLegalEntities(organizationId: string): Promise<LegalEntityRecord[]> {
    return withTenant(organizationId, async (db) => (
      (await db.legalEntity.findMany({ where: { status: 'active' }, orderBy: { code: 'asc' } })).map(entityDto)
    ));
  }

  async getLegalEntity(organizationId: string, legalEntityId: string): Promise<LegalEntityRecord | null> {
    return withTenant(organizationId, async (db) => {
      const entity = await db.legalEntity.findFirst({ where: { id: legalEntityId, organizationId } });
      return entity ? entityDto(entity) : null;
    });
  }

  async listAccounts(organizationId: string, legalEntityId: string): Promise<AccountRecord[]> {
    return withTenant(organizationId, async (db) => {
      const entity = await db.legalEntity.findFirst({ where: { id: legalEntityId, organizationId }, select: { id: true } });
      if (!entity) throw new ApiError(404, 'legal_entity_not_found', 'Legal entity not found.');
      return db.erpAccount.findMany({
        where: { legalEntityId, active: true },
        orderBy: [{ code: 'asc' }, { name: 'asc' }],
        select: { id: true, legalEntityId: true, code: true, name: true, accountType: true, currency: true, allowPosting: true },
      });
    });
  }

  async listVouchers(organizationId: string, legalEntityId: string): Promise<VoucherRecord[]> {
    return withTenant(organizationId, async (db) => {
      const entity = await db.legalEntity.findFirst({ where: { id: legalEntityId, organizationId }, select: { id: true } });
      if (!entity) throw new ApiError(404, 'legal_entity_not_found', 'Legal entity not found.');
      const vouchers = await db.erpVoucher.findMany({
        where: { legalEntityId },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        take: 250,
      });
      return vouchers.map(voucherDto);
    });
  }

  async createLegalEntity(command: CreateLegalEntityCommand): Promise<LegalEntityRecord> {
    return withTenant(command.organizationId, async (db) => {
      const replayed = await db.legalEntity.findFirst({
        where: { organizationId: command.organizationId, createIdempotencyKey: command.idempotencyKey },
      });
      if (replayed) {
        if (replayed.requestHash !== command.requestHash) throw new ApiError(409, 'idempotency_conflict', 'This idempotency key was already used with a different request.');
        return entityDto(replayed);
      }
      const duplicate = await db.legalEntity.findFirst({ where: { code: command.input.code } });
      if (duplicate) throw new ApiError(409, 'legal_entity_code_exists', 'A legal entity with this code already exists.');
      const entity = await db.legalEntity.create({
        data: {
          organizationId: command.organizationId,
          code: command.input.code,
          legalName: command.input.name,
          countryCode: command.input.countryCode,
          baseCurrency: command.input.baseCurrency,
          fiscalYearStartMonth: command.input.fiscalYearStartMonth,
          createIdempotencyKey: command.idempotencyKey,
          requestHash: command.requestHash,
        },
      });
      const financialYear = financialYearFor(new Date(), entity.fiscalYearStartMonth);
      const year = await db.financialYear.create({
        data: { organizationId: command.organizationId, legalEntityId: entity.id, ...financialYear },
      });
      await db.accountingPeriod.createMany({
        data: monthPeriods(financialYear.startsOn).map((period) => ({
          organizationId: command.organizationId, legalEntityId: entity.id, financialYearId: year.id, ...period,
        })),
      });
      await db.erpAccount.createMany({
        data: STANDARD_ACCOUNTS.map(([code, name, accountType, classification, cashFlowClass, reconciliationRequired]) => ({
          organizationId: command.organizationId, legalEntityId: entity.id, code, name, accountType,
          classification, cashFlowClass, reconciliationRequired, currency: entity.baseCurrency,
        })),
      });
      const companyAdminRole = await db.role.create({
        data: {
          organizationId: command.organizationId,
          erpLegalEntityId: entity.id,
          name: `${entity.code} MesaERP Administrator`,
          screens: [],
          isAdmin: false,
          isSystem: false,
        },
      });
      const erpPermissions = await db.permission.findMany({ where: { serviceId: 'mesaerp' }, select: { id: true } });
      if (erpPermissions.length) {
        await db.rolePermission.createMany({
          data: erpPermissions.map((permission) => ({
            organizationId: command.organizationId,
            roleId: companyAdminRole.id,
            permissionId: permission.id,
            effect: 'allow',
          })),
        });
      }
      await db.roleAssignment.create({
        data: {
          organizationId: command.organizationId,
          membershipId: command.actorMembershipId,
          roleId: companyAdminRole.id,
          serviceId: 'mesaerp',
          legalEntityId: entity.id,
        },
      });
      await audit(db, {
        action: 'mesaerp.legal_entity.create',
        entity: 'LegalEntity',
        entityId: entity.id,
        after: {
          code: entity.code,
          legalName: entity.legalName,
          countryCode: entity.countryCode,
          baseCurrency: entity.baseCurrency,
          fiscalYearId: year.id,
          companyAdministratorRoleId: companyAdminRole.id,
          initialAdministratorMembershipId: command.actorMembershipId,
        },
      });
      return entityDto(entity);
    });
  }

  async getVoucher(organizationId: string, legalEntityId: string, voucherId: string): Promise<VoucherRecord | null> {
    return withTenant(organizationId, async (db) => {
      const voucher = await db.erpVoucher.findFirst({
        where: { id: voucherId, legalEntityId }, include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      return voucher ? voucherDto(voucher) : null;
    });
  }

  async createVoucher(command: CreateVoucherCommand): Promise<VoucherRecord> {
    return withTenant(command.organizationId, async (db) => {
      const replayed = await db.erpVoucher.findFirst({
        where: { legalEntityId: command.legalEntityId, createIdempotencyKey: command.idempotencyKey },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (replayed) {
        if (replayed.requestHash !== command.requestHash) throw new ApiError(409, 'idempotency_conflict', 'This idempotency key was already used with a different request.');
        return voucherDto(replayed);
      }
      const entity = await db.legalEntity.findFirst({ where: { id: command.legalEntityId } });
      if (!entity) throw new ApiError(404, 'legal_entity_not_found', 'Legal entity not found.');
      if (command.input.currencyCode !== entity.baseCurrency) {
        throw new ApiError(422, 'foreign_currency_not_supported', 'Foreign-currency posting is disabled until an approved exchange rate and base-currency amounts are supplied.');
      }
      const businessDate = dateOnly(command.input.voucherDate);
      const { year, period } = await findYearAndPeriod(db, entity.id, businessDate);
      const resolved = await resolveAccounts(db, entity.id, command.input.lines);
      const amount = totals(command.input.lines);
      const voucher = await db.erpVoucher.create({
        data: {
          organizationId: command.organizationId,
          legalEntityId: entity.id,
          financialYearId: year.id,
          accountingPeriodId: period.id,
          voucherType: command.input.voucherType,
          voucherNumber: `DRAFT-${randomUUID()}`,
          businessDate,
          currency: command.input.currencyCode,
          transactionDebit: amount.debit,
          transactionCredit: amount.credit,
          baseDebit: amount.debit,
          baseCredit: amount.credit,
          reference: command.input.reference,
          narration: command.input.narration,
          createIdempotencyKey: command.idempotencyKey,
          requestHash: command.requestHash,
          createdBy: command.actorMembershipId,
          lines: {
            create: resolved.map(({ line, account }, index) => ({
              organizationId: command.organizationId,
              legalEntityId: entity.id,
              lineNumber: index + 1,
              accountId: account.id,
              accountSnapshot: { code: account.code, name: account.name },
              transactionDebit: line.debit,
              transactionCredit: line.credit,
              baseDebit: line.debit,
              baseCredit: line.credit,
              narration: line.narration,
              dimensions: line.dimensions,
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      const response = voucherDto(voucher);
      await audit(db, {
        action: 'mesaerp.voucher.create',
        entity: 'ErpVoucher',
        entityId: voucher.id,
        after: response,
      });
      return response;
    });
  }

  async updateVoucher(command: UpdateVoucherCommand): Promise<VoucherRecord> {
    return withTenant(command.organizationId, async (db) => {
      const scope = `voucher:${command.voucherId}:update`;
      const replayed = await replay<VoucherRecord>(db, command.organizationId, scope, command.idempotencyKey, command.requestHash);
      if (replayed) return replayed;
      const existing = await db.erpVoucher.findFirst({
        where: { id: command.voucherId, legalEntityId: command.legalEntityId },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (!existing) throw new ApiError(404, 'voucher_not_found', 'Voucher not found.');
      if (existing.status !== 'draft') throw new ApiError(409, 'posted_immutable', 'Posted vouchers are immutable; create a reversal or adjustment.');
      if ((existing.originMetadata as Record<string, unknown> | null)?.mesaerpPostingSource) {
        throw new ApiError(409, 'source_posting_immutable', 'Source-generated voucher mappings are immutable; correct the source document or create a controlled adjustment.');
      }
      if ((existing.originMetadata as Record<string, unknown> | null)?.mesaerpFinanceControl) {
        throw new ApiError(409, 'finance_control_voucher_immutable', 'Finance-control voucher mappings are immutable; correct through the dedicated workflow or a controlled adjustment.');
      }
      if (existing.rowVersion !== command.input.expectedVersion) throw new ApiError(409, 'version_conflict', 'Voucher changed since it was loaded.');

      const lines = command.input.lines ?? voucherDto(existing).lines;
      const amount = totals(lines);
      const resolved = command.input.lines ? await resolveAccounts(db, command.legalEntityId, command.input.lines) : null;
      if (command.input.lines && resolved) {
        await db.erpVoucherLine.deleteMany({ where: { voucherId: existing.id } });
        await db.erpVoucherLine.createMany({
          data: resolved.map(({ line, account }, index) => ({
            organizationId: command.organizationId, legalEntityId: command.legalEntityId, voucherId: existing.id,
            lineNumber: index + 1, accountId: account.id, accountSnapshot: { code: account.code, name: account.name },
            transactionDebit: line.debit, transactionCredit: line.credit, baseDebit: line.debit, baseCredit: line.credit,
            narration: line.narration, dimensions: line.dimensions,
          })),
        });
      }
      const nextDate = command.input.voucherDate ? dateOnly(command.input.voucherDate) : existing.businessDate;
      const { year, period } = await findYearAndPeriod(db, command.legalEntityId, nextDate);
      const updatedCount = await db.erpVoucher.updateMany({
        where: { id: existing.id, rowVersion: command.input.expectedVersion, status: 'draft' },
        data: {
          businessDate: nextDate, financialYearId: year.id, accountingPeriodId: period.id,
          ...(command.input.reference !== undefined ? { reference: command.input.reference } : {}),
          ...(command.input.narration !== undefined ? { narration: command.input.narration } : {}),
          transactionDebit: amount.debit, transactionCredit: amount.credit, baseDebit: amount.debit, baseCredit: amount.credit,
          rowVersion: { increment: 1 },
        },
      });
      if (updatedCount.count !== 1) throw new ApiError(409, 'version_conflict', 'Voucher changed since it was loaded.');
      const updated = await db.erpVoucher.findUniqueOrThrow({ where: { id: existing.id }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
      const response = voucherDto(updated);
      await audit(db, {
        action: 'mesaerp.voucher.update',
        entity: 'ErpVoucher',
        entityId: existing.id,
        before: voucherDto(existing),
        after: response,
      });
      await remember(db, command.organizationId, command.legalEntityId, scope, command.idempotencyKey, command.requestHash, response);
      return response;
    });
  }

  async submitVoucher(command: SubmitVoucherCommand): Promise<VoucherRecord> {
    return withTenant(command.organizationId, async (db) => {
      const scope = `voucher:${command.voucherId}:submit`;
      const replayed = await replay<VoucherRecord>(db, command.organizationId, scope, command.idempotencyKey, command.requestHash);
      if (replayed) return replayed;
      const existing = await db.erpVoucher.findFirst({
        where: { id: command.voucherId, legalEntityId: command.legalEntityId },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (!existing) throw new ApiError(404, 'voucher_not_found', 'Voucher not found.');
      if (existing.status !== 'draft') throw new ApiError(409, 'voucher_not_submittable', `Voucher is ${existing.status}.`);
      if (existing.rowVersion !== command.expectedVersion) throw new ApiError(409, 'version_conflict', 'Voucher changed since it was loaded.');
      totals(voucherDto(existing).lines);
      const updatedCount = await db.erpVoucher.updateMany({
        where: { id: existing.id, status: 'draft', rowVersion: command.expectedVersion },
        data: { status: 'submitted', submittedAt: new Date(), rowVersion: { increment: 1 } },
      });
      if (updatedCount.count !== 1) throw new ApiError(409, 'version_conflict', 'Voucher changed while it was being submitted.');
      const submitted = await db.erpVoucher.findUniqueOrThrow({
        where: { id: existing.id }, include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      const response = voucherDto(submitted);
      await audit(db, {
        action: 'mesaerp.voucher.submit',
        entity: 'ErpVoucher',
        entityId: existing.id,
        before: voucherDto(existing),
        after: response,
      });
      await remember(db, command.organizationId, command.legalEntityId, scope, command.idempotencyKey, command.requestHash, response);
      return response;
    });
  }

  async approveVoucher(command: ApproveVoucherCommand): Promise<VoucherRecord> {
    return withTenant(command.organizationId, async (db) => {
      const scope = `voucher:${command.voucherId}:approve`;
      const replayed = await replay<VoucherRecord>(db, command.organizationId, scope, command.idempotencyKey, command.requestHash);
      if (replayed) return replayed;
      const existing = await db.erpVoucher.findFirst({
        where: { id: command.voucherId, legalEntityId: command.legalEntityId },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (!existing) throw new ApiError(404, 'voucher_not_found', 'Voucher not found.');
      if (existing.status !== 'submitted') throw new ApiError(409, 'voucher_not_approvable', `Voucher is ${existing.status}.`);
      if (existing.rowVersion !== command.expectedVersion) throw new ApiError(409, 'version_conflict', 'Voucher changed since it was loaded.');
      if (existing.createdBy === command.actorMembershipId) {
        throw new ApiError(409, 'maker_checker_required', 'The voucher maker cannot approve the same voucher.');
      }
      const approvedAt = new Date();
      const updatedCount = await db.erpVoucher.updateMany({
        where: { id: existing.id, status: 'submitted', rowVersion: command.expectedVersion },
        data: {
          status: 'approved', approvedAt, approvedBy: command.actorMembershipId, rowVersion: { increment: 1 },
        },
      });
      if (updatedCount.count !== 1) throw new ApiError(409, 'version_conflict', 'Voucher changed while it was being approved.');
      const approved = await db.erpVoucher.findUniqueOrThrow({
        where: { id: existing.id }, include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      const response = voucherDto(approved);
      await audit(db, {
        action: 'mesaerp.voucher.approve',
        entity: 'ErpVoucher',
        entityId: existing.id,
        before: voucherDto(existing),
        after: response,
      });
      await remember(db, command.organizationId, command.legalEntityId, scope, command.idempotencyKey, command.requestHash, response);
      return response;
    });
  }

  async postVoucher(command: PostVoucherCommand): Promise<PostedVoucherResult> {
    return withTenant(command.organizationId, async (db) => {
      const scope = `voucher:${command.voucherId}:post`;
      const replayed = await replay<PostedVoucherResult>(db, command.organizationId, scope, command.idempotencyKey, command.requestHash);
      if (replayed) return replayed;
      const existing = await db.erpVoucher.findFirst({
        where: { id: command.voucherId, legalEntityId: command.legalEntityId },
        include: { lines: { orderBy: { lineNumber: 'asc' } }, legalEntity: true, financialYear: true, accountingPeriod: true },
      });
      if (!existing) throw new ApiError(404, 'voucher_not_found', 'Voucher not found.');
      if (existing.status === 'posted') return { voucher: voucherDto(existing), journalEntry: journalDto(existing) };
      if (existing.status !== 'approved') throw new ApiError(409, 'voucher_not_postable', `Voucher is ${existing.status}; approval is required before posting.`);
      if (existing.rowVersion !== command.expectedVersion) throw new ApiError(409, 'version_conflict', 'Voucher changed since it was loaded.');
      // Period transitions take the same row lock. Whichever transaction wins
      // is allowed to complete first; the waiter then observes the committed
      // state. This prevents a post that read `open` from slipping through
      // after a concurrent soft-close or lock commits.
      const lockedPeriods = await db.$queryRaw<Array<{ name: string; status: string }>>(Prisma.sql`
        SELECT "name", "status"
        FROM "AccountingPeriod"
        WHERE "id" = ${existing.accountingPeriodId}
          AND "legalEntityId" = ${command.legalEntityId}
        FOR UPDATE
      `);
      const lockedPeriod = lockedPeriods[0];
      if (!lockedPeriod) throw new ApiError(409, 'accounting_period_missing', 'The voucher accounting period is no longer available.');
      if (lockedPeriod.status !== 'open') throw new ApiError(409, 'period_closed', `The ${lockedPeriod.name} accounting period is ${lockedPeriod.status}.`);
      await assertManufacturingSourceReadyForPosting(db, existing);
      let originalForReversal: VoucherWithLines | null = null;
      if (existing.reversalOfId) {
        await db.$queryRaw`SELECT "id" FROM "ErpVoucher" WHERE "id" = ${existing.reversalOfId} FOR UPDATE`;
        originalForReversal = await db.erpVoucher.findFirst({
          where: { id: existing.reversalOfId, legalEntityId: command.legalEntityId },
          include: { lines: { orderBy: { lineNumber: 'asc' } } },
        });
        if (!originalForReversal || originalForReversal.status !== 'posted') {
          throw new ApiError(409, 'voucher_not_reversible', 'The original voucher is not posted or was already reversed.');
        }
      }
      const dto = voucherDto(existing);
      totals(dto.lines);

      const code = VOUCHER_CODE[dto.voucherType];
      const prefix = `${existing.legalEntity.code}-${code}-${existing.financialYear.code}-`;
      const sequenceRows = await db.$queryRaw<Array<{ nextValue: number }>>(Prisma.sql`
        INSERT INTO "ErpNumberSeries" (
          "id", "organizationId", "legalEntityId", "financialYearId", "documentType", "prefix", "padding", "nextValue", "createdAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}, ${command.organizationId}, ${command.legalEntityId}, ${existing.financialYearId}, ${existing.voucherType}, ${prefix}, 6, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("organizationId", "legalEntityId", "financialYearId", "documentType")
        DO UPDATE SET "nextValue" = "ErpNumberSeries"."nextValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
        RETURNING "nextValue"
      `);
      const allocated = (sequenceRows[0]?.nextValue ?? 2) - 1;
      const voucherNumber = `${prefix}${String(allocated).padStart(6, '0')}`;
      const postedAt = new Date();
      const snapshot = { ...dto, voucherNumber, status: 'posted', version: dto.version + 1, postedAt: postedAt.toISOString(), postedBy: command.actorMembershipId };
      const snapshotHash = hashCanonical(snapshot);
      await applyInventoryPostingPlan(db, {
        organizationId: command.organizationId,
        membershipId: command.actorMembershipId,
        userId: '', role: 'mesaerp-posting', email: '',
      }, existing);
      await applyFinanceControlPosting(db, {
        organizationId: command.organizationId,
        membershipId: command.actorMembershipId,
        userId: '', role: 'mesaerp-posting', email: '',
      }, existing);
      const updatedCount = await db.erpVoucher.updateMany({
        where: { id: existing.id, rowVersion: command.expectedVersion, status: 'approved' },
        data: {
          voucherNumber, status: 'posted', sourceSnapshotHash: snapshotHash,
          postedAt, postedBy: command.actorMembershipId, rowVersion: { increment: 1 },
        },
      });
      if (updatedCount.count !== 1) throw new ApiError(409, 'version_conflict', 'Voucher changed while it was being posted.');
      const posted = await db.erpVoucher.findUniqueOrThrow({ where: { id: existing.id }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
      const response = { voucher: voucherDto(posted), journalEntry: journalDto(posted) };
      if (originalForReversal) {
        const reversedAt = new Date();
        const originalUpdated = await db.erpVoucher.updateMany({
          where: { id: originalForReversal.id, status: 'posted', rowVersion: originalForReversal.rowVersion },
          data: { status: 'reversed', reversedAt, rowVersion: { increment: 1 } },
        });
        if (originalUpdated.count !== 1) {
          throw new ApiError(409, 'version_conflict', 'The original voucher changed while the reversal was being posted.');
        }
        const reversedOriginal = await db.erpVoucher.findUniqueOrThrow({
          where: { id: originalForReversal.id }, include: { lines: { orderBy: { lineNumber: 'asc' } } },
        });
        const reversalEvent = {
          originalVoucherId: originalForReversal.id,
          originalVoucherNumber: originalForReversal.voucherNumber,
          reversalVoucherId: posted.id,
          reversalVoucherNumber: posted.voucherNumber,
          reversedAt: reversedAt.toISOString(),
        };
        await db.integrationOutboxEvent.create({
          data: {
            organizationId: command.organizationId, legalEntityId: command.legalEntityId,
            serviceId: 'mesaerp', aggregateType: 'ErpVoucher', aggregateId: originalForReversal.id,
            eventType: 'mesaerp.voucher.reversed.v1', correlationId: randomUUID(),
            causationId: posted.id,
            payload: reversalEvent, payloadHash: hashCanonical(reversalEvent),
          },
        });
        await audit(db, {
          action: 'mesaerp.voucher.reverse',
          entity: 'ErpVoucher',
          entityId: originalForReversal.id,
          before: voucherDto(originalForReversal),
          after: voucherDto(reversedOriginal),
        });
      }
      await db.integrationOutboxEvent.create({
        data: {
          organizationId: command.organizationId, legalEntityId: command.legalEntityId,
          serviceId: 'mesaerp', aggregateType: 'ErpVoucher', aggregateId: posted.id,
          eventType: 'mesaerp.voucher.posted.v1', correlationId: randomUUID(),
          payload: snapshot as unknown as Prisma.InputJsonValue, payloadHash: snapshotHash,
        },
      });
      await audit(db, {
        action: 'mesaerp.voucher.post',
        entity: 'ErpVoucher',
        entityId: posted.id,
        before: dto,
        after: response.voucher,
      });
      await remember(db, command.organizationId, command.legalEntityId, scope, command.idempotencyKey, command.requestHash, response);
      return response;
    });
  }

  async createVoucherReversal(command: CreateVoucherReversalCommand): Promise<VoucherRecord> {
    return withTenant(command.organizationId, async (db) => {
      const scope = `voucher:${command.voucherId}:reversal:create`;
      const replayed = await replay<VoucherRecord>(db, command.organizationId, scope, command.idempotencyKey, command.requestHash);
      if (replayed) return replayed;
      await db.$queryRaw`SELECT "id" FROM "ErpVoucher" WHERE "id" = ${command.voucherId} FOR UPDATE`;
      const original = await db.erpVoucher.findFirst({
        where: { id: command.voucherId, legalEntityId: command.legalEntityId },
        include: { lines: { orderBy: { lineNumber: 'asc' } }, legalEntity: true },
      });
      if (!original) throw new ApiError(404, 'voucher_not_found', 'Voucher not found.');
      if (original.status !== 'posted') throw new ApiError(409, 'voucher_not_reversible', `Voucher is ${original.status}; only a posted voucher can be reversed.`);
      if ((original.originMetadata as Record<string, unknown> | null)?.mesaerpInventoryPosting) {
        throw new ApiError(409, 'inventory_reversal_requires_adjustment', 'Stock-bearing vouchers must be corrected through a controlled inventory adjustment so stock and GL remain aligned.');
      }
      if ((original.originMetadata as Record<string, unknown> | null)?.mesaerpFinanceControl) {
        throw new ApiError(409, 'asset_reversal_requires_adjustment', 'Asset-bearing vouchers must be corrected through a controlled asset adjustment so the asset subledger and GL remain aligned.');
      }
      if (original.rowVersion !== command.input.expectedVersion) throw new ApiError(409, 'version_conflict', 'Voucher changed since it was loaded.');
      const existingReversal = await db.erpVoucher.findFirst({ where: { reversalOfId: original.id } });
      if (existingReversal) throw new ApiError(409, 'reversal_exists', 'A reversal draft already exists for this voucher.');
      const businessDate = dateOnly(command.input.voucherDate);
      const { year, period } = await findYearAndPeriod(db, command.legalEntityId, businessDate);
      const originalDto = voucherDto(original);
      const reversalLines = originalDto.lines.map((line) => ({ ...line, debit: line.credit, credit: line.debit }));
      const amount = totals(reversalLines);
      const reversal = await db.erpVoucher.create({
        data: {
          organizationId: command.organizationId,
          legalEntityId: command.legalEntityId,
          financialYearId: year.id,
          accountingPeriodId: period.id,
          voucherType: original.voucherType,
          voucherNumber: `DRAFT-${randomUUID()}`,
          businessDate,
          currency: original.currency,
          transactionDebit: amount.debit,
          transactionCredit: amount.credit,
          baseDebit: amount.debit,
          baseCredit: amount.credit,
          reference: `REVERSAL OF ${original.voucherNumber}`,
          narration: command.input.reason,
          reversalOfId: original.id,
          originType: 'reversal',
          originMetadata: {
            originalVoucherId: original.id,
            originalVoucherNumber: original.voucherNumber,
            originalSnapshotHash: original.sourceSnapshotHash,
            reason: command.input.reason,
          },
          createdBy: command.actorMembershipId,
          lines: {
            create: original.lines.map((line, index) => ({
              organizationId: command.organizationId,
              legalEntityId: command.legalEntityId,
              lineNumber: index + 1,
              accountId: line.accountId,
              accountSnapshot: line.accountSnapshot as Prisma.InputJsonValue,
              transactionDebit: line.transactionCredit,
              transactionCredit: line.transactionDebit,
              baseDebit: line.baseCredit,
              baseCredit: line.baseDebit,
              billReference: line.billReference,
              dueDate: line.dueDate,
              dimensions: line.dimensions as Prisma.InputJsonValue,
              narration: line.narration,
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      const response = voucherDto(reversal);
      await audit(db, {
        action: 'mesaerp.voucher.reversal.create',
        entity: 'ErpVoucher',
        entityId: reversal.id,
        before: originalDto,
        after: response,
      });
      await remember(db, command.organizationId, command.legalEntityId, scope, command.idempotencyKey, command.requestHash, response);
      return response;
    });
  }

  async getJournalEntry(organizationId: string, legalEntityId: string, journalEntryId: string): Promise<JournalEntryRecord | null> {
    return withTenant(organizationId, async (db) => {
      const voucher = await db.erpVoucher.findFirst({
        where: { id: journalEntryId, legalEntityId, status: { in: ['posted', 'reversed'] } },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      return voucher ? journalDto(voucher) : null;
    });
  }
}
