import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from '../middleware/error';
import { assertBalancedVoucherLines, type LegalEntityCreate, type VoucherCreate, type VoucherLineInput, type VoucherReversalCreate, type VoucherType, type VoucherUpdate } from './schemas';

export interface LegalEntityRecord extends LegalEntityCreate {
  id: string;
  organizationId: string;
  version: number;
  createdAt: string;
}

export interface VoucherRecord {
  id: string;
  organizationId: string;
  legalEntityId: string;
  voucherType: VoucherType;
  voucherDate: string;
  currencyCode: string;
  reference: string;
  narration: string;
  lines: VoucherLineInput[];
  status: 'draft' | 'submitted' | 'approved' | 'posted' | 'reversed';
  version: number;
  voucherNumber?: string;
  snapshotHash?: string;
  journalEntryId?: string;
  reversalOfId?: string;
  reversedAt?: string;
  createdAt: string;
  createdBy: string;
  submittedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  postedAt?: string;
  postedBy?: string;
}

export interface JournalEntryRecord {
  id: string;
  organizationId: string;
  legalEntityId: string;
  voucherId: string;
  voucherNumber: string;
  voucherType: VoucherType;
  postingDate: string;
  currencyCode: string;
  lines: VoucherLineInput[];
  status: 'posted';
  snapshotHash: string;
  postedAt: string;
  postedBy: string;
}

export interface AccountRecord {
  id: string;
  legalEntityId: string;
  code: string;
  name: string;
  accountType: string;
  currency: string;
  allowPosting: boolean;
}

export interface IdempotentMutation {
  idempotencyKey: string;
  requestHash: string;
}

interface ScopedCommand extends IdempotentMutation {
  organizationId: string;
  actorMembershipId: string;
}

export interface CreateLegalEntityCommand extends ScopedCommand {
  input: LegalEntityCreate;
}

export interface CreateVoucherCommand extends ScopedCommand {
  legalEntityId: string;
  input: VoucherCreate;
}

export interface UpdateVoucherCommand extends ScopedCommand {
  legalEntityId: string;
  voucherId: string;
  input: VoucherUpdate;
}

export interface PostVoucherCommand extends ScopedCommand {
  legalEntityId: string;
  voucherId: string;
  expectedVersion: number;
}

export interface CreateVoucherReversalCommand extends ScopedCommand {
  legalEntityId: string;
  voucherId: string;
  input: VoucherReversalCreate;
}

export type SubmitVoucherCommand = PostVoucherCommand;
export type ApproveVoucherCommand = PostVoucherCommand;

export interface PostedVoucherResult {
  voucher: VoucherRecord;
  journalEntry: JournalEntryRecord;
}

export interface MesaErpRepository {
  listLegalEntities(organizationId: string): Promise<LegalEntityRecord[]>;
  getLegalEntity(organizationId: string, legalEntityId: string): Promise<LegalEntityRecord | null>;
  createLegalEntity(command: CreateLegalEntityCommand): Promise<LegalEntityRecord>;
  listAccounts(organizationId: string, legalEntityId: string): Promise<AccountRecord[]>;
  listVouchers(organizationId: string, legalEntityId: string): Promise<VoucherRecord[]>;
  getVoucher(organizationId: string, legalEntityId: string, voucherId: string): Promise<VoucherRecord | null>;
  createVoucher(command: CreateVoucherCommand): Promise<VoucherRecord>;
  updateVoucher(command: UpdateVoucherCommand): Promise<VoucherRecord>;
  submitVoucher(command: SubmitVoucherCommand): Promise<VoucherRecord>;
  approveVoucher(command: ApproveVoucherCommand): Promise<VoucherRecord>;
  postVoucher(command: PostVoucherCommand): Promise<PostedVoucherResult>;
  createVoucherReversal(command: CreateVoucherReversalCommand): Promise<VoucherRecord>;
  getJournalEntry(organizationId: string, legalEntityId: string, journalEntryId: string): Promise<JournalEntryRecord | null>;
}

