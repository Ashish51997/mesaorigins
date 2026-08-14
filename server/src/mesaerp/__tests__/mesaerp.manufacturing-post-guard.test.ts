import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  accountingSnapshot,
  assertManufacturingSourceReadyForPosting,
} from '../inventoryPosting';
import { hashCanonical } from '../repository';

function fixture(qaStatus: string) {
  const source = {
    id: `manufacturing-source-${qaStatus}`,
    status: 'approved',
    voucherType: 'completion',
    qaDisposition: { status: qaStatus },
    batchCost: null,
  };
  const inventoryPlan = {
    version: 1,
    sourceType: 'manufacturing_voucher',
    sourceId: source.id,
    businessDate: '2026-08-14',
    lines: [],
  };
  const voucher = {
    id: `accounting-voucher-${qaStatus}`,
    legalEntityId: 'entity-manufacturing-guard',
    originType: 'source_posting',
    originMetadata: {},
    lines: [{
      lineNumber: 1,
      accountId: 'account-wip',
      baseDebit: new Prisma.Decimal(1),
      baseCredit: new Prisma.Decimal(0),
      narration: 'Completion evidence',
      dimensions: {},
    }],
  };
  const sourceSnapshotHash = hashCanonical(source);
  const accountingSnapshotHash = hashCanonical(accountingSnapshot(voucher as never));
  voucher.originMetadata = {
    mesaerpPostingSource: { type: 'manufacturing_voucher', id: source.id, sourceSnapshotHash },
    mesaerpInventoryPosting: inventoryPlan,
    mesaerpAccountingSnapshotHash: accountingSnapshotHash,
  };
  const link = {
    sourceType: 'manufacturing_voucher',
    sourceId: source.id,
    sourceSnapshotHash,
    mappingSnapshot: {
      sourceType: 'manufacturing_voucher',
      sourceId: source.id,
      sourceSnapshotHash,
      inventoryPlan,
      accountingSnapshotHash,
    },
  };
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    erpPostingLink: { findFirst: vi.fn().mockResolvedValue(link) },
    erpManufacturingVoucher: { findFirst: vi.fn().mockResolvedValue(source) },
  };
  return { db, voucher };
}

describe('MesaERP generic manufacturing voucher post guard', () => {
  it.each(['pending', 'hold', 'rejected'])('blocks %s QA after locking and reloading the manufacturing source', async (qaStatus) => {
    const { db, voucher } = fixture(qaStatus);
    await expect(assertManufacturingSourceReadyForPosting(db as never, voucher as never))
      .rejects.toMatchObject({ code: 'qa_disposition_blocks_completion' });
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(db.erpPostingLink.findFirst).toHaveBeenCalledTimes(1);
    expect(db.erpManufacturingVoucher.findFirst).toHaveBeenCalledTimes(1);
  });

  it('allows a current completion snapshot with not-applicable QA', async () => {
    const { db, voucher } = fixture('not_applicable');
    await expect(assertManufacturingSourceReadyForPosting(db as never, voucher as never)).resolves.toBeUndefined();
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
