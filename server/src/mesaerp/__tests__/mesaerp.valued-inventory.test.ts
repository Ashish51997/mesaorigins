import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { basePrisma, withTenant } from '../../db';

const app = buildApp();
const OWNER = 'vikram.malhotra@masspolymer.in';
const CHECKER = 'deepak.bansal@masspolymer.in';
const SALES_USER = 'amit.verma@masspolymer.in';
const ORGANIZATION_ID = 'org-demo';
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let entitlementBefore: { status: string } | null = null;

beforeAll(async () => {
  entitlementBefore = await basePrisma.organizationService.findUnique({
    where: { organizationId_serviceId: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp' } },
    select: { status: true },
  });
  await basePrisma.organizationService.upsert({
    where: { organizationId_serviceId: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp' } },
    create: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp', status: 'active' },
    update: { status: 'active' },
  });
});

afterAll(async () => {
  if (entitlementBefore) {
    await basePrisma.organizationService.update({
      where: { organizationId_serviceId: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp' } },
      data: { status: entitlementBefore.status },
    });
  }
});

async function companyId() {
  const response = await request(app).get('/api/mesaerp/v1/entities').set('x-dev-user', OWNER);
  expect(response.status).toBe(200);
  expect(response.body[0]?.id).toBeTruthy();
  return response.body[0].id as string;
}

async function postAccountingVoucher(
  entityId: string,
  voucherId: string,
  key: string,
  maker = OWNER,
  checker = CHECKER,
) {
  const submitted = await request(app)
    .post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${voucherId}/submit`)
    .set('x-dev-user', maker).set('Idempotency-Key', `${key}-submit`).send({ expectedVersion: 0 });
  expect(submitted.status).toBe(200);
  expect(submitted.body.status).toBe('submitted');
  const approved = await request(app)
    .post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${voucherId}/approve`)
    .set('x-dev-user', checker).set('Idempotency-Key', `${key}-approve`).send({ expectedVersion: 1 });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  expect(approved.body.status).toBe('approved');
  const posted = await request(app)
    .post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${voucherId}/post`)
    .set('x-dev-user', checker).set('Idempotency-Key', `${key}-post`).send({ expectedVersion: 2 });
  expect(posted.status).toBe(200);
  expect(posted.body.voucher.status).toBe('posted');
  expect(posted.body.voucher.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
  return posted.body;
}

async function createWarehouse(entityId: string, code: string, key: string) {
  const response = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/warehouses`)
    .set('x-dev-user', OWNER).set('Idempotency-Key', key)
    .send({ code, name: `Warehouse ${code}`, kind: 'warehouse', plantCode: 'PRIMARY' });
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ code, rowVersion: 0, allowNegative: false });
  return response.body as { id: string; code: string };
}

