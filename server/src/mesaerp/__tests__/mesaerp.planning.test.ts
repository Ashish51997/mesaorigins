import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { basePrisma, withTenant } from '../../db';

const app = buildApp();
const OWNER = 'vikram.malhotra@masspolymer.in';
const CHECKER = 'deepak.bansal@masspolymer.in';
const ORGANIZATION_ID = 'org-demo';
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const setupTag = suffix();
const DENIED = `mrp-denied-${setupTag}@example.test`;
let entitlementBefore: { status: string } | null = null;
let testRoleId = '';
let deniedUserId = '';

beforeAll(async () => {
  await withTenant(ORGANIZATION_ID, async (tx) => {
    entitlementBefore = await tx.organizationService.findUnique({
      where: { organizationId_serviceId: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp' } }, select: { status: true },
    });
    await tx.organizationService.upsert({
      where: { organizationId_serviceId: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp' } },
      create: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp', status: 'active' }, update: { status: 'active' },
    });
    const entity = await tx.legalEntity.findFirstOrThrow({ where: { organizationId: ORGANIZATION_ID, status: 'active' }, orderBy: { code: 'asc' } });
    const memberships = await tx.membership.findMany({
      where: { organizationId: ORGANIZATION_ID, user: { email: { in: [OWNER, CHECKER] } } },
      include: { user: true },
    });
    if (memberships.length !== 2) throw new Error('MRP acceptance requires the seeded maker and checker memberships.');
    const permission = await tx.permission.findUniqueOrThrow({ where: { id: 'mesaerp.mrp.manage' } });
    const role = await tx.role.create({ data: {
      organizationId: ORGANIZATION_ID, erpLegalEntityId: entity.id, name: `MRP acceptance ${setupTag}`, screens: [],
    } });
    testRoleId = role.id;
    await tx.rolePermission.create({ data: {
      organizationId: ORGANIZATION_ID, roleId: role.id, permissionId: permission.id, effect: 'allow',
    } });
    await tx.roleAssignment.createMany({ data: memberships.map((membership) => ({
      organizationId: ORGANIZATION_ID, membershipId: membership.id, roleId: role.id,
      serviceId: 'mesaerp', legalEntityId: entity.id, status: 'active',
    })) });
    const deniedUser = await tx.user.create({ data: { email: DENIED, name: 'MRP default-deny acceptance user' } });
    deniedUserId = deniedUser.id;
    await tx.membership.create({ data: {
      organizationId: ORGANIZATION_ID, userId: deniedUser.id, employeeCode: `MRP-DENY-${setupTag}`,
      department: 'Quality assurance', role: 'Acceptance test', status: 'active',
    } });
  });
});

afterAll(async () => {
  await withTenant(ORGANIZATION_ID, async (tx) => {
    if (testRoleId) {
      await tx.roleAssignment.deleteMany({ where: { organizationId: ORGANIZATION_ID, roleId: testRoleId } });
      await tx.rolePermission.deleteMany({ where: { organizationId: ORGANIZATION_ID, roleId: testRoleId } });
      await tx.role.deleteMany({ where: { id: testRoleId, organizationId: ORGANIZATION_ID } });
    }
    if (deniedUserId) {
      await tx.membership.deleteMany({ where: { organizationId: ORGANIZATION_ID, userId: deniedUserId } });
      await tx.user.deleteMany({ where: { id: deniedUserId } });
    }
    if (entitlementBefore) {
      await tx.organizationService.update({
        where: { organizationId_serviceId: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp' } }, data: { status: entitlementBefore.status },
      });
    } else {
      await tx.organizationService.deleteMany({ where: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp' } });
    }
  });
});

async function companyId() {
  const response = await request(app).get('/api/mesaerp/v1/entities').set('x-dev-user', OWNER);
  expect(response.status).toBe(200);
  const company = (response.body as Array<{ id: string }>).find((candidate) => candidate.id === 'entity-demo');
  expect(company).toBeTruthy();
  return company!.id;
}

async function context(entityId: string) {
  return withTenant(ORGANIZATION_ID, async (tx) => {
    const financialYear = await tx.financialYear.findFirstOrThrow({ where: { legalEntityId: entityId, startsOn: { lte: new Date('2026-08-14') }, endsOn: { gte: new Date('2026-08-14') } } });
    return { financialYearId: financialYear.id };
  });
}

async function createWarehouse(entityId: string, code: string, key: string) {
  const response = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/warehouses`)
    .set('x-dev-user', OWNER).set('Idempotency-Key', key)
    .send({ code, name: `Planning warehouse ${code}`, kind: 'warehouse', plantCode: 'PRIMARY' });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as { id: string; code: string };
}

async function createItem(entityId: string, input: Record<string, unknown>, key: string) {
  const response = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/items`)
    .set('x-dev-user', OWNER).set('Idempotency-Key', key).send({
      itemType: 'inventory', gstRate: '18', valuationMethod: 'moving_average',
      inventoryAccount: '1200', consumptionAccount: '5000', purchaseAccount: '5000', salesAccount: '4000',
      ...input,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as { id: string; itemCode: string; rowVersion: number; baseUom: string };
}

async function setPolicy(entityId: string, item: { id: string; rowVersion: number }, warehouseId: string, input: Partial<Record<string, unknown>> = {}) {
  const run = suffix();
  const response = await request(app).patch(`/api/mesaerp/v1/entities/${entityId}/items/${item.id}/planning-policy`)
    .set('x-dev-user', OWNER).set('Idempotency-Key', `policy-${run}`).send({
      expectedRowVersion: item.rowVersion, leadTimeDays: 0, safetyStock: '0', minimumStock: '0', lotSizing: 'lot_for_lot',
      fixedLotSize: '0', minimumOrderQuantity: '0', orderMultiple: '0', supplyPolicy: 'buy', planningWarehouseId: warehouseId,
      ...input,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  item.rowVersion = response.body.rowVersion;
  return response.body;
}

async function approveForecast(entityId: string, itemId: string, warehouseId: string, forecastDate: string, quantity: string, run: string) {
  const created = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/demand-forecasts`)
    .set('x-dev-user', OWNER).set('Idempotency-Key', `forecast-create-${run}`)
    .send({ itemId, warehouseId, forecastDate, quantity, uom: 'KG', notes: 'MRP acceptance forecast' });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const submitted = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/demand-forecasts/${created.body.id}/submit`)
    .set('x-dev-user', OWNER).set('Idempotency-Key', `forecast-submit-${run}`).send({ expectedRowVersion: 0 });
  expect(submitted.status).toBe(200);
  const approved = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/demand-forecasts/${created.body.id}/approve`)
    .set('x-dev-user', CHECKER).set('Idempotency-Key', `forecast-approve-${run}`).send({ expectedRowVersion: 1 });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return approved.body;
}

async function approveBom(entityId: string, input: Record<string, unknown>, run: string) {
  const created = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/planning-boms`)
    .set('x-dev-user', OWNER).set('Idempotency-Key', `bom-create-${run}`).send(input);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const revision = created.body.revisions[0];
  const submitted = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/planning-boms/${created.body.id}/revisions/${revision.revisionId}/submit`)
    .set('x-dev-user', OWNER).set('Idempotency-Key', `bom-submit-${run}`).send({ expectedRowVersion: 0 });
  expect(submitted.status).toBe(200);
  const approved = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/planning-boms/${created.body.id}/revisions/${revision.revisionId}/approve`)
    .set('x-dev-user', CHECKER).set('Idempotency-Key', `bom-approve-${run}`).send({ expectedRowVersion: 1 });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return { bom: created.body, revision: approved.body };
}

async function calculate(entityId: string, body: Record<string, unknown>, key: string) {
  const response = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/mrp-runs`)
    .set('x-dev-user', OWNER).set('Idempotency-Key', key).send({
      asOfDate: '2026-08-14', horizonEnd: '2026-08-31', includeSalesOrders: true,
      includeForecasts: true, includeProductionDemands: true, forecastTreatment: 'additive', ...body,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}

describe('MesaERP planning, ATP and MRP', () => {
  it('explodes a multi-level polymer formula, releases only ERP drafts, detects staleness and serializes suggestion approval', async () => {
    const run = suffix();
    const entityId = await companyId();
    const warehouse = await createWarehouse(entityId, `MRP-${run}`, `warehouse-${run}`);
    const raw = await createItem(entityId, { itemCode: `RAW-${run}`, name: 'Polymer raw material', baseUom: 'KG' }, `item-raw-${run}`);
    const compound = await createItem(entityId, { itemCode: `CMP-${run}`, name: 'Polymer compound', baseUom: 'KG' }, `item-compound-${run}`);
    const finished = await createItem(entityId, { itemCode: `FG-${run}`, name: 'Finished polymer kit', baseUom: 'KG' }, `item-finished-${run}`);
    await setPolicy(entityId, raw, warehouse.id, { supplyPolicy: 'buy', leadTimeDays: 1 });
    await setPolicy(entityId, compound, warehouse.id, { supplyPolicy: 'make', leadTimeDays: 1 });
    await setPolicy(entityId, finished, warehouse.id, { supplyPolicy: 'make', leadTimeDays: 2 });

    await approveBom(entityId, {
      bomCode: `CMP-BOM-${run}`, parentItemId: compound.id, bomType: 'formula', description: 'Yield-adjusted polymer formula',
      revision: { revisionCode: 'R1', effectiveFrom: '2026-08-01', outputQuantity: '1', outputUom: 'KG', yieldPercentage: '90', formulaParameters: { process: 'compounding' },
        components: [{ componentItemId: raw.id, issueWarehouseId: warehouse.id, quantity: '0.9', uom: 'KG', scrapPercentage: '5', componentType: 'material', phase: 'mixing' }] },
    }, `compound-${run}`);
    const finishedBom = await approveBom(entityId, {
      bomCode: `FG-BOM-${run}`, parentItemId: finished.id, bomType: 'discrete', description: 'Finished kit structure',
      revision: { revisionCode: 'R1', effectiveFrom: '2026-08-01', outputQuantity: '1', outputUom: 'KG', yieldPercentage: '100',
        components: [{ componentItemId: compound.id, issueWarehouseId: warehouse.id, quantity: '2', uom: 'KG', scrapPercentage: '0', componentType: 'material', phase: 'assembly' }] },
    }, `finished-${run}`);
    expect(finishedBom.revision.sourceSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    const immutableRevision = await request(app).patch(
      `/api/mesaerp/v1/entities/${entityId}/planning-boms/${finishedBom.bom.id}/revisions/${finishedBom.revision.revisionId}`,
    ).set('x-dev-user', OWNER).set('Idempotency-Key', `bom-immutable-${run}`)
      .send({ expectedRowVersion: 2, notes: 'Approved evidence cannot be edited' });
    expect(immutableRevision.status).toBe(409);
    expect(immutableRevision.body.error.code).toBe('bom_revision_immutable');
    await approveForecast(entityId, finished.id, warehouse.id, '2026-08-20', '10', `polymer-${run}`);

    const denied = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/mrp-runs`).set('x-dev-user', DENIED);
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toContain('mesaerp.mrp.manage');

    const key = `mrp-polymer-${run}`;
    const mrp = await calculate(entityId, { warehouseIds: [warehouse.id] }, key);
    expect(await basePrisma.erpMrpRun.findUnique({ where: { id: mrp.id } })).toBeNull();
    expect(mrp.demandBasis).toEqual({ forecastTreatment: 'additive', linkedProductionDemandDeduplication: 'sales_order_line' });
    const byItem = new Map(mrp.suggestions.map((row: { itemId: string; quantity: string; suggestionType: string }) => [row.itemId, row]));
    expect(byItem.get(finished.id)).toMatchObject({ quantity: '10', suggestionType: 'make' });
    expect(byItem.get(compound.id)).toMatchObject({ quantity: '20', suggestionType: 'make' });
    expect(byItem.get(raw.id)).toMatchObject({ quantity: '21', suggestionType: 'purchase' });

    const replay = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/mrp-runs`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', key).send({
        asOfDate: '2026-08-14', horizonEnd: '2026-08-31', warehouseIds: [warehouse.id], includeSalesOrders: true,
        includeForecasts: true, includeProductionDemands: true, forecastTreatment: 'additive',
    });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(mrp.id);
    const conflictingReplay = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/mrp-runs`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', key).send({
        asOfDate: '2026-08-14', horizonEnd: '2026-08-30', warehouseIds: [warehouse.id], includeSalesOrders: true,
        includeForecasts: true, includeProductionDemands: true, forecastTreatment: 'additive',
      });
    expect(conflictingReplay.status).toBe(409);
    expect(conflictingReplay.body.error.code).toBe('idempotency_conflict');

    const finishedSuggestion = byItem.get(finished.id) as { id: string; rowVersion: number };
    const submitted = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/mrp-suggestions/${finishedSuggestion.id}/submit`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `suggestion-submit-${run}`).send({ expectedRowVersion: 0 });
    expect(submitted.status).toBe(200);
    const approvals = await Promise.all(['a', 'b'].map((part) => request(app)
      .post(`/api/mesaerp/v1/entities/${entityId}/mrp-suggestions/${finishedSuggestion.id}/approve`)
      .set('x-dev-user', CHECKER).set('Idempotency-Key', `suggestion-approve-${part}-${run}`).send({ expectedRowVersion: 1 })));
    expect(approvals.map((response) => response.status).sort()).toEqual([200, 409]);
    const released = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/mrp-suggestions/${finishedSuggestion.id}/release`)
      .set('x-dev-user', CHECKER).set('Idempotency-Key', `suggestion-release-${run}`).send({ expectedRowVersion: 2 });
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    expect(released.body).toMatchObject({ status: 'released', releasedResourceType: 'production_demand' });
    const releasedDemand = await withTenant(ORGANIZATION_ID, (tx) => tx.erpProductionDemand.findUniqueOrThrow({ where: { id: released.body.releasedResourceId } }));
    expect(releasedDemand).toMatchObject({ status: 'draft', originType: 'mrp', itemId: finished.id });
    expect(Object.keys(releasedDemand)).not.toEqual(expect.arrayContaining(['machineId', 'shiftId', 'operatorId']));

    const rawSuggestion = byItem.get(raw.id) as { id: string };
    await request(app).post(`/api/mesaerp/v1/entities/${entityId}/mrp-suggestions/${rawSuggestion.id}/submit`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `raw-submit-${run}`).send({ expectedRowVersion: 0 }).expect(200);
    await request(app).post(`/api/mesaerp/v1/entities/${entityId}/mrp-suggestions/${rawSuggestion.id}/approve`)
      .set('x-dev-user', CHECKER).set('Idempotency-Key', `raw-approve-${run}`).send({ expectedRowVersion: 1 }).expect(200);
    const rawRelease = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/mrp-suggestions/${rawSuggestion.id}/release`)
      .set('x-dev-user', CHECKER).set('Idempotency-Key', `raw-release-${run}`).send({ expectedRowVersion: 2 });
    expect(rawRelease.status).toBe(200);
    expect(rawRelease.body.releasedResourceType).toBe('purchase_requisition');
    const purchaseRequisition = await withTenant(ORGANIZATION_ID, (tx) => tx.erpDocument.findUniqueOrThrow({ where: { id: rawRelease.body.releasedResourceId }, include: { lines: true } }));
    expect(purchaseRequisition).toMatchObject({ documentType: 'purchase_requisition', status: 'draft', originType: 'mrp' });
    expect(purchaseRequisition.lines[0].quantity.toString()).toBe('21');

    const fresh = await calculate(entityId, { warehouseIds: [warehouse.id] }, `mrp-stale-${run}`);
    await setPolicy(entityId, raw, warehouse.id, { supplyPolicy: 'buy', leadTimeDays: 2 });
    const staleSuggestion = fresh.suggestions.find((row: { itemId: string }) => row.itemId === raw.id);
    const stale = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/mrp-suggestions/${staleSuggestion.id}/submit`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `stale-submit-${run}`).send({ expectedRowVersion: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('mrp_run_stale');
  });

  it('nets supplies and reservations chronologically while carrying unused balance into later demand', async () => {
    const run = suffix();
    const entityId = await companyId();
    const warehouse = await createWarehouse(entityId, `SEQ-${run}`, `warehouse-seq-${run}`);
    const item = await createItem(entityId, { itemCode: `SEQ-${run}`, name: 'Sequentially netted resin', baseUom: 'KG' }, `item-seq-${run}`);
    await setPolicy(entityId, item, warehouse.id, { supplyPolicy: 'buy', safetyStock: '0' });
    await approveForecast(entityId, item.id, warehouse.id, '2026-08-20', '10', `seq-one-${run}`);
    await approveForecast(entityId, item.id, warehouse.id, '2026-08-25', '4', `seq-two-${run}`);
    const { financialYearId } = await context(entityId);
    await withTenant(ORGANIZATION_ID, async (tx) => {
      await tx.erpStockMovement.create({ data: {
        organizationId: ORGANIZATION_ID, legalEntityId: entityId, financialYearId, itemId: item.id, warehouseId: warehouse.id,
        movementType: 'test_receipt', businessDate: new Date('2026-08-14'), quantity: '5', uom: 'KG', unitCost: '1', value: '5',
        valuationMethod: 'moving_average', valuationLayer: {}, originType: 'test_fixture', idempotencyKey: `seq-stock-${run}`,
      } });
      const order = await tx.erpDocument.create({ data: {
        organizationId: ORGANIZATION_ID, legalEntityId: entityId, financialYearId, documentType: 'purchase_order', documentNumber: `PO-${run}`,
        documentDate: new Date('2026-08-14'), dueDate: new Date('2026-08-20'), currency: 'INR',
        exchangeRate: 1, partySnapshot: {}, taxSummary: {}, terms: [], shipping: {}, originType: 'test_fixture', createdBy: 'fixture',
      } });
      await tx.erpDocumentLine.create({ data: {
        organizationId: ORGANIZATION_ID, legalEntityId: entityId, documentId: order.id, lineNumber: 1, itemId: item.id,
        description: item.itemCode, quantity: '10', uom: 'KG', warehouseCode: warehouse.code, promisedOn: new Date('2026-08-20'), dimensions: {},
      } });
      await tx.erpDocument.update({ where: { id: order.id }, data: {
        status: 'approved', approvalState: 'approved', submittedAt: new Date(), approvedBy: 'checker', approvedAt: new Date(), rowVersion: { increment: 1 },
      } });
    });
    const mrp = await calculate(entityId, { warehouseIds: [warehouse.id], includeSalesOrders: false, includeProductionDemands: false }, `mrp-sequential-${run}`);
    const requirements = mrp.requirements.filter((row: { itemId: string }) => row.itemId === item.id).sort((a: { requiredOn: string }, b: { requiredOn: string }) => a.requiredOn.localeCompare(b.requiredOn));
    expect(requirements).toHaveLength(2);
    expect(requirements[0]).toMatchObject({ grossRequirement: '10', onHandQuantity: '5', openPurchaseSupply: '10', netRequirement: '0' });
    expect(requirements[0].calculationSnapshot.closingProjectedBalance).toBe('5');
    expect(requirements[1]).toMatchObject({ grossRequirement: '4', openPurchaseSupply: '0', netRequirement: '0' });
    expect(requirements[1].calculationSnapshot.openingProjectedBalance).toBe('5');
    expect(requirements[1].calculationSnapshot.closingProjectedBalance).toBe('1');
    expect(mrp.suggestions.filter((row: { itemId: string }) => row.itemId === item.id)).toHaveLength(0);

    const reservation = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/stock-reservations`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `reservation-sequential-${run}`).send({
        itemId: item.id, warehouseId: warehouse.id, quantity: '3', uom: 'KG', sourceType: 'manual', requiredOn: '2026-08-25',
      });
    expect(reservation.status, JSON.stringify(reservation.body)).toBe(201);
    const earlyAtp = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/atp`)
      .set('x-dev-user', OWNER).query({ itemId: item.id, warehouseId: warehouse.id, asOfDate: '2026-08-14', requiredOn: '2026-08-20' });
    expect(earlyAtp.status).toBe(200);
    expect(earlyAtp.body).toMatchObject({ currentAvailableQuantity: '5', projectedAvailableQuantity: '15' });
    const laterAtp = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/atp`)
      .set('x-dev-user', OWNER).query({ itemId: item.id, warehouseId: warehouse.id, asOfDate: '2026-08-14', requiredOn: '2026-08-25' });
    expect(laterAtp.status).toBe(200);
    expect(laterAtp.body).toMatchObject({ activeReservationQuantity: '3', currentAvailableQuantity: '2', projectedAvailableQuantity: '12' });

    const reservedMrp = await calculate(entityId, {
      warehouseIds: [warehouse.id], includeSalesOrders: false, includeProductionDemands: false,
    }, `mrp-sequential-reserved-${run}`);
    const reservedRequirements = reservedMrp.requirements.filter((row: { itemId: string }) => row.itemId === item.id)
      .sort((a: { requiredOn: string }, b: { requiredOn: string }) => a.requiredOn.localeCompare(b.requiredOn));
    expect(reservedRequirements).toHaveLength(2);
    expect(reservedRequirements[0].calculationSnapshot).toMatchObject({
      externalReservationApplied: '0', openingProjectedBalance: '15', closingProjectedBalance: '5',
    });
    expect(reservedRequirements[1]).toMatchObject({ externalReservation: '3', netRequirement: '2' });
    expect(reservedRequirements[1].calculationSnapshot).toMatchObject({
      externalReservationApplied: '3', openingProjectedBalance: '2', plannedQuantity: '2', closingProjectedBalance: '0',
    });
    expect(reservedMrp.suggestions.filter((row: { itemId: string }) => row.itemId === item.id)).toEqual([
      expect.objectContaining({ suggestionType: 'purchase', quantity: '2', requiredOn: '2026-08-25' }),
    ]);
  });

  it('deduplicates a production demand linked to an included sales-order line', async () => {
    const run = suffix();
    const entityId = await companyId();
    const warehouse = await createWarehouse(entityId, `DED-${run}`, `warehouse-ded-${run}`);
    const item = await createItem(entityId, { itemCode: `DED-${run}`, name: 'Linked-demand item', baseUom: 'KG' }, `item-ded-${run}`);
    await setPolicy(entityId, item, warehouse.id, { supplyPolicy: 'buy' });
    const { financialYearId } = await context(entityId);
    let orderId = ''; let lineId = '';
    await withTenant(ORGANIZATION_ID, async (tx) => {
      const order = await tx.erpDocument.create({ data: {
        organizationId: ORGANIZATION_ID, legalEntityId: entityId, financialYearId, documentType: 'sales_order', documentNumber: `SO-${run}`,
        documentDate: new Date('2026-08-14'), dueDate: new Date('2026-08-20'), currency: 'INR',
        exchangeRate: 1, partySnapshot: {}, taxSummary: {}, terms: [], shipping: {}, originType: 'test_fixture', createdBy: 'maker',
      } });
      const line = await tx.erpDocumentLine.create({ data: {
        organizationId: ORGANIZATION_ID, legalEntityId: entityId, documentId: order.id, lineNumber: 1, itemId: item.id,
        description: item.itemCode, quantity: '7', uom: 'KG', warehouseCode: warehouse.code, promisedOn: new Date('2026-08-20'), dimensions: {},
      } });
      orderId = order.id;
      lineId = line.id;
      await tx.erpDocument.update({ where: { id: order.id }, data: {
        status: 'approved', approvalState: 'approved', submittedAt: new Date(), approvedBy: 'checker', approvedAt: new Date(), rowVersion: { increment: 1 },
      } });
    });
    const createdDemand = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/production-demands`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `demand-dedupe-${run}`).send({
        demandDate: '2026-08-14', demandType: 'sales_order', itemId: item.id, quantity: '7', uom: 'KG',
        requiredOn: '2026-08-20', sourceSalesOrderId: orderId, sourceLineId: lineId, originType: 'sales_order_snapshot',
      });
    expect(createdDemand.status, JSON.stringify(createdDemand.body)).toBe(201);
    const approvedDemand = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/production-demands/${createdDemand.body.id}/approve`)
      .set('x-dev-user', CHECKER).set('Idempotency-Key', `demand-dedupe-approve-${run}`).send({ expectedRowVersion: 0 });
    expect(approvedDemand.status, JSON.stringify(approvedDemand.body)).toBe(200);
    const mrp = await calculate(entityId, { warehouseIds: [warehouse.id], includeForecasts: false }, `mrp-dedupe-${run}`);
    const requirement = mrp.requirements.find((row: { itemId: string }) => row.itemId === item.id);
    expect(requirement.grossRequirement).toBe('7');
    expect(mrp.demandSnapshot.demands.filter((row: { itemId: string }) => row.itemId === item.id)).toHaveLength(1);
    expect(mrp.demandBasis.linkedProductionDemandDeduplication).toBe('sales_order_line');
  });

  it('releases a transfer suggestion as a draft proposal without moving stock', async () => {
    const run = suffix();
    const entityId = await companyId();
    const sourceWarehouse = await createWarehouse(entityId, `TS-${run}`, `warehouse-transfer-source-${run}`);
    const targetWarehouse = await createWarehouse(entityId, `TT-${run}`, `warehouse-transfer-target-${run}`);
    const item = await createItem(entityId, { itemCode: `TR-${run}`, name: 'Transfer-planned material', baseUom: 'KG' }, `item-transfer-${run}`);
    await setPolicy(entityId, item, targetWarehouse.id, {
      supplyPolicy: 'transfer', transferSourceWarehouseId: sourceWarehouse.id, leadTimeDays: 1,
    });
    await approveForecast(entityId, item.id, targetWarehouse.id, '2026-08-20', '6', `transfer-${run}`);
    const mrp = await calculate(entityId, {
      warehouseIds: [sourceWarehouse.id, targetWarehouse.id], includeSalesOrders: false, includeProductionDemands: false,
    }, `mrp-transfer-${run}`);
    const suggestion = mrp.suggestions.find((row: { itemId: string }) => row.itemId === item.id);
    expect(suggestion).toMatchObject({ suggestionType: 'transfer', quantity: '6', sourceWarehouseId: sourceWarehouse.id });
    await request(app).post(`/api/mesaerp/v1/entities/${entityId}/mrp-suggestions/${suggestion.id}/submit`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `transfer-submit-${run}`).send({ expectedRowVersion: 0 }).expect(200);
    await request(app).post(`/api/mesaerp/v1/entities/${entityId}/mrp-suggestions/${suggestion.id}/approve`)
      .set('x-dev-user', CHECKER).set('Idempotency-Key', `transfer-approve-${run}`).send({ expectedRowVersion: 1 }).expect(200);
    const released = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/mrp-suggestions/${suggestion.id}/release`)
      .set('x-dev-user', CHECKER).set('Idempotency-Key', `transfer-release-${run}`).send({ expectedRowVersion: 2 });
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    expect(released.body.releasedResourceType).toBe('transfer_proposal');
    const [proposal, movements] = await withTenant(ORGANIZATION_ID, async (tx) => Promise.all([
      tx.erpTransferProposal.findUniqueOrThrow({ where: { id: released.body.releasedResourceId } }),
      tx.erpStockMovement.count({ where: { legalEntityId: entityId, itemId: item.id } }),
    ]));
    expect(proposal).toMatchObject({
      status: 'draft', itemId: item.id, fromWarehouseId: sourceWarehouse.id, toWarehouseId: targetWarehouse.id,
    });
    expect(proposal.quantity.toString()).toBe('6');
    expect(movements).toBe(0);
  });

  it('serializes overlapping BOM approvals and cross-warehouse source reservations while enforcing serial, batch and expiry evidence', async () => {
    const run = suffix();
    const entityId = await companyId();
    const firstWarehouse = await createWarehouse(entityId, `R1-${run}`, `warehouse-r1-${run}`);
    const secondWarehouse = await createWarehouse(entityId, `R2-${run}`, `warehouse-r2-${run}`);
    const component = await createItem(entityId, { itemCode: `C-${run}`, name: 'BOM component', baseUom: 'EA' }, `item-c-${run}`);
    const parent = await createItem(entityId, {
      itemCode: `P-${run}`, name: 'Serial-tracked discrete BOM parent', baseUom: 'EA', valuationMethod: 'fifo',
      batchTracked: true, serialTracked: true, expiryTracked: true,
    }, `item-p-${run}`);
    await setPolicy(entityId, component, firstWarehouse.id, { supplyPolicy: 'buy' });
    await setPolicy(entityId, parent, firstWarehouse.id, { supplyPolicy: 'make' });
    const created = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/planning-boms`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `overlap-bom-${run}`).send({
        bomCode: `OV-${run}`, parentItemId: parent.id, bomType: 'discrete',
        revision: { revisionCode: 'R1', effectiveFrom: '2026-08-01', effectiveTo: '2026-08-31', outputQuantity: '1', outputUom: 'EA', yieldPercentage: '100',
          components: [{ componentItemId: component.id, quantity: '1', uom: 'EA', scrapPercentage: '0' }] },
      });
    expect(created.status).toBe(201);
    const second = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/planning-boms/${created.body.id}/revisions`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `overlap-revision-${run}`).send({
        revisionCode: 'R2', effectiveFrom: '2026-08-15', effectiveTo: '2026-09-15', outputQuantity: '1', outputUom: 'EA', yieldPercentage: '100',
        components: [{ componentItemId: component.id, quantity: '1', uom: 'EA', scrapPercentage: '0' }],
      });
    expect(second.status).toBe(201);
    const firstRevisionId = created.body.revisions[0].revisionId;
    await request(app).post(`/api/mesaerp/v1/entities/${entityId}/planning-boms/${created.body.id}/revisions/${firstRevisionId}/submit`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `overlap-submit-one-${run}`).send({ expectedRowVersion: 0 }).expect(200);
    await request(app).post(`/api/mesaerp/v1/entities/${entityId}/planning-boms/${created.body.id}/revisions/${second.body.revisionId}/submit`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `overlap-submit-two-${run}`).send({ expectedRowVersion: 0 }).expect(200);
    const decisions = await Promise.all([
      [firstRevisionId, 'one'], [second.body.revisionId, 'two'],
    ].map(([revisionId, part]) => request(app).post(`/api/mesaerp/v1/entities/${entityId}/planning-boms/${created.body.id}/revisions/${revisionId}/approve`)
      .set('x-dev-user', CHECKER).set('Idempotency-Key', `overlap-approve-${part}-${run}`).send({ expectedRowVersion: 1 })));
    expect(decisions.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(decisions.find((response) => response.status === 409)?.body.error.code).toBe('bom_effective_period_overlap');

    const serialItem = parent;
    const { financialYearId } = await context(entityId);
    let orderId = ''; let lineId = '';
    await withTenant(ORGANIZATION_ID, async (tx) => {
      for (const [index, warehouse] of [firstWarehouse, secondWarehouse].entries()) await tx.erpStockMovement.create({ data: {
        organizationId: ORGANIZATION_ID, legalEntityId: entityId, financialYearId, itemId: serialItem.id, warehouseId: warehouse.id,
        movementType: 'test_receipt', businessDate: new Date('2026-08-14'), quantity: '1', uom: 'EA', unitCost: '100', value: '100', valuationMethod: 'fifo',
        batchNumber: `LOT-${run}`, serialNumber: `SN-${index + 1}-${run}`, expiryDate: new Date('2027-08-14'), valuationLayer: {}, originType: 'test_fixture', idempotencyKey: `serial-stock-${index}-${run}`,
      } });
      const expiredWarehouse = firstWarehouse;
      await tx.erpStockMovement.create({ data: {
        organizationId: ORGANIZATION_ID, legalEntityId: entityId, financialYearId, itemId: serialItem.id, warehouseId: expiredWarehouse.id,
        movementType: 'test_receipt', businessDate: new Date('2026-08-14'), quantity: '1', uom: 'EA', unitCost: '100', value: '100', valuationMethod: 'fifo',
        batchNumber: `OLD-${run}`, serialNumber: `OLD-SN-${run}`, expiryDate: new Date('2026-08-13'), valuationLayer: {}, originType: 'test_fixture', idempotencyKey: `expired-stock-${run}`,
      } });
      const order = await tx.erpDocument.create({ data: {
        organizationId: ORGANIZATION_ID, legalEntityId: entityId, financialYearId, documentType: 'sales_order', documentNumber: `RSO-${run}`,
        documentDate: new Date('2026-08-14'), currency: 'INR', exchangeRate: 1,
        partySnapshot: {}, taxSummary: {}, terms: [], shipping: {}, originType: 'test_fixture', createdBy: 'maker',
      } });
      const line = await tx.erpDocumentLine.create({ data: {
        organizationId: ORGANIZATION_ID, legalEntityId: entityId, documentId: order.id, lineNumber: 1, itemId: serialItem.id,
        description: serialItem.itemCode, quantity: '1', uom: 'EA', warehouseCode: firstWarehouse.code, dimensions: {},
      } });
      orderId = order.id; lineId = line.id;
      await tx.erpDocument.update({ where: { id: order.id }, data: {
        status: 'approved', approvalState: 'approved', submittedAt: new Date(), approvedBy: 'checker', approvedAt: new Date(), rowVersion: { increment: 1 },
      } });
    });
    const missingBatch = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/stock-reservations`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `reservation-missing-${run}`).send({
        itemId: serialItem.id, warehouseId: firstWarehouse.id, quantity: '1', uom: 'EA', serialNumber: `SN-1-${run}`,
        sourceType: 'sales_order', sourceId: orderId, sourceLineId: lineId,
      });
    expect(missingBatch.status).toBe(422);
    expect(missingBatch.body.error.code).toBe('reservation_batch_required');
    const expired = await request(app).post(`/api/mesaerp/v1/entities/${entityId}/stock-reservations`)
      .set('x-dev-user', OWNER).set('Idempotency-Key', `reservation-expired-${run}`).send({
        itemId: serialItem.id, warehouseId: firstWarehouse.id, quantity: '1', uom: 'EA', batchNumber: `OLD-${run}`, serialNumber: `OLD-SN-${run}`,
        sourceType: 'sales_order', sourceId: orderId, sourceLineId: lineId,
      });
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe('insufficient_available_stock');
    const reservations = await Promise.all([firstWarehouse, secondWarehouse].map((warehouse, index) => request(app)
      .post(`/api/mesaerp/v1/entities/${entityId}/stock-reservations`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `reservation-concurrent-${index}-${run}`).send({
        itemId: serialItem.id, warehouseId: warehouse.id, quantity: '1', uom: 'EA', batchNumber: `LOT-${run}`, serialNumber: `SN-${index + 1}-${run}`,
        sourceType: 'sales_order', sourceId: orderId, sourceLineId: lineId,
      })));
    expect(reservations.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(reservations.find((response) => response.status === 409)?.body.error.code).toBe('reservation_source_quantity_exceeded');
    expect(reservations.find((response) => response.status === 201)?.body.sourceSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
