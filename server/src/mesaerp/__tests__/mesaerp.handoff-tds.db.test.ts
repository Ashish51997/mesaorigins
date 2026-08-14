import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalHash } from '../../lib/canonical';
import { tenantContext } from '../../lib/tenantContext';
import { PrismaMesaErpCommercialManufacturingService } from '../commercialManufacturingService';
import { PrismaMesaErpHandoffService } from '../handoffService';
import { PrismaMesaErpTdsService } from '../tdsService';

const enabled = process.env.RUN_MESAERP_DB_INTEGRATION === '1';
const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const run = `${process.pid}-${Date.now().toString(36)}`;
const orgId = `return-tds-org-${run}`;
const entityA = `return-tds-a-${run}`;
const entityB = `return-tds-b-${run}`;
const yearId = `return-tds-fy-${run}`;
const periodId = `return-tds-period-${run}`;
const makerId = `return-tds-maker-${run}`;
const checkerId = `return-tds-checker-${run}`;
const itemId = `return-tds-item-${run}`;
const warehouseId = `return-tds-wh-${run}`;
const customerId = `return-tds-customer-${run}`;
const vendorId = `return-tds-vendor-${run}`;
const supplierInvoiceId = `return-tds-invoice-${run}`;
const payableId = `return-tds-payable-${run}`;

type ReturnEventType =
  | 'mesaops.production-actuals.submitted.v1'
  | 'mesaops.qa-disposition.recorded.v1'
  | 'mesaops.physical-dispatch.completed.v1';

function asActor<T>(membershipId: string, work: () => Promise<T>) {
  return tenantContext.run({
    organizationId: orgId,
    membershipId,
    userId: `user-${membershipId}`,
    role: membershipId === makerId ? 'ERP Maker' : 'ERP Checker',
    email: `${membershipId}@example.test`,
  }, work);
}

async function createReturnEvent(input: {
  legalEntityId: string | null;
  eventType: ReturnEventType;
  aggregateType: string;
  aggregateId: string;
  snapshot: Record<string, unknown>;
  sourceLink?: Record<string, unknown> | null;
}) {
  const id = randomUUID();
  const occurredAt = new Date();
  const correlationId = randomUUID();
  const sourceSnapshotHash = canonicalHash(input.snapshot);
  const payload = {
    eventId: id,
    eventType: input.eventType,
    schemaVersion: 1,
    sourceService: 'mesaops',
    organizationId: orgId,
    legalEntityId: input.legalEntityId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    correlationId,
    occurredAt: occurredAt.toISOString(),
    sourceSnapshotHash,
    sourceLink: input.sourceLink ?? null,
    snapshot: input.snapshot,
  };
  return direct.integrationOutboxEvent.create({ data: {
    id,
    organizationId: orgId,
    legalEntityId: input.legalEntityId,
    serviceId: 'mesaops',
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    schemaVersion: 1,
    correlationId,
    payload: payload as Prisma.InputJsonValue,
    payloadHash: canonicalHash(payload),
    occurredAt,
  } });
}