interface IdempotencyRecord {
  requestHash: string;
  response: unknown;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function ensureBalanced(lines: VoucherLineInput[]): void {
  try {
    assertBalancedVoucherLines(lines);
  } catch {
    throw new ApiError(422, 'unbalanced_voucher', 'Voucher lines must contain equal, non-zero debit and credit totals.');
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function fiscalYearLabel(date: string, startMonth: number): string {
  const [year, month] = date.split('-').map(Number);
  const startYear = month >= startMonth ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

const VOUCHER_CODE: Record<VoucherType, string> = {
  contra: 'CON', payment: 'PAY', receipt: 'REC', journal: 'JRN', sales: 'SAL', purchase: 'PUR',
  credit_note: 'CRN', debit_note: 'DBN', stock_journal: 'STJ', manufacturing_journal: 'MFG', opening: 'OPN',
  depreciation: 'DEP', fx_adjustment: 'FXA', intercompany: 'ICO', consolidation_elimination: 'ELM',
};

/**
 * Process-local reference store for unit tests and router development.
 * Production integration must implement MesaErpRepository with PostgreSQL
 * transactions and unique idempotency/number-series constraints.
 */
export class InMemoryMesaErpRepository implements MesaErpRepository {
  private readonly legalEntities = new Map<string, LegalEntityRecord>();
  private readonly vouchers = new Map<string, VoucherRecord>();
  private readonly journals = new Map<string, JournalEntryRecord>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly sequences = new Map<string, number>();
  private writeTail: Promise<void> = Promise.resolve();

  private async serialized<T>(operation: () => T | Promise<T>): Promise<T> {
    const previous = this.writeTail;
    let release!: () => void;
    this.writeTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private idempotent<T>(scope: string, mutation: IdempotentMutation, operation: () => T): T {
    const key = `${scope}:${mutation.idempotencyKey}`;
    const existing = this.idempotency.get(key);
    if (existing) {
      if (existing.requestHash !== mutation.requestHash) {
        throw new ApiError(409, 'idempotency_conflict', 'This idempotency key was already used with a different request.');
      }
      return clone(existing.response as T);
    }
    const result = operation();
    this.idempotency.set(key, { requestHash: mutation.requestHash, response: clone(result) });
    return clone(result);
  }

  async listLegalEntities(organizationId: string): Promise<LegalEntityRecord[]> {
    return [...this.legalEntities.values()]
      .filter((entity) => entity.organizationId === organizationId)
      .sort((left, right) => left.code.localeCompare(right.code))
      .map(clone);
  }

  async getLegalEntity(organizationId: string, legalEntityId: string): Promise<LegalEntityRecord | null> {
    const entity = this.legalEntities.get(legalEntityId);
    return entity?.organizationId === organizationId ? clone(entity) : null;
  }

  async listAccounts(_organizationId: string, _legalEntityId: string): Promise<AccountRecord[]> {
    return [];
  }

  async listVouchers(organizationId: string, legalEntityId: string): Promise<VoucherRecord[]> {
    return [...this.vouchers.values()]
      .filter((voucher) => voucher.organizationId === organizationId && voucher.legalEntityId === legalEntityId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(clone);
  }

  async createLegalEntity(command: CreateLegalEntityCommand): Promise<LegalEntityRecord> {
    return this.serialized(() => this.idempotent(
      `${command.organizationId}:legal-entity:create`,
      command,
      () => {
        const duplicate = [...this.legalEntities.values()].find((entity) => (
          entity.organizationId === command.organizationId && entity.code === command.input.code
        ));
        if (duplicate) throw new ApiError(409, 'legal_entity_code_exists', 'A legal entity with this code already exists.');
        const entity: LegalEntityRecord = {
          ...clone(command.input),
          id: randomUUID(),
          organizationId: command.organizationId,
          version: 0,
          createdAt: new Date().toISOString(),
        };
        this.legalEntities.set(entity.id, entity);
        return entity;
      },
    ));
  }

  async getVoucher(organizationId: string, legalEntityId: string, voucherId: string): Promise<VoucherRecord | null> {
    const voucher = this.vouchers.get(voucherId);
    return voucher?.organizationId === organizationId && voucher.legalEntityId === legalEntityId ? clone(voucher) : null;
  }

  async createVoucher(command: CreateVoucherCommand): Promise<VoucherRecord> {
    return this.serialized(() => this.idempotent(
      `${command.organizationId}:${command.legalEntityId}:voucher:create`,
      command,
      () => {
        const entity = this.legalEntities.get(command.legalEntityId);
        if (!entity || entity.organizationId !== command.organizationId) throw new ApiError(404, 'legal_entity_not_found', 'Legal entity not found.');
        if (command.input.currencyCode !== entity.baseCurrency) {
          throw new ApiError(422, 'foreign_currency_not_supported', 'Foreign-currency posting is disabled until an approved exchange rate and base-currency amounts are supplied.');
        }
        ensureBalanced(command.input.lines);
        const voucher: VoucherRecord = {
          ...clone(command.input),
          id: randomUUID(),
          organizationId: command.organizationId,
          legalEntityId: command.legalEntityId,
          status: 'draft',
          version: 0,
          createdAt: new Date().toISOString(),
          createdBy: command.actorMembershipId,
        };
        this.vouchers.set(voucher.id, voucher);
        return voucher;
      },
    ));
  }

  async updateVoucher(command: UpdateVoucherCommand): Promise<VoucherRecord> {
    return this.serialized(() => this.idempotent(
      `${command.organizationId}:${command.legalEntityId}:${command.voucherId}:voucher:update`,
      command,
      () => {
        const voucher = this.vouchers.get(command.voucherId);
        if (!voucher || voucher.organizationId !== command.organizationId || voucher.legalEntityId !== command.legalEntityId) {
          throw new ApiError(404, 'voucher_not_found', 'Voucher not found.');
        }
        if (voucher.status !== 'draft') throw new ApiError(409, 'posted_immutable', 'Posted vouchers are immutable; create a reversal or adjustment.');
        if (voucher.version !== command.input.expectedVersion) throw new ApiError(409, 'version_conflict', 'Voucher changed since it was loaded.');
        const { expectedVersion: _expectedVersion, ...patch } = command.input;
        const updated: VoucherRecord = { ...voucher, ...clone(patch), version: voucher.version + 1 };
        ensureBalanced(updated.lines);
        this.vouchers.set(updated.id, updated);
        return updated;
      },
    ));
  }

  async submitVoucher(command: SubmitVoucherCommand): Promise<VoucherRecord> {
    return this.serialized(() => this.idempotent(
      `${command.organizationId}:${command.legalEntityId}:${command.voucherId}:voucher:submit`,
      command,
      () => {
        const voucher = this.vouchers.get(command.voucherId);
        if (!voucher || voucher.organizationId !== command.organizationId || voucher.legalEntityId !== command.legalEntityId) {
          throw new ApiError(404, 'voucher_not_found', 'Voucher not found.');
        }
        if (voucher.status !== 'draft') throw new ApiError(409, 'voucher_not_submittable', `Voucher is ${voucher.status}.`);
        if (voucher.version !== command.expectedVersion) throw new ApiError(409, 'version_conflict', 'Voucher changed since it was loaded.');
        ensureBalanced(voucher.lines);
        const submitted: VoucherRecord = {
          ...voucher,
          status: 'submitted',
          version: voucher.version + 1,
          submittedAt: new Date().toISOString(),
        };
        this.vouchers.set(voucher.id, submitted);
        return submitted;
      },
    ));
  }

  async approveVoucher(command: ApproveVoucherCommand): Promise<VoucherRecord> {
    return this.serialized(() => this.idempotent(
      `${command.organizationId}:${command.legalEntityId}:${command.voucherId}:voucher:approve`,
      command,
      () => {
        const voucher = this.vouchers.get(command.voucherId);
        if (!voucher || voucher.organizationId !== command.organizationId || voucher.legalEntityId !== command.legalEntityId) {
          throw new ApiError(404, 'voucher_not_found', 'Voucher not found.');
        }
        if (voucher.status !== 'submitted') throw new ApiError(409, 'voucher_not_approvable', `Voucher is ${voucher.status}.`);
        if (voucher.version !== command.expectedVersion) throw new ApiError(409, 'version_conflict', 'Voucher changed since it was loaded.');
        if (voucher.createdBy === command.actorMembershipId) {
          throw new ApiError(409, 'maker_checker_required', 'The voucher maker cannot approve the same voucher.');
        }
        const approved: VoucherRecord = {
          ...voucher,
          status: 'approved',
          version: voucher.version + 1,
          approvedAt: new Date().toISOString(),
          approvedBy: command.actorMembershipId,
        };
        this.vouchers.set(voucher.id, approved);
        return approved;
      },
    ));
  }

  async postVoucher(command: PostVoucherCommand): Promise<PostedVoucherResult> {
    return this.serialized(() => this.idempotent(
      `${command.organizationId}:${command.legalEntityId}:${command.voucherId}:voucher:post`,
      command,
      () => {
        const entity = this.legalEntities.get(command.legalEntityId);
        if (!entity || entity.organizationId !== command.organizationId) throw new ApiError(404, 'legal_entity_not_found', 'Legal entity not found.');
        const voucher = this.vouchers.get(command.voucherId);
        if (!voucher || voucher.organizationId !== command.organizationId || voucher.legalEntityId !== command.legalEntityId) {
          throw new ApiError(404, 'voucher_not_found', 'Voucher not found.');
        }
        if (voucher.status === 'posted' && voucher.journalEntryId) {
          const existingJournal = this.journals.get(voucher.journalEntryId);
          if (!existingJournal) throw new ApiError(500, 'journal_missing', 'Posted voucher is missing its journal entry.');
          return { voucher, journalEntry: existingJournal };
        }
        if (voucher.status !== 'approved') throw new ApiError(409, 'voucher_not_postable', `Voucher is ${voucher.status}; approval is required before posting.`);
        if (voucher.version !== command.expectedVersion) throw new ApiError(409, 'version_conflict', 'Voucher changed since it was loaded.');
        ensureBalanced(voucher.lines);
        const originalForReversal = voucher.reversalOfId ? this.vouchers.get(voucher.reversalOfId) : undefined;
        if (voucher.reversalOfId && (!originalForReversal || originalForReversal.status !== 'posted')) {
          throw new ApiError(409, 'voucher_not_reversible', 'The original voucher is not posted or was already reversed.');
        }

        const financialYear = fiscalYearLabel(voucher.voucherDate, entity.fiscalYearStartMonth);
        const sequenceKey = `${entity.id}:${voucher.voucherType}:${financialYear}`;
        const sequence = (this.sequences.get(sequenceKey) ?? 0) + 1;
        this.sequences.set(sequenceKey, sequence);
        const voucherNumber = `${entity.code}-${VOUCHER_CODE[voucher.voucherType]}-${financialYear}-${String(sequence).padStart(6, '0')}`;
        const postedAt = new Date().toISOString();
        const snapshot = {
          legalEntityId: voucher.legalEntityId,
          voucherId: voucher.id,
          voucherNumber,
          voucherType: voucher.voucherType,
          voucherDate: voucher.voucherDate,
          currencyCode: voucher.currencyCode,
          reference: voucher.reference,
          narration: voucher.narration,
          lines: voucher.lines,
        };
        const snapshotHash = hashCanonical(snapshot);
        const journalEntry: JournalEntryRecord = {
          id: randomUUID(),
          organizationId: command.organizationId,
          legalEntityId: command.legalEntityId,
          voucherId: voucher.id,
          voucherNumber,
          voucherType: voucher.voucherType,
          postingDate: voucher.voucherDate,
          currencyCode: voucher.currencyCode,
          lines: clone(voucher.lines),
          status: 'posted',
          snapshotHash,
          postedAt,
          postedBy: command.actorMembershipId,
        };
        const postedVoucher: VoucherRecord = {
          ...voucher,
          status: 'posted',
          version: voucher.version + 1,
          voucherNumber,
          snapshotHash,
          journalEntryId: journalEntry.id,
          postedAt,
          postedBy: command.actorMembershipId,
        };
        this.journals.set(journalEntry.id, journalEntry);
        this.vouchers.set(voucher.id, postedVoucher);
        if (originalForReversal) {
          this.vouchers.set(originalForReversal.id, { ...originalForReversal, status: 'reversed', version: originalForReversal.version + 1, reversedAt: postedAt });
        }
        return { voucher: postedVoucher, journalEntry };
      },
    ));
  }

  async createVoucherReversal(command: CreateVoucherReversalCommand): Promise<VoucherRecord> {
    return this.serialized(() => this.idempotent(
      `${command.organizationId}:${command.legalEntityId}:${command.voucherId}:voucher:reversal:create`,
      command,
      () => {
        const original = this.vouchers.get(command.voucherId);
        if (!original || original.organizationId !== command.organizationId || original.legalEntityId !== command.legalEntityId) {
          throw new ApiError(404, 'voucher_not_found', 'Voucher not found.');
        }
        if (original.status !== 'posted') throw new ApiError(409, 'voucher_not_reversible', `Voucher is ${original.status}; only a posted voucher can be reversed.`);
        if (original.version !== command.input.expectedVersion) throw new ApiError(409, 'version_conflict', 'Voucher changed since it was loaded.');
        if ([...this.vouchers.values()].some((voucher) => voucher.reversalOfId === original.id)) {
          throw new ApiError(409, 'reversal_exists', 'A reversal draft already exists for this voucher.');
        }
        const reversal: VoucherRecord = {
          id: randomUUID(), organizationId: command.organizationId, legalEntityId: command.legalEntityId,
          voucherType: original.voucherType, voucherDate: command.input.voucherDate,
          currencyCode: original.currencyCode, reference: `REVERSAL OF ${original.voucherNumber ?? original.id}`,
          narration: command.input.reason,
          lines: original.lines.map((line) => ({ ...clone(line), debit: line.credit, credit: line.debit })),
          status: 'draft', version: 0, reversalOfId: original.id,
          createdAt: new Date().toISOString(), createdBy: command.actorMembershipId,
        };
        ensureBalanced(reversal.lines);
        this.vouchers.set(reversal.id, reversal);
        return reversal;
      },
    ));
  }

  async getJournalEntry(organizationId: string, legalEntityId: string, journalEntryId: string): Promise<JournalEntryRecord | null> {
    const journal = this.journals.get(journalEntryId);
    return journal?.organizationId === organizationId && journal.legalEntityId === legalEntityId ? clone(journal) : null;
  }
}
