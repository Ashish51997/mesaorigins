import { Prisma, type MesaOpsStatutoryRuleProfile } from '@prisma/client';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { canonicalHash } from '../../lib/canonical';
import { runMesaOpsIdempotent } from '../../lib/mesaOpsIdempotency';
import { tenantContext } from '../../lib/tenantContext';
import { ApiError } from '../../middleware/error';
import type {
  MesaOpsStatutoryRuleProfileApprove,
  MesaOpsStatutoryRuleProfileCreate,
} from './statutoryProfileSchemas';

function ctx() {
  const current = tenantContext.getStore();
  if (!current) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return current;
}

const day = (value: Date) => value.toISOString().slice(0, 10);
const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);

export interface MesaOpsStatutoryRuleProfileDto {
  id: string;
  organizationId: string;
  version: string;
  countryCode: string;
  plantCode: string;
  movementType: string;
  effectiveFrom: string;
  effectiveTo?: string;
  status: 'draft' | 'approved';
  requiresInvoice: boolean;
  requiresEWayBill: boolean;
  reviewedExemptionReason: string;
  sourceReference: string;
  sourceEvidence: unknown;
  sourceChecksum: string;
  rowVersion: number;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export function mesaOpsStatutoryRuleProfileDto(row: MesaOpsStatutoryRuleProfile): MesaOpsStatutoryRuleProfileDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    version: row.version,
    countryCode: row.countryCode,
    plantCode: row.plantCode,
    movementType: row.movementType,
    effectiveFrom: day(row.effectiveFrom),
    ...(row.effectiveTo ? { effectiveTo: day(row.effectiveTo) } : {}),
    status: row.status as MesaOpsStatutoryRuleProfileDto['status'],
    requiresInvoice: row.requiresInvoice,
    requiresEWayBill: row.requiresEWayBill,
    reviewedExemptionReason: row.reviewedExemptionReason,
    sourceReference: row.sourceReference,
    sourceEvidence: structuredClone(row.sourceEvidence),
    sourceChecksum: row.sourceChecksum,
    rowVersion: row.rowVersion,
    createdBy: row.createdBy,
    ...(row.approvedBy ? { approvedBy: row.approvedBy } : {}),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMesaOpsStatutoryRuleProfiles() {
  const rows = await prisma.mesaOpsStatutoryRuleProfile.findMany({
    orderBy: [{ status: 'asc' }, { countryCode: 'asc' }, { plantCode: 'asc' }, { movementType: 'asc' }, { effectiveFrom: 'desc' }],
    take: 500,
  });
  return rows.map(mesaOpsStatutoryRuleProfileDto);
}

export async function getMesaOpsStatutoryRuleProfile(id: string) {
  const row = await prisma.mesaOpsStatutoryRuleProfile.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, 'statutory_rule_profile_not_found', 'MesaOps statutory rule profile not found.');
  return mesaOpsStatutoryRuleProfileDto(row);
}

export async function createMesaOpsStatutoryRuleProfile(input: MesaOpsStatutoryRuleProfileCreate, key: string) {
  const current = ctx();
  if (canonicalHash(input.sourceEvidence) !== input.sourceChecksum) {
    throw new ApiError(422, 'source_checksum_mismatch', 'Source evidence does not match its declared SHA-256 checksum.');
  }
  return runMesaOpsIdempotent({
    scope: 'mesaops-statutory-rule-profile.create',
    key,
    payload: input,
    execute: async (tx) => {
      const duplicate = await tx.mesaOpsStatutoryRuleProfile.findFirst({ where: { version: input.version }, select: { id: true } });
      if (duplicate) throw new ApiError(409, 'statutory_rule_profile_version_exists', 'That statutory rule profile version already exists.');
      const row = await tx.mesaOpsStatutoryRuleProfile.create({
        data: {
          organizationId: current.organizationId,
          version: input.version,
          countryCode: input.countryCode,
          plantCode: input.plantCode,
          movementType: input.movementType,
          effectiveFrom: dateOnly(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? dateOnly(input.effectiveTo) : null,
          requiresInvoice: input.requiresInvoice,
          requiresEWayBill: input.requiresEWayBill,
          reviewedExemptionReason: input.reviewedExemptionReason,
          sourceReference: input.sourceReference,
          sourceEvidence: JSON.parse(JSON.stringify(input.sourceEvidence)) as Prisma.InputJsonValue,
          sourceChecksum: input.sourceChecksum,
          createIdempotencyKey: key,
          requestHash: canonicalHash(input),
          createdBy: current.membershipId,
        },
      });
      const response = mesaOpsStatutoryRuleProfileDto(row);
      await audit(tx, {
        action: 'mesaops.statutory_rule_profile.create',
        entity: 'MesaOpsStatutoryRuleProfile',
        entityId: row.id,
        after: response,
      });
      return response;
    },
  });
}

export async function approveMesaOpsStatutoryRuleProfile(
  id: string,
  input: MesaOpsStatutoryRuleProfileApprove,
  key: string,
) {
  const current = ctx();
  return runMesaOpsIdempotent({
    scope: `mesaops-statutory-rule-profile.${id}.approve`,
    key,
    payload: input,
    execute: async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MesaOpsStatutoryRuleProfile" WHERE "id" = ${id} AND "organizationId" = ${current.organizationId} FOR UPDATE`;
      const existing = await tx.mesaOpsStatutoryRuleProfile.findFirst({ where: { id, organizationId: current.organizationId } });
      if (!existing) throw new ApiError(404, 'statutory_rule_profile_not_found', 'MesaOps statutory rule profile not found.');
      if (existing.status !== 'draft') throw new ApiError(409, 'statutory_rule_profile_not_transitionable', 'Only a draft statutory rule profile can be approved.');
      if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'The statutory rule profile changed since it was loaded.');
      if (!existing.createdBy || existing.createdBy === current.membershipId) {
        throw new ApiError(409, 'maker_checker_required', 'The statutory rule profile maker cannot approve the same version.');
      }

      const sameEffectiveStart = await tx.mesaOpsStatutoryRuleProfile.findFirst({
        where: {
          id: { not: id },
          countryCode: existing.countryCode,
          plantCode: existing.plantCode,
          movementType: existing.movementType,
          status: 'approved',
          effectiveFrom: existing.effectiveFrom,
        },
        select: { id: true, version: true },
      });
      if (sameEffectiveStart) {
        throw new ApiError(409, 'statutory_rule_profile_effective_start_exists', `Approved profile ${sameEffectiveStart.version} already starts on this date for the exact scope.`);
      }

      const changed = await tx.mesaOpsStatutoryRuleProfile.updateMany({
        where: { id, status: 'draft', rowVersion: input.expectedRowVersion },
        data: {
          status: 'approved',
          approvedBy: current.membershipId,
          approvedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'The statutory rule profile changed while it was being approved.');
      const row = await tx.mesaOpsStatutoryRuleProfile.findUniqueOrThrow({ where: { id } });
      const response = mesaOpsStatutoryRuleProfileDto(row);
      await audit(tx, {
        action: 'mesaops.statutory_rule_profile.approve',
        entity: 'MesaOpsStatutoryRuleProfile',
        entityId: id,
        before: mesaOpsStatutoryRuleProfileDto(existing),
        after: { ...response, approvalNote: input.approvalNote },
      });
      return response;
    },
  });
}