describe.skipIf(!enabled)('MesaERP MesaOps-return and TDS database integration', () => {
  beforeAll(async () => {
    await direct.organization.create({ data: { id: orgId, name: 'Return and TDS DB Org', slug: orgId } });
    await direct.user.createMany({ data: [
      { id: `user-${makerId}`, email: `${makerId}@example.test`, name: 'Maker' },
      { id: `user-${checkerId}`, email: `${checkerId}@example.test`, name: 'Checker' },
    ] });
    await direct.membership.createMany({ data: [
      { id: makerId, organizationId: orgId, userId: `user-${makerId}`, employeeCode: `M-${run}`, department: 'ERP', role: 'ERP Maker' },
      { id: checkerId, organizationId: orgId, userId: `user-${checkerId}`, employeeCode: `C-${run}`, department: 'ERP', role: 'ERP Checker' },
    ] });
    await direct.legalEntity.createMany({ data: [
      { id: entityA, organizationId: orgId, code: `A-${run}`, legalName: 'Return Company A', createIdempotencyKey: `entity-a-${run}`, requestHash: 'a'.repeat(64) },
      { id: entityB, organizationId: orgId, code: `B-${run}`, legalName: 'Return Company B', createIdempotencyKey: `entity-b-${run}`, requestHash: 'b'.repeat(64) },
    ] });
    await direct.financialYear.create({ data: {
      id: yearId, organizationId: orgId, legalEntityId: entityA, code: `FY-${run}`,
      startsOn: new Date('2026-04-01T00:00:00.000Z'), endsOn: new Date('2027-03-31T00:00:00.000Z'),
    } });
    await direct.accountingPeriod.create({ data: {
      id: periodId, organizationId: orgId, legalEntityId: entityA, financialYearId: yearId,
      periodNumber: 5, name: 'August 2026', startsOn: new Date('2026-08-01T00:00:00.000Z'), endsOn: new Date('2026-08-31T00:00:00.000Z'),
    } });
    await direct.erpAccount.createMany({ data: [
      { id: `return-tds-exp-${run}`, organizationId: orgId, legalEntityId: entityA, code: `EXP-${run}`, name: 'Reviewed expense', accountType: 'expense' },
      { id: `return-tds-ap-${run}`, organizationId: orgId, legalEntityId: entityA, code: `AP-${run}`, name: 'Reviewed payable', accountType: 'liability' },
    ] });
    await direct.erpVendor.create({ data: {
      id: vendorId, organizationId: orgId, legalEntityId: entityA, vendorCode: `V-${run}`, legalName: 'TDS Vendor',
      lifecycleStatus: 'approved', createdBy: makerId, lastLifecycleActor: checkerId,
    } });
    await direct.erpCustomer.create({ data: {
      id: customerId, organizationId: orgId, legalEntityId: entityA, customerCode: `CUST-${run}`, legalName: 'Dispatch Customer',
    } });
    await direct.erpItem.create({ data: {
      id: itemId, organizationId: orgId, legalEntityId: entityA, itemCode: `FG-${run}`, name: 'Finished product', baseUom: 'KG',
      createIdempotencyKey: `item-${run}`, requestHash: 'c'.repeat(64),
    } });
    await direct.erpWarehouse.create({ data: {
      id: warehouseId, organizationId: orgId, legalEntityId: entityA, code: `WH-${run}`, name: 'Plant warehouse', kind: 'plant', plantCode: 'PLANT-01',
      createIdempotencyKey: `warehouse-${run}`, requestHash: 'd'.repeat(64),
    } });
    await direct.erpDocument.create({ data: {
      id: supplierInvoiceId, organizationId: orgId, legalEntityId: entityA, financialYearId: yearId,
      documentType: 'supplier_invoice', documentNumber: `SI-${run}`, documentDate: new Date('2026-08-14T00:00:00.000Z'),
      vendorId, grandTotal: '1000', baseCurrencyTotal: '1000', createdBy: makerId,
    } });
    await direct.erpVoucher.create({ data: {
      id: payableId, organizationId: orgId, legalEntityId: entityA, financialYearId: yearId, accountingPeriodId: periodId,
      voucherType: 'purchase', voucherNumber: `PUR-${run}`, businessDate: new Date('2026-08-14T00:00:00.000Z'),
      transactionDebit: '1000', transactionCredit: '1000', baseDebit: '1000', baseCredit: '1000',
      sourceDocumentId: supplierInvoiceId, sourceSnapshotHash: 'e'.repeat(64), createdBy: makerId,
    } });
    await direct.erpVoucherLine.createMany({ data: [
      {
        organizationId: orgId, legalEntityId: entityA, voucherId: payableId, lineNumber: 1,
        accountId: `return-tds-exp-${run}`, transactionDebit: '1000', baseDebit: '1000',
      },
      {
        organizationId: orgId, legalEntityId: entityA, voucherId: payableId, lineNumber: 2,
        accountId: `return-tds-ap-${run}`, transactionCredit: '1000', baseCredit: '1000',
      },
    ] });
    await direct.erpVoucher.update({ where: { id: payableId }, data: { status: 'submitted', submittedAt: new Date(), rowVersion: { increment: 1 } } });
    await direct.erpVoucher.update({ where: { id: payableId }, data: { status: 'approved', approvedAt: new Date(), approvedBy: checkerId, rowVersion: { increment: 1 } } });
    await direct.erpVoucher.update({ where: { id: payableId }, data: { status: 'posted', postedAt: new Date(), postedBy: checkerId, rowVersion: { increment: 1 } } });
  });

  afterAll(async () => {
    await direct.$disconnect();
  });

  it('keeps null-company events undiscoverable until a maker-checker route is approved', async () => {
    const handoff = new PrismaMesaErpHandoffService();
    const event = await createReturnEvent({
      legalEntityId: null,
      eventType: 'mesaops.production-actuals.submitted.v1',
      aggregateType: 'MachineLogbook',
      aggregateId: `local-logbook-${run}`,
      snapshot: {
        businessDate: '2026-08-14', operationalOrderId: `local-order-${run}`, plantCode: 'PLANT-01',
        productCode: `FG-${run}`, batchNumber: `LOCAL-${run}`, uom: 'KG', materialConsumption: [], materialReturns: [],
        outputs: [{ itemCode: `FG-${run}`, quantity: '1', uom: 'KG', outputType: 'finished_good', lots: [] }],
        scrap: [], byproducts: [], laborActuals: [], machineActuals: [], originLegalEntityId: null,
      },
    });
    const before = await asActor(makerId, () => handoff.listInbox(entityA));
    expect(before.available.some((candidate) => candidate.eventId === event.id)).toBe(false);

    const route = await asActor(makerId, () => handoff.createEventRoute(entityA, {
      sourceEventId: event.id, expectedPayloadHash: event.payloadHash,
      reason: 'Reviewed standalone trial production for Company A',
      routingEvidence: { approvedPlant: 'PLANT-01', reviewTicket: `ROUTE-${run}` },
    }, `route-create-${run}`));
    await expect(asActor(makerId, () => handoff.approveEventRoute(entityA, route.id, { expectedRowVersion: 0 }, `route-self-${run}`)))
      .rejects.toMatchObject({ code: 'maker_checker_required' });
    await asActor(checkerId, () => handoff.approveEventRoute(entityA, route.id, { expectedRowVersion: 0 }, `route-approve-${run}`));
    const after = await asActor(makerId, () => handoff.listInbox(entityA));
    expect(after.available.some((candidate) => candidate.eventId === event.id)).toBe(true);
    const received = await asActor(makerId, () => handoff.receive(entityA, event.id, {
      expectedPayloadHash: event.payloadHash,
      expectedEventType: 'mesaops.production-actuals.submitted.v1', expectedSchemaVersion: 1,
    }, `route-receive-${run}`));
    expect(received.state).toBe('received');
  });

  it('deduplicates linked events, rejects the wrong company and accepts QA before execution', async () => {
    const handoff = new PrismaMesaErpHandoffService();
    for (const [mappingType, sourceKey, targetId, targetValue] of [
      ['item', `FG-${run}`, itemId, ''],
      ['uom', 'KG', '', 'KG'],
      ['warehouse', 'PLANT-01', warehouseId, ''],
      ['customer', `OPS-CUST-${run}`, customerId, ''],
    ] as const) {
      const proposed = await asActor(makerId, () => handoff.createMapping(entityA, {
        mappingType, sourceKey, targetId, targetValue, sourceEvidence: { fixture: run },
      }, `mapping-${mappingType}-${run}`));
      expect(proposed).toMatchObject({ status: 'draft', active: false, proposedBy: makerId });
      await expect(asActor(makerId, () => handoff.approveMapping(entityA, proposed.id, {
        expectedRowVersion: 0, reason: 'Attempted self approval',
      }, `mapping-self-${mappingType}-${run}`))).rejects.toMatchObject({ code: 'maker_checker_required' });
      const approved = await asActor(checkerId, () => handoff.approveMapping(entityA, proposed.id, {
        expectedRowVersion: 0, reason: 'Verified same-company handoff master',
      }, `mapping-approve-${mappingType}-${run}`));
      expect(approved).toMatchObject({ status: 'approved', active: true, approvedBy: checkerId, rowVersion: 1 });
    }

    const operationalOrderId = `ops-order-${run}`;
    const qaEvent = await createReturnEvent({
      legalEntityId: entityA, eventType: 'mesaops.qa-disposition.recorded.v1', aggregateType: 'QualityInspection', aggregateId: `qa-${run}`,
      snapshot: {
        businessDate: '2026-08-14', inspectionId: `qa-${run}`, operationalOrderId, productionPlanId: `plan-${run}`,
        logbookId: `logbook-${run}`, plantCode: 'PLANT-01', productCode: `FG-${run}`, lotNumber: `LOT-${run}`,
        quantity: '10', uom: 'KG', disposition: 'accepted', tests: { visual: 'pass' }, originLegalEntityId: entityA,
      },
    });
    await expect(asActor(makerId, () => handoff.receive(entityB, qaEvent.id, {
      expectedPayloadHash: qaEvent.payloadHash, expectedEventType: 'mesaops.qa-disposition.recorded.v1', expectedSchemaVersion: 1,
    }, `qa-wrong-company-${run}`))).rejects.toMatchObject({ code: 'handoff_event_not_found' });
    const qaInbox = await asActor(makerId, () => handoff.receive(entityA, qaEvent.id, {
      expectedPayloadHash: qaEvent.payloadHash, expectedEventType: 'mesaops.qa-disposition.recorded.v1', expectedSchemaVersion: 1,
    }, `qa-receive-${run}`));
    const qaAccepted = await asActor(makerId, () => handoff.accept(entityA, qaInbox.id, { expectedRowVersion: 0, costRates: [], notes: 'QA arrived first' }, `qa-accept-${run}`));
    expect(qaAccepted.state).toBe('accepted');

    const executionEvent = await createReturnEvent({
      legalEntityId: entityA, eventType: 'mesaops.production-actuals.submitted.v1', aggregateType: 'MachineLogbook', aggregateId: `logbook-${run}`,
      snapshot: {
        businessDate: '2026-08-14', operationalOrderId, operationalOrderNumber: `OO-${run}`, productionPlanId: `plan-${run}`,
        logbookId: `logbook-${run}`, plantCode: 'PLANT-01', productCode: `FG-${run}`, batchNumber: `BATCH-${run}`, uom: 'KG',
        materialConsumption: [], materialReturns: [],
        outputs: [{ itemCode: `FG-${run}`, description: 'Finished product', quantity: '10', uom: 'KG', outputType: 'finished_good', lots: [{ lotNumber: `LOT-${run}`, quantity: '10', uom: 'KG' }] }],
        scrap: [], byproducts: [], laborActuals: [], machineActuals: [], packingEvidence: { packed: true }, originLegalEntityId: entityA,
      },
    });
    const executionInbox = await asActor(makerId, () => handoff.receive(entityA, executionEvent.id, {
      expectedPayloadHash: executionEvent.payloadHash, expectedEventType: 'mesaops.production-actuals.submitted.v1', expectedSchemaVersion: 1,
    }, `execution-receive-${run}`));
    const replay = await asActor(makerId, () => handoff.receive(entityA, executionEvent.id, {
      expectedPayloadHash: executionEvent.payloadHash, expectedEventType: 'mesaops.production-actuals.submitted.v1', expectedSchemaVersion: 1,
    }, `execution-receive-replay-${run}`));
    expect(replay.id).toBe(executionInbox.id);
    const accepted = await asActor(makerId, () => handoff.accept(entityA, executionInbox.id, { expectedRowVersion: 0, costRates: [], notes: 'Accept output evidence' }, `execution-accept-${run}`));
    expect(accepted.state).toBe('accepted');
    const acceptedReplay = await asActor(makerId, () => handoff.accept(entityA, executionInbox.id, { expectedRowVersion: 0, costRates: [], notes: 'Accept output evidence' }, `execution-accept-${run}`));
    expect(acceptedReplay.id).toBe(accepted.id);
    const vouchers = await direct.erpManufacturingVoucher.findMany({ where: { organizationId: orgId, originType: 'mesaops_snapshot', originMetadata: { path: ['sourceEventId'], equals: executionEvent.id } } });
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0].status).toBe('draft');
    expect(vouchers[0].qaDisposition).toMatchObject({ status: 'accepted' });

    // Execution may arrive before QA, but its completion must remain a draft.
    // Once immutable QA evidence arrives, the draft is refreshed and can enter
    // review; a pending-QA completion cannot be submitted and stranded.
    const lateOperationalOrderId = `ops-order-late-qa-${run}`;
    const lateLot = `LOT-LATE-${run}`;
    const lateExecutionEvent = await createReturnEvent({
      legalEntityId: entityA, eventType: 'mesaops.production-actuals.submitted.v1', aggregateType: 'MachineLogbook', aggregateId: `logbook-late-${run}`,
      snapshot: {
        businessDate: '2026-08-14', operationalOrderId: lateOperationalOrderId, operationalOrderNumber: `OO-LATE-${run}`, productionPlanId: `plan-late-${run}`,
        logbookId: `logbook-late-${run}`, plantCode: 'PLANT-01', productCode: `FG-${run}`, batchNumber: `BATCH-LATE-${run}`, uom: 'KG',
        materialConsumption: [], materialReturns: [],
        outputs: [{ itemCode: `FG-${run}`, description: 'Late QA finished product', quantity: '5', uom: 'KG', outputType: 'finished_good', lots: [{ lotNumber: lateLot, quantity: '5', uom: 'KG' }] }],
        scrap: [], byproducts: [], laborActuals: [], machineActuals: [], packingEvidence: { packed: true }, originLegalEntityId: entityA,
      },
    });
    const lateExecutionInbox = await asActor(makerId, () => handoff.receive(entityA, lateExecutionEvent.id, {
      expectedPayloadHash: lateExecutionEvent.payloadHash, expectedEventType: 'mesaops.production-actuals.submitted.v1', expectedSchemaVersion: 1,
    }, `execution-late-receive-${run}`));
    await asActor(makerId, () => handoff.accept(entityA, lateExecutionInbox.id, { expectedRowVersion: 0, costRates: [], notes: 'Execution arrived before QA' }, `execution-late-accept-${run}`));
    const pendingQaVoucher = await direct.erpManufacturingVoucher.findFirstOrThrow({
      where: { organizationId: orgId, createIdempotencyKey: `handoff:${lateExecutionEvent.id}:completion` },
    });
    expect(pendingQaVoucher.qaDisposition).toMatchObject({ status: 'pending' });
    const manufacturing = new PrismaMesaErpCommercialManufacturingService();
    await expect(asActor(makerId, () => manufacturing.transitionManufacturingVoucher(
      entityA, pendingQaVoucher.id, 'submit', { expectedRowVersion: 0 }, `late-qa-submit-blocked-${run}`,
    ))).rejects.toMatchObject({ code: 'qa_disposition_blocks_completion' });

    const lateQaEvent = await createReturnEvent({
      legalEntityId: entityA, eventType: 'mesaops.qa-disposition.recorded.v1', aggregateType: 'QualityInspection', aggregateId: `qa-late-${run}`,
      snapshot: {
        businessDate: '2026-08-14', inspectionId: `qa-late-${run}`, operationalOrderId: lateOperationalOrderId, productionPlanId: `plan-late-${run}`,
        logbookId: `logbook-late-${run}`, plantCode: 'PLANT-01', productCode: `FG-${run}`, lotNumber: lateLot,
        quantity: '5', uom: 'KG', disposition: 'accepted', tests: { visual: 'pass' }, originLegalEntityId: entityA,
      },
    });
    const lateQaInbox = await asActor(makerId, () => handoff.receive(entityA, lateQaEvent.id, {
      expectedPayloadHash: lateQaEvent.payloadHash, expectedEventType: 'mesaops.qa-disposition.recorded.v1', expectedSchemaVersion: 1,
    }, `qa-late-receive-${run}`));
    await asActor(makerId, () => handoff.accept(entityA, lateQaInbox.id, { expectedRowVersion: 0, costRates: [], notes: 'Accept late QA' }, `qa-late-accept-${run}`));
    const refreshed = await direct.erpManufacturingVoucher.findUniqueOrThrow({ where: { id: pendingQaVoucher.id } });
    expect(refreshed).toMatchObject({ status: 'draft', rowVersion: 1 });
    expect(refreshed.qaDisposition).toMatchObject({ status: 'accepted' });
    const submittedAfterQa = await asActor(makerId, () => manufacturing.transitionManufacturingVoucher(
      entityA, refreshed.id, 'submit', { expectedRowVersion: 1 }, `late-qa-submit-${run}`,
    ));
    expect(submittedAfterQa.status).toBe('submitted');

    const duplicateAggregate = await createReturnEvent({
      legalEntityId: entityA, eventType: 'mesaops.production-actuals.submitted.v1', aggregateType: 'MachineLogbook', aggregateId: `logbook-${run}`,
      snapshot: { ...(executionEvent.payload as Record<string, unknown>), businessDate: '2026-08-14' },
    });
    const conflict = await asActor(makerId, () => handoff.receive(entityA, duplicateAggregate.id, {
      expectedPayloadHash: duplicateAggregate.payloadHash, expectedEventType: 'mesaops.production-actuals.submitted.v1', expectedSchemaVersion: 1,
    }, `execution-conflict-${run}`));
    expect(conflict.state).toBe('conflict');
  });

  it('records dispatch once and returns an explicit financial-posting exception without duplicate COGS', async () => {
    const handoff = new PrismaMesaErpHandoffService();
    const movementCountBefore = await direct.erpStockMovement.count({ where: { organizationId: orgId, legalEntityId: entityA } });
    const event = await createReturnEvent({
      legalEntityId: entityA, eventType: 'mesaops.physical-dispatch.completed.v1', aggregateType: 'DispatchRecord', aggregateId: `dispatch-${run}`,
      snapshot: {
        businessDate: '2026-08-14', dispatchId: `dispatch-${run}`, operationalOrderId: `ops-order-${run}`,
        plantCode: 'PLANT-01', warehouseSource: 'PLANT-01', productCode: `FG-${run}`, customerReference: `OPS-CUST-${run}`,
        quantity: '10', uom: 'KG', invoiceReference: '', gatePassNumber: `GP-${run}`, vehicleNumber: 'KA01AB1234',
        statutoryRequired: false, statutoryEvidenceHash: '', originLegalEntityId: entityA,
      },
    });
    const inbox = await asActor(makerId, () => handoff.receive(entityA, event.id, {
      expectedPayloadHash: event.payloadHash, expectedEventType: 'mesaops.physical-dispatch.completed.v1', expectedSchemaVersion: 1,
    }, `dispatch-receive-${run}`));
    const accepted = await asActor(makerId, () => handoff.accept(entityA, inbox.id, { expectedRowVersion: 0, costRates: [], notes: '' }, `dispatch-accept-${run}`));
    expect(accepted.createdArtifacts).toMatchObject({
      financialPostingState: 'invoice_match_required', stockAndCogsPolicy: 'explicit_financial_posting_required',
      stockMovementCreatedByHandoff: false, cogsCreatedByHandoff: false,
    });
    await asActor(makerId, () => handoff.accept(entityA, inbox.id, { expectedRowVersion: 0, costRates: [], notes: '' }, `dispatch-accept-${run}`));
    expect(await direct.erpPlantDispatchEvidence.count({ where: { organizationId: orgId, sourceDispatchId: `dispatch-${run}` } })).toBe(1);
    expect(await direct.erpStockMovement.count({ where: { organizationId: orgId, legalEntityId: entityA } })).toBe(movementCountBefore);
  });

  it('rolls back dispatch evidence when its exact invoice cannot create a financial posting draft', async () => {
    const invoiceId = `return-tds-sales-invoice-${run}`;
    const operationalOrderId = `ops-posting-failure-${run}`;
    await direct.erpDocument.create({ data: {
      id: invoiceId, organizationId: orgId, legalEntityId: entityA, financialYearId: yearId,
      documentType: 'sales_invoice', documentNumber: `SINV-UNMAPPED-${run}`,
      documentDate: new Date('2026-08-14T00:00:00.000Z'),
      customerId, subtotal: '100', grandTotal: '100', baseCurrencyTotal: '100',
      originMetadata: { operationalOrderId }, createdBy: makerId,
    } });
    await direct.erpDocumentLine.create({ data: {
      organizationId: orgId, legalEntityId: entityA, documentId: invoiceId, lineNumber: 1,
      itemId, description: 'Finished product', quantity: '10', uom: 'KG', unitPrice: '10',
      taxableAmount: '100', lineTotal: '100', warehouseCode: `WH-${run}`,
    } });
    await direct.erpDocument.update({ where: { id: invoiceId }, data: {
      status: 'approved', approvalState: 'approved', submittedAt: new Date(), approvedBy: checkerId,
      approvedAt: new Date(), rowVersion: { increment: 1 },
    } });
    const handoff = new PrismaMesaErpHandoffService();
    const event = await createReturnEvent({
      legalEntityId: entityA, eventType: 'mesaops.physical-dispatch.completed.v1', aggregateType: 'DispatchRecord', aggregateId: `dispatch-unmapped-${run}`,
      snapshot: {
        businessDate: '2026-08-14', dispatchId: `dispatch-unmapped-${run}`, operationalOrderId,
        plantCode: 'PLANT-01', warehouseSource: 'PLANT-01', productCode: `FG-${run}`, customerReference: `OPS-CUST-${run}`,
        quantity: '10', uom: 'KG', invoiceReference: `SINV-UNMAPPED-${run}`, gatePassNumber: `GP-U-${run}`,
        vehicleNumber: 'KA01AB9999', statutoryRequired: false, statutoryEvidenceHash: '', originLegalEntityId: entityA,
      },
    });
    const inbox = await asActor(makerId, () => handoff.receive(entityA, event.id, {
      expectedPayloadHash: event.payloadHash, expectedEventType: 'mesaops.physical-dispatch.completed.v1', expectedSchemaVersion: 1,
    }, `dispatch-unmapped-receive-${run}`));
    const retry = await asActor(makerId, () => handoff.accept(entityA, inbox.id, {
      expectedRowVersion: 0, costRates: [], notes: '',
    }, `dispatch-unmapped-accept-${run}`));
    expect(retry).toMatchObject({ state: 'retry', exceptionCode: 'sales_mapping_missing' });
    expect(await direct.erpPlantDispatchEvidence.count({ where: { handoffInboxEventId: inbox.id } })).toBe(0);
    expect(await direct.erpPostingLink.count({ where: { sourceType: 'sales_invoice', sourceId: invoiceId } })).toBe(0);
  });

  it('serializes exact-invoice dispatch acceptance so concurrent events cannot exceed its line quantity', async () => {
    const invoiceId = `return-tds-cap-invoice-${run}`;
    const operationalOrderId = `ops-cap-${run}`;
    await direct.erpDocument.create({ data: {
      id: invoiceId, organizationId: orgId, legalEntityId: entityA, financialYearId: yearId,
      documentType: 'sales_invoice', documentNumber: `SINV-CAP-${run}`,
      documentDate: new Date('2026-08-14T00:00:00.000Z'), customerId,
      subtotal: '100', grandTotal: '100', baseCurrencyTotal: '100',
      originMetadata: { operationalOrderId }, createdBy: makerId,
    } });
    await direct.erpDocumentLine.create({ data: {
      organizationId: orgId, legalEntityId: entityA, documentId: invoiceId, lineNumber: 1,
      itemId, description: 'Finished product', quantity: '10', uom: 'KG', unitPrice: '10',
      taxableAmount: '100', lineTotal: '100', warehouseCode: `WH-${run}`,
    } });
    const handoff = new PrismaMesaErpHandoffService();
    const events = await Promise.all(['a', 'b'].map((suffix) => createReturnEvent({
      legalEntityId: entityA, eventType: 'mesaops.physical-dispatch.completed.v1', aggregateType: 'DispatchRecord', aggregateId: `dispatch-cap-${suffix}-${run}`,
      snapshot: {
        businessDate: '2026-08-14', dispatchId: `dispatch-cap-${suffix}-${run}`, operationalOrderId,
        plantCode: 'PLANT-01', warehouseSource: 'PLANT-01', productCode: `FG-${run}`, customerReference: `OPS-CUST-${run}`,
        quantity: '6', uom: 'KG', invoiceReference: `SINV-CAP-${run}`, gatePassNumber: `GP-CAP-${suffix}-${run}`,
        vehicleNumber: `KA01CAP${suffix}`, statutoryRequired: false, statutoryEvidenceHash: '', originLegalEntityId: entityA,
      },
    })));
    const inboxes = await Promise.all(events.map((event, index) => asActor(makerId, () => handoff.receive(entityA, event.id, {
      expectedPayloadHash: event.payloadHash, expectedEventType: 'mesaops.physical-dispatch.completed.v1', expectedSchemaVersion: 1,
    }, `dispatch-cap-receive-${index}-${run}`))));
    const results = await Promise.all(inboxes.map((inbox, index) => asActor(makerId, () => handoff.accept(entityA, inbox.id, {
      expectedRowVersion: 0, costRates: [], notes: '',
    }, `dispatch-cap-accept-${index}-${run}`))));
    expect(results.map((row) => row.state).sort()).toEqual(['accepted', 'retry']);
    expect(results.find((row) => row.state === 'retry')).toMatchObject({ exceptionCode: 'handoff_dispatch_invoice_quantity_exceeded' });
    expect(await direct.erpPlantDispatchEvidence.count({ where: { salesInvoiceId: invoiceId } })).toBe(1);
  });

  it('rejects a production-demand link whose immutable output UOM does not match the demand', async () => {
    const demandId = `return-tds-demand-${run}`;
    const sourceSnapshotHash = 'f'.repeat(64);
    await direct.erpProductionDemand.create({ data: {
      id: demandId, organizationId: orgId, legalEntityId: entityA, financialYearId: yearId,
      demandNumber: `PD-MISMATCH-${run}`, demandType: 'internal', itemId, quantity: '10', uom: 'PCS',
      originMetadata: { mesaerpControl: { makerMembershipId: makerId } }, sourceSnapshotHash,
    } });
    await direct.erpProductionDemand.update({ where: { id: demandId }, data: { status: 'approved', rowVersion: { increment: 1 } } });
    await direct.erpProductionDemand.update({ where: { id: demandId }, data: { status: 'released', releasedAt: new Date(), rowVersion: { increment: 1 } } });
    const handoff = new PrismaMesaErpHandoffService();
    const event = await createReturnEvent({
      legalEntityId: entityA, eventType: 'mesaops.production-actuals.submitted.v1', aggregateType: 'MachineLogbook', aggregateId: `logbook-mismatch-${run}`,
      sourceLink: {
        sourceLinkId: `link-${run}`, sourceService: 'mesaerp', sourceType: 'ProductionDemand', sourceId: demandId,
        sourceSnapshotHash, correlationId: `correlation-${run}`,
      },
      snapshot: {
        businessDate: '2026-08-14', operationalOrderId: `ops-mismatch-${run}`, plantCode: 'PLANT-01',
        productCode: `FG-${run}`, batchNumber: `MISMATCH-${run}`, uom: 'KG', materialConsumption: [], materialReturns: [],
        outputs: [{ itemCode: `FG-${run}`, quantity: '10', uom: 'KG', outputType: 'finished_good', lots: [] }],
        scrap: [], byproducts: [], laborActuals: [], machineActuals: [], originLegalEntityId: entityA,
      },
    });
    const inbox = await asActor(makerId, () => handoff.receive(entityA, event.id, {
      expectedPayloadHash: event.payloadHash, expectedEventType: 'mesaops.production-actuals.submitted.v1', expectedSchemaVersion: 1,
    }, `execution-mismatch-receive-${run}`));
    const retry = await asActor(makerId, () => handoff.accept(entityA, inbox.id, {
      expectedRowVersion: 0, costRates: [], notes: '',
    }, `execution-mismatch-accept-${run}`));
    expect(retry).toMatchObject({ state: 'retry', exceptionCode: 'handoff_production_demand_output_mismatch' });
    expect(await direct.erpManufacturingVoucher.count({ where: { productionDemandId: demandId } })).toBe(0);
  });

  it('requires maker-checker again for a mapping update or deactivation', async () => {
    const handoff = new PrismaMesaErpHandoffService();
    const current = await direct.erpHandoffMapping.findFirstOrThrow({
      where: { organizationId: orgId, legalEntityId: entityA, mappingType: 'customer', sourceKey: `OPS-CUST-${run}`.toUpperCase() },
    });
    const proposed = await asActor(makerId, () => handoff.updateMapping(entityA, current.id, {
      expectedRowVersion: current.rowVersion, active: false, sourceEvidence: { fixture: run, reason: 'Retired source customer' },
    }, `mapping-deactivate-${run}`));
    expect(proposed).toMatchObject({ status: 'draft', active: false, requestedActive: false, proposedBy: makerId });
    await expect(asActor(makerId, () => handoff.approveMapping(entityA, current.id, {
      expectedRowVersion: proposed.rowVersion, reason: 'Attempted self approval',
    }, `mapping-deactivate-self-${run}`))).rejects.toMatchObject({ code: 'maker_checker_required' });
    const approved = await asActor(checkerId, () => handoff.approveMapping(entityA, current.id, {
      expectedRowVersion: proposed.rowVersion, reason: 'Source customer retirement verified',
    }, `mapping-deactivate-approve-${run}`));
    expect(approved).toMatchObject({ status: 'approved', active: false, requestedActive: false, approvedBy: checkerId });
    await expect(direct.erpHandoffMapping.update({
      where: { id: current.id }, data: { active: true, rowVersion: { increment: 1 } },
    })).rejects.toThrow(/approved handoff mappings may only move to an inactive draft proposal/);
  });

  it('reserves payable basis and recomputes final aggregate threshold evidence at submit', async () => {
    const tds = new PrismaMesaErpTdsService();
    const section = await asActor(makerId, () => tds.createSection(entityA, {
      code: `194C-${run}`, name: 'Contract payments', natureOfPayment: 'Contractor payment',
      sourceReference: 'CA-reviewed fixture', sourceEvidence: { effectiveLawVersion: 'fixture-2026' },
    }, `tds-section-${run}`));
    await expect(asActor(makerId, () => tds.approveSection(entityA, section.id, { expectedRowVersion: 0 }, `tds-section-self-${run}`)))
      .rejects.toMatchObject({ code: 'maker_checker_required' });
    await asActor(checkerId, () => tds.approveSection(entityA, section.id, { expectedRowVersion: 0 }, `tds-section-approve-${run}`));
    const rate = await asActor(makerId, () => tds.createRate(entityA, section.id, {
      effectiveFrom: '2026-04-01', effectiveTo: '2027-03-31', standardRate: '10', noPanRate: '20',
      singlePaymentThreshold: '0', aggregateThreshold: '750', thresholdApplication: 'full_current',
      sourceReference: 'CA-reviewed rate fixture', sourceEvidence: { effectiveLawVersion: 'fixture-2026' },
    }, `tds-rate-${run}`));
    await asActor(checkerId, () => tds.approveRate(entityA, rate.id, { expectedRowVersion: 0 }, `tds-rate-approve-${run}`));
    const classification = await asActor(makerId, () => tds.createVendorClassification(entityA, vendorId, {
      sectionId: section.id, effectiveFrom: '2026-04-01', effectiveTo: '2027-03-31', panStatus: 'valid',
      certificateReference: `PAN-${run}`, evidence: { reviewed: true },
    }, `tds-classification-${run}`));
    await asActor(checkerId, () => tds.approveVendorClassification(entityA, classification.id, { expectedRowVersion: 0 }, `tds-classification-approve-${run}`));

    const first = await asActor(makerId, () => tds.createDeduction(entityA, {
      vendorId, payableVoucherId: payableId, businessDate: '2026-08-14', grossAmount: '600', notes: 'Reviewed first partial basis',
    }, `tds-deduction-first-${run}`));
    const second = await asActor(makerId, () => tds.createDeduction(entityA, {
      vendorId, payableVoucherId: payableId, businessDate: '2026-08-14', grossAmount: '400', notes: 'Reviewed remaining basis',
    }, `tds-deduction-second-${run}`));
    await expect(asActor(makerId, () => tds.createDeduction(entityA, {
      vendorId, payableVoucherId: payableId, businessDate: '2026-08-14', grossAmount: '1', notes: 'Must exceed the payable reservation',
    }, `tds-deduction-excess-${run}`))).rejects.toMatchObject({ code: 'tds_payable_basis_exhausted' });

    const submittedFirst = await asActor(makerId, () => tds.transitionDeduction(entityA, first.id, 'submit', { expectedRowVersion: 0 }, `tds-submit-first-${run}`));
    const submittedSecond = await asActor(makerId, () => tds.transitionDeduction(entityA, second.id, 'submit', { expectedRowVersion: 0 }, `tds-submit-second-${run}`));
    expect(submittedFirst).toMatchObject({ priorAggregateBase: '0', taxableBase: '0', deductionAmount: '0', status: 'submitted' });
    expect(submittedSecond).toMatchObject({ priorAggregateBase: '600', taxableBase: '400', deductionAmount: '40', status: 'submitted' });
    expect(submittedSecond.calculationSnapshot).toMatchObject({
      calculationStage: 'submitted_final', grossBasisSource: 'user_entered_reviewed_basis', basisReviewedBy: makerId,
    });
    await expect(asActor(makerId, () => tds.transitionDeduction(entityA, first.id, 'approve', { expectedRowVersion: 1 }, `tds-approve-self-${run}`)))
      .rejects.toMatchObject({ code: 'maker_checker_required' });
    const approved = await asActor(checkerId, () => tds.transitionDeduction(entityA, first.id, 'approve', { expectedRowVersion: 1 }, `tds-approve-${run}`));
    expect(approved.status).toBe('approved');
    const report = await asActor(checkerId, () => tds.report(entityA, { status: 'submitted' }));
    expect(report.filingStatus).toBe('not_supported');
    expect(report.rows.some((row) => row.id === second.id)).toBe(true);
  });
});