async function createItem(entityId: string, body: Record<string, unknown>, key: string) {
  const response = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/items`)
    .set('x-dev-user', OWNER).set('Idempotency-Key', key).send(body);
  expect(response.status).toBe(201);
  expect(typeof response.body.gstRate).toBe('string');
  return response.body as { id: string; itemCode: string; rowVersion: number };
}

describe('MesaERP valued inventory and posting engine', () => {
  it('posts weighted-average receipts, transfers and physical counts through immutable voucher drafts', async () => {
    const run = suffix();
    const entityId = await companyId();
    const denied = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/items`).set('x-dev-user', SALES_USER);
    expect(denied.status).toBe(403);

    const source = await createWarehouse(entityId, `SRC-${run}`, `warehouse-source-${run}`);
    const destination = await createWarehouse(entityId, `DST-${run}`, `warehouse-destination-${run}`);
    const itemBody = {
      itemCode: `RM-${run}`, name: `Resin ${run}`, itemType: 'inventory', baseUom: 'KG', gstRate: '18',
      valuationMethod: 'moving_average', inventoryAccount: '1200', consumptionAccount: '5000',
      purchaseAccount: '5000', salesAccount: '4000',
    };
    const item = await createItem(entityId, itemBody, `item-create-${run}`);
    const itemReplay = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/items`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `item-create-${run}`).send(itemBody);
    expect(itemReplay.status).toBe(201);
    expect(itemReplay.body.id).toBe(item.id);

    const updated = await request(app).patch(`/api/mesaerp/v1/entities/${entityId}/items/${item.id}`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `item-update-${run}`)
      .send({ expectedRowVersion: 0, name: `Resin valued ${run}` });
    expect(updated.status).toBe(200);
    expect(updated.body.rowVersion).toBe(1);

    const receipt = async (quantity: string, unitCost: string, key: string) => {
      const response = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/stock-adjustments`)
        .set('x-dev-user', OWNER).set('Idempotency-Key', key).send({
          businessDate: '2026-08-14', reference: key, reason: 'Approved opening receipt evidence',
          lines: [{ itemId: item.id, warehouseId: source.id, quantity, uom: 'KG', unitCost }],
        });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ sourceType: 'stock_adjustment', voucherStatus: 'draft' });
      return response.body as { voucherId: string; sourceId: string };
    };
    const first = await receipt('10', '10', `receipt-one-${run}`);
    const sourceEdit = await request(app).patch(`/api/mesaerp/v1/entities/${entityId}/vouchers/${first.voucherId}`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `source-edit-${run}`).send({ expectedVersion: 0, narration: 'tamper' });
    expect(sourceEdit.status).toBe(409);
    expect(sourceEdit.body.error.code).toBe('source_posting_immutable');
    const firstPosted = await postAccountingVoucher(entityId, first.voucherId, `receipt-one-voucher-${run}`);
    const postReplay = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${first.voucherId}/post`)
      .set('x-dev-user', CHECKER).set('Idempotency-Key', `receipt-one-voucher-${run}-post`).send({ expectedVersion: 2 });
    expect(postReplay.status).toBe(200);
    expect(postReplay.body.voucher.id).toBe(firstPosted.voucher.id);

    const second = await receipt('10', '20', `receipt-two-${run}`);
    await postAccountingVoucher(entityId, second.voucherId, `receipt-two-voucher-${run}`);
    const balanceAfterReceipts = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/stock-balances?itemId=${item.id}&warehouseId=${source.id}`).set('x-dev-user', OWNER);
    expect(balanceAfterReceipts.status).toBe(200);
    expect(balanceAfterReceipts.body[0]).toMatchObject({ quantity: '20', value: '300', unitCost: '15' });

    const transfer = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/stock-transfers`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `transfer-${run}`).send({
        businessDate: '2026-08-14', reference: `TR-${run}`, fromWarehouseId: source.id, toWarehouseId: destination.id,
        lines: [{ itemId: item.id, quantity: '4', uom: 'KG' }],
      });
    expect(transfer.status).toBe(201);
    await postAccountingVoucher(entityId, transfer.body.voucherId, `transfer-voucher-${run}`);
    const sourceBalance = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/stock-balances?itemId=${item.id}&warehouseId=${source.id}`).set('x-dev-user', OWNER);
    const destinationBalance = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/stock-balances?itemId=${item.id}&warehouseId=${destination.id}`).set('x-dev-user', OWNER);
    expect(sourceBalance.body[0]).toMatchObject({ quantity: '16', value: '240', unitCost: '15' });
    expect(destinationBalance.body[0]).toMatchObject({ quantity: '4', value: '60', unitCost: '15' });

    const negative = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/stock-adjustments`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `negative-${run}`).send({
        businessDate: '2026-08-14', reference: `NEG-${run}`, reason: 'Attempt issue beyond available stock',
        lines: [{ itemId: item.id, warehouseId: source.id, quantity: '-17', uom: 'KG' }],
      });
    expect(negative.status).toBe(409);
    expect(negative.body.error.code).toBe('negative_stock_prevented');

    const lockedPolicy = await request(app).patch(`/api/mesaerp/v1/entities/${entityId}/items/${item.id}`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `item-policy-${run}`)
      .send({ expectedRowVersion: 1, valuationMethod: 'fifo' });
    expect(lockedPolicy.status).toBe(409);
    expect(lockedPolicy.body.error.code).toBe('item_stock_policy_locked');

    const count = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/physical-counts`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `count-${run}`).send({
        businessDate: '2026-08-14', warehouseId: source.id, reference: `COUNT-${run}`,
        lines: [{ itemId: item.id, countedQuantity: '15', uom: 'KG' }],
      });
    expect(count.status).toBe(201);
    expect(count.body).toMatchObject({ status: 'adjustment_pending', rowVersion: 0 });
    expect(count.body.lines[0]).toMatchObject({ bookQuantity: '16', countedQuantity: '15', varianceQuantity: '-1' });
    await postAccountingVoucher(entityId, count.body.posting.voucherId, `count-voucher-${run}`);
    const countRead = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/physical-counts/${count.body.id}`).set('x-dev-user', OWNER);
    expect(countRead.status).toBe(200);
    expect(countRead.body.posting.voucherStatus).toBe('posted');

    const ledger = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/stock-ledger?itemId=${item.id}`).set('x-dev-user', OWNER);
    expect(ledger.status).toBe(200);
    expect(ledger.body.every((row: { quantity: unknown; value: unknown }) => typeof row.quantity === 'string' && typeof row.value === 'string')).toBe(true);
    const movementId = ledger.body[0].id as string;
    await expect(withTenant(ORGANIZATION_ID, (tx) => tx.erpStockMovement.update({ where: { id: movementId }, data: { value: '999' } }))).rejects.toThrow(/append-only inventory evidence/);
  });

  it('routes manufacturing issue, return and completion through one balanced GL posting and stock movement each', async () => {
    const run = suffix();
    const entityId = await companyId();
    const warehouse = await createWarehouse(entityId, `MFG-${run}`, `warehouse-mfg-${run}`);
    const raw = await createItem(entityId, {
      itemCode: `RM-MFG-${run}`, name: `Manufacturing resin ${run}`, itemType: 'inventory', baseUom: 'KG',
      valuationMethod: 'moving_average', inventoryAccount: '1200', consumptionAccount: '5000', salesAccount: '4000', purchaseAccount: '5000',
    }, `item-rm-${run}`);
    const finished = await createItem(entityId, {
      itemCode: `FG-MFG-${run}`, name: `Finished component ${run}`, itemType: 'inventory', baseUom: 'EA',
      valuationMethod: 'moving_average', inventoryAccount: '1220', consumptionAccount: '5100', salesAccount: '4000', purchaseAccount: '5000',
    }, `item-fg-${run}`);
    const opening = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/stock-adjustments`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `mfg-opening-${run}`).send({
        businessDate: '2026-08-14', reference: `OPEN-${run}`, reason: 'Opening raw material for manufacturing test',
        lines: [{ itemId: raw.id, warehouseId: warehouse.id, quantity: '10', uom: 'KG', unitCost: '10' }],
      });
    expect(opening.status, JSON.stringify(opening.body)).toBe(201);
    await postAccountingVoucher(entityId, opening.body.voucherId, `mfg-opening-voucher-${run}`);

    const batch = `B-${run}`;
    const postManufacturingSource = async (body: Record<string, unknown>, key: string, assertBlocked = false) => {
      const created = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/manufacturing-vouchers`)
        .set('x-dev-user', OWNER).set('Idempotency-Key', `${key}-create`).send(body);
      expect(created.status).toBe(201);
      const submitted = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/manufacturing-vouchers/${created.body.id}/submit`)
        .set('x-dev-user', OWNER).set('Idempotency-Key', `${key}-submit`).send({ expectedRowVersion: 0 });
      expect(submitted.body.status).toBe('submitted');
      const approved = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/manufacturing-vouchers/${created.body.id}/approve`)
        .set('x-dev-user', CHECKER).set('Idempotency-Key', `${key}-approve`).send({ expectedRowVersion: 1 });
      expect(approved.status).toBe(200);
      const posting = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/posting-links/manufacturing_voucher/${created.body.id}`).set('x-dev-user', OWNER);
      expect(posting.status).toBe(200);
      expect(posting.body.voucherStatus).toBe('draft');
      if (assertBlocked) {
        const blocked = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/manufacturing-vouchers/${created.body.id}/post`)
          .set('x-dev-user', CHECKER).set('Idempotency-Key', `${key}-source-post`).send({ expectedRowVersion: 2 });
        expect(blocked.status).toBe(409);
        expect(blocked.body.error.code).toBe('accounting_voucher_not_posted');
      }
      const accounting = await postAccountingVoucher(entityId, posting.body.voucherId, `${key}-accounting`, CHECKER, OWNER);
      expect(accounting.voucher.lines.reduce((total: number, line: { debit: string }) => total + Number(line.debit), 0))
        .toBeCloseTo(accounting.voucher.lines.reduce((total: number, line: { credit: string }) => total + Number(line.credit), 0), 6);
      const posted = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/manufacturing-vouchers/${created.body.id}/post`)
        .set('x-dev-user', CHECKER).set('Idempotency-Key', `${key}-source-post`).send({ expectedRowVersion: 2 });
      expect(posted.status).toBe(200);
      expect(posted.body.status).toBe('posted');
      return { source: posted.body, accounting };
    };

    await postManufacturingSource({
      businessDate: '2026-08-14', voucherType: 'issue', batchNumber: batch,
      materialLines: [{ itemId: raw.id, description: 'Resin issue', quantity: '4', uom: 'KG', rate: '10', warehouseCode: warehouse.code }],
    }, `mfg-issue-${run}`, true);
    await postManufacturingSource({
      businessDate: '2026-08-14', voucherType: 'return', batchNumber: batch,
      materialLines: [{ itemId: raw.id, description: 'Resin return', quantity: '1', uom: 'KG', rate: '10', warehouseCode: warehouse.code }],
    }, `mfg-return-${run}`);
    const completion = await postManufacturingSource({
      businessDate: '2026-08-14', voucherType: 'completion', batchNumber: batch,
      outputLines: [{ itemId: finished.id, description: 'Finished output', quantity: '3', uom: 'EA', warehouseCode: warehouse.code, batchNumber: batch }],
      qaDisposition: { status: 'accepted', reference: `QA-${run}`, notes: '' },
    }, `mfg-completion-${run}`);
    expect(completion.source.batchCost).toMatchObject({ materialCost: '30', actualCost: '30', outputQuantity: '3', unitCost: '10' });

    const rawBalance = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/stock-balances?itemId=${raw.id}&warehouseId=${warehouse.id}`).set('x-dev-user', OWNER);
    const finishedBalance = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/stock-balances?itemId=${finished.id}&warehouseId=${warehouse.id}`).set('x-dev-user', OWNER);
    expect(rawBalance.body[0]).toMatchObject({ quantity: '7', value: '70' });
    expect(finishedBalance.body[0]).toMatchObject({ quantity: '3', value: '30', unitCost: '10' });
    const movements = await withTenant(ORGANIZATION_ID, (tx) => tx.erpStockMovement.findMany({
      where: { legalEntityId: entityId, OR: [{ itemId: raw.id }, { itemId: finished.id }] }, select: { voucherId: true, movementType: true },
    }));
    expect(movements.filter((row) => row.movementType.startsWith('manufacturing_'))).toHaveLength(3);
    expect(new Set(movements.filter((row) => row.movementType.startsWith('manufacturing_')).map((row) => row.voucherId)).size).toBe(3);
  });

  it('requires accepted QA before completion submission and rechecks the locked source before posting', async () => {
    const run = suffix();
    const entityId = await companyId();
    const warehouse = await createWarehouse(entityId, `QA-${run}`, `warehouse-qa-${run}`);
    const finished = await createItem(entityId, {
      itemCode: `FG-QA-${run}`, name: `QA controlled output ${run}`, itemType: 'inventory', baseUom: 'EA',
      valuationMethod: 'moving_average', inventoryAccount: '1220', consumptionAccount: '5100',
      salesAccount: '4000', purchaseAccount: '5000',
    }, `item-qa-${run}`);

    const prepareApprovedAccountingDraft = async (qaStatus: 'pending' | 'accepted' | 'hold' | 'rejected', ordinal: string) => {
      const source = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/manufacturing-vouchers`)
        .set('x-dev-user', OWNER).set('Idempotency-Key', `qa-source-${ordinal}-${run}`).send({
          businessDate: '2026-08-14', voucherType: 'completion', batchNumber: `QA-${ordinal}-${run}`,
          laborLines: [{ description: 'Reviewed labour', quantity: '1', uom: 'HOUR', rate: '100' }],
          outputLines: [{ itemId: finished.id, description: 'Finished output', quantity: '1', uom: 'EA', warehouseCode: warehouse.code, batchNumber: `QA-${ordinal}-${run}` }],
          qaDisposition: { status: qaStatus, reference: `QA-${ordinal}`, notes: '' },
        });
      expect(source.status, JSON.stringify(source.body)).toBe(201);
      const submittedSource = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/manufacturing-vouchers/${source.body.id}/submit`)
        .set('x-dev-user', OWNER).set('Idempotency-Key', `qa-source-submit-${ordinal}-${run}`).send({ expectedRowVersion: 0 });
      if (qaStatus !== 'accepted') {
        expect(submittedSource.status).toBe(409);
        expect(submittedSource.body.error.code).toBe('qa_disposition_blocks_completion');
        const absentLink = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/posting-links/manufacturing_voucher/${source.body.id}`)
          .set('x-dev-user', OWNER);
        expect(absentLink.status).toBe(404);
        return { sourceId: source.body.id as string, accountingVoucherId: '' };
      }
      expect(submittedSource.status).toBe(200);
      const approvedSource = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/manufacturing-vouchers/${source.body.id}/approve`)
        .set('x-dev-user', CHECKER).set('Idempotency-Key', `qa-source-approve-${ordinal}-${run}`).send({ expectedRowVersion: 1 });
      expect(approvedSource.status, JSON.stringify(approvedSource.body)).toBe(200);
      const link = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/posting-links/manufacturing_voucher/${source.body.id}`)
        .set('x-dev-user', OWNER);
      expect(link.status).toBe(200);
      const submittedAccounting = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${link.body.voucherId}/submit`)
        .set('x-dev-user', CHECKER).set('Idempotency-Key', `qa-accounting-submit-${ordinal}-${run}`).send({ expectedVersion: 0 });
      expect(submittedAccounting.status).toBe(200);
      const approvedAccounting = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${link.body.voucherId}/approve`)
        .set('x-dev-user', OWNER).set('Idempotency-Key', `qa-accounting-approve-${ordinal}-${run}`).send({ expectedVersion: 1 });
      expect(approvedAccounting.status, JSON.stringify(approvedAccounting.body)).toBe(200);
      return { sourceId: source.body.id as string, accountingVoucherId: link.body.voucherId as string };
    };

    for (const status of ['pending', 'hold', 'rejected'] as const) {
      await prepareApprovedAccountingDraft(status, status);
    }

    const stale = await prepareApprovedAccountingDraft('accepted', 'stale');
    await expect(withTenant(ORGANIZATION_ID, (db) => db.erpManufacturingVoucher.update({
      where: { id: stale.sourceId },
      data: { qaDisposition: { status: 'hold', reference: 'QA-hold', notes: 'Attempted change after review' }, rowVersion: { increment: 1 } },
    }))).rejects.toThrow(/reviewed ERP manufacturing voucher content is immutable/);
    expect(await withTenant(ORGANIZATION_ID, (db) => db.erpStockMovement.count({ where: { voucherId: stale.accountingVoucherId } }))).toBe(0);
    await withTenant(ORGANIZATION_ID, (db) => db.erpManufacturingVoucher.update({
      where: { id: stale.sourceId },
      data: { status: 'posted', postedAt: new Date(), actualCost: { increment: 1 }, rowVersion: { increment: 1 } },
    }));
    const stalePost = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${stale.accountingVoucherId}/post`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `qa-accounting-post-stale-${run}`).send({ expectedVersion: 2 });
    expect(stalePost.status).toBe(409);
    expect(stalePost.body.error.code).toBe('manufacturing_source_snapshot_stale');
    expect(await withTenant(ORGANIZATION_ID, (db) => db.erpStockMovement.count({ where: { voucherId: stale.accountingVoucherId } }))).toBe(0);
  });

  it('consumes FIFO layers exactly and enforces discrete trace evidence before a draft is created', async () => {
    const run = suffix();
    const entityId = await companyId();
    const warehouse = await createWarehouse(entityId, `FIFO-${run}`, `warehouse-fifo-${run}`);
    const fifoItem = await createItem(entityId, {
      itemCode: `FIFO-${run}`, name: `FIFO resin ${run}`, itemType: 'inventory', baseUom: 'KG',
      valuationMethod: 'fifo', inventoryAccount: '1200', consumptionAccount: '5000',
      salesAccount: '4000', purchaseAccount: '5000',
    }, `item-fifo-${run}`);

    const receipt = async (quantity: string, unitCost: string, ordinal: string) => {
      const draft = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/stock-adjustments`)
        .set('x-dev-user', OWNER).set('Idempotency-Key', `fifo-receipt-${ordinal}-${run}`).send({
          businessDate: '2026-08-14', reference: `FIFO-R-${ordinal}-${run}`, reason: 'Approved FIFO receipt layer',
          lines: [{ itemId: fifoItem.id, warehouseId: warehouse.id, quantity, uom: 'KG', unitCost }],
        });
      expect(draft.status, JSON.stringify(draft.body)).toBe(201);
      await postAccountingVoucher(entityId, draft.body.voucherId, `fifo-receipt-voucher-${ordinal}-${run}`);
    };
    await receipt('5', '10', 'one');
    await receipt('5', '20', 'two');

    const issueDraft = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/stock-adjustments`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `fifo-issue-${run}`).send({
        businessDate: '2026-08-14', reference: `FIFO-I-${run}`, reason: 'Issue spans two FIFO layers',
        lines: [{ itemId: fifoItem.id, warehouseId: warehouse.id, quantity: '-6', uom: 'KG' }],
      });
    expect(issueDraft.status, JSON.stringify(issueDraft.body)).toBe(201);
    await postAccountingVoucher(entityId, issueDraft.body.voucherId, `fifo-issue-voucher-${run}`);

    const ledger = await request(app)
      .get(`/api/mesaerp/v1/entities/${entityId}/stock-ledger?itemId=${fifoItem.id}&warehouseId=${warehouse.id}`)
      .set('x-dev-user', OWNER);
    expect(ledger.status).toBe(200);
    const issueMovement = ledger.body.find((row: { quantity: string }) => row.quantity === '-6');
    expect(issueMovement).toMatchObject({ value: '-70', unitCost: '11.666667', valuationMethod: 'fifo' });
    expect(issueMovement.valuationLayer.fifoLayers).toHaveLength(2);
    const consumptions = await withTenant(ORGANIZATION_ID, (tx) => tx.erpValuationConsumption.findMany({
      where: { issueMovementId: issueMovement.id }, select: { quantity: true, value: true },
    }));
    expect(consumptions.map((row) => ({ quantity: row.quantity.toString(), value: row.value.toString() }))).toEqual(expect.arrayContaining([
      { quantity: '5', value: '50' },
      { quantity: '1', value: '20' },
    ]));
    const fifoBalance = await request(app)
      .get(`/api/mesaerp/v1/entities/${entityId}/stock-balances?itemId=${fifoItem.id}&warehouseId=${warehouse.id}`)
      .set('x-dev-user', OWNER);
    expect(fifoBalance.body[0]).toMatchObject({ quantity: '4', value: '80', unitCost: '20' });

    const serialItem = await createItem(entityId, {
      itemCode: `SER-${run}`, name: `Serial assembly ${run}`, itemType: 'inventory', baseUom: 'EA',
      valuationMethod: 'fifo', batchTracked: true, serialTracked: true, expiryTracked: true,
      inventoryAccount: '1220', consumptionAccount: '5100', salesAccount: '4000', purchaseAccount: '5000',
    }, `item-serial-${run}`);
    const traceAttempt = async (trace: Record<string, unknown>, expectedCode: string, ordinal: string) => {
      const response = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/stock-adjustments`)
        .set('x-dev-user', OWNER).set('Idempotency-Key', `trace-${ordinal}-${run}`).send({
          businessDate: '2026-08-14', reference: `TRACE-${ordinal}-${run}`, reason: 'Discrete assembly trace validation',
          lines: [{ itemId: serialItem.id, warehouseId: warehouse.id, quantity: '1', uom: 'EA', unitCost: '100', ...trace }],
        });
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe(expectedCode);
    };
    await traceAttempt({}, 'batch_number_required', 'batch');
    await traceAttempt({ batchNumber: `LOT-${run}`, expiryDate: '2027-08-14' }, 'serial_number_required', 'serial');
    await traceAttempt({ batchNumber: `LOT-${run}`, serialNumber: `SN-${run}` }, 'expiry_date_required', 'expiry');

    const validTrace = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/stock-adjustments`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `trace-valid-${run}`).send({
        businessDate: '2026-08-14', reference: `TRACE-OK-${run}`, reason: 'Valid discrete assembly receipt',
        lines: [{ itemId: serialItem.id, warehouseId: warehouse.id, quantity: '1', uom: 'EA', unitCost: '100', batchNumber: `LOT-${run}`, serialNumber: `SN-${run}`, expiryDate: '2027-08-14' }],
      });
    expect(validTrace.status, JSON.stringify(validTrace.body)).toBe(201);
    await postAccountingVoucher(entityId, validTrace.body.voucherId, `trace-valid-voucher-${run}`);
  });
});
