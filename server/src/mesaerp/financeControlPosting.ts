import { randomUUID } from 'node:crypto';
import { Prisma, type ErpVoucher } from '@prisma/client';
import { basePrisma } from '../db';
import { audit } from '../lib/audit';
import type { TenantCtx } from '../lib/tenantContext';
import { ApiError } from '../middleware/error';
import { hashCanonical } from './repository';

type Db = typeof basePrisma;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const day = (value: Date) => value.toISOString().slice(0, 10);
const record = (value: Prisma.JsonValue | null): Record<string, unknown> => (!value || Array.isArray(value) || typeof value !== 'object' ? {} : value as Record<string, unknown>);

/**
 * Applies the asset subledger effect inside the same transaction that posts the
 * approved voucher. A failed asset check aborts the voucher posting; a draft or
 * approval alone never changes the asset balance.
 */
export async function applyFinanceControlPosting(db: Db, context: TenantCtx, voucher: ErpVoucher): Promise<void> {
  const metadata = record(voucher.originMetadata);
  const eventId = typeof metadata.assetEventId === 'string' ? metadata.assetEventId : '';
  if (!eventId) return;
  await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpAssetEvent" WHERE "id" = ${eventId} FOR UPDATE`);
  const event = await db.erpAssetEvent.findFirst({ where: { id: eventId, voucherId: voucher.id, legalEntityId: voucher.legalEntityId } });
  if (!event) throw new ApiError(409, 'asset_event_mapping_missing', 'Linked asset event evidence is missing or belongs to another company.');
  if (event.status !== 'pending_voucher') throw new ApiError(409, 'asset_event_already_applied', 'Linked asset event has already been applied.');
  if (metadata.evidenceHash !== event.sourceSnapshotHash) throw new ApiError(409, 'asset_event_hash_mismatch', 'Asset event evidence hash no longer matches the approved voucher mapping.');
  await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpAsset" WHERE "id" = ${event.assetId} FOR UPDATE`);
  const asset = await db.erpAsset.findFirst({ where: { id: event.assetId, legalEntityId: voucher.legalEntityId } });
  if (!asset) throw new ApiError(409, 'asset_missing', 'Linked asset no longer exists in this company.');
  const calculation = record(event.calculationSnapshot);
  const before = {
    status: asset.status, rowVersion: asset.rowVersion, netBookValue: asset.netBookValue.toString(),
    accumulatedDepreciation: asset.accumulatedDepreciation.toString(), accumulatedImpairment: asset.accumulatedImpairment.toString(),
  };
  let changes: Prisma.ErpAssetUpdateManyMutationInput;
  if (event.eventType === 'capitalization') {
    if (asset.status !== 'under_construction') throw new ApiError(409, 'asset_state_invalid', 'Capitalization requires an under-construction asset.');
    const capitalizationDate = typeof calculation.capitalizationDate === 'string' ? new Date(`${calculation.capitalizationDate}T00:00:00.000Z`) : event.businessDate;
    changes = { status: 'active', capitalizationDate, approvedBy: context.membershipId, rowVersion: { increment: 1 } };
  } else if (event.eventType === 'depreciation') {
    if (asset.status !== 'active' || event.amount.gt(asset.netBookValue)) throw new ApiError(409, 'asset_depreciation_invalid', 'Posted depreciation would overstate accumulated depreciation or applies to an inactive asset.');
    const throughDate = typeof calculation.throughDate === 'string' ? new Date(`${calculation.throughDate}T00:00:00.000Z`) : event.businessDate;
    changes = { accumulatedDepreciation: asset.accumulatedDepreciation.plus(event.amount), netBookValue: asset.netBookValue.minus(event.amount), depreciationThrough: throughDate, rowVersion: { increment: 1 } };
  } else if (event.eventType === 'impairment') {
    if (asset.status !== 'active' || event.amount.gt(asset.netBookValue)) throw new ApiError(409, 'asset_impairment_invalid', 'Posted impairment would make net book value negative or applies to an inactive asset.');
    changes = { accumulatedImpairment: asset.accumulatedImpairment.plus(event.amount), netBookValue: asset.netBookValue.minus(event.amount), rowVersion: { increment: 1 } };
  } else if (event.eventType === 'disposal') {
    if (asset.status !== 'active') throw new ApiError(409, 'asset_disposal_invalid', 'Disposal requires an active asset.');
    changes = { status: 'disposed', disposedAt: event.businessDate, netBookValue: 0, rowVersion: { increment: 1 } };
  } else {
    throw new ApiError(409, 'asset_event_type_invalid', `Asset event ${event.eventType} cannot be applied by voucher posting.`);
  }
  const assetChanged = await db.erpAsset.updateMany({ where: { id: asset.id, legalEntityId: voucher.legalEntityId, rowVersion: asset.rowVersion }, data: changes });
  if (assetChanged.count !== 1) throw new ApiError(409, 'version_conflict', 'Asset changed while the voucher was posted.');
  const completedAt = new Date();
  const eventChanged = await db.erpAssetEvent.updateMany({ where: { id: event.id, status: 'pending_voucher', rowVersion: event.rowVersion }, data: { status: 'completed', completedBy: context.membershipId, completedAt, rowVersion: { increment: 1 } } });
  if (eventChanged.count !== 1) throw new ApiError(409, 'version_conflict', 'Asset event changed while the voucher was posted.');
  const updated = await db.erpAsset.findUniqueOrThrow({ where: { id: asset.id } });
  const payload = { assetId: asset.id, assetCode: asset.assetCode, eventId: event.id, eventType: event.eventType, voucherId: voucher.id, businessDate: day(event.businessDate), amount: event.amount.toString(), before, after: { status: updated.status, rowVersion: updated.rowVersion, netBookValue: updated.netBookValue.toString(), accumulatedDepreciation: updated.accumulatedDepreciation.toString(), accumulatedImpairment: updated.accumulatedImpairment.toString() }, completedAt: completedAt.toISOString() };
  await db.integrationOutboxEvent.create({ data: {
    organizationId: context.organizationId, legalEntityId: voucher.legalEntityId, serviceId: 'mesaerp',
    aggregateType: 'ErpAssetEvent', aggregateId: event.id, eventType: `mesaerp.asset.${event.eventType}_posted.v1`,
    correlationId: randomUUID(), causationId: voucher.id, payload: json(payload), payloadHash: hashCanonical(payload),
  } });
  await audit(db, { action: `mesaerp.asset.${event.eventType}.post`, entity: 'ErpAsset', entityId: asset.id, before, after: payload.after });
}
