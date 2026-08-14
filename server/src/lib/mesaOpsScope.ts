import { prisma } from '../db';
import { tenantContext } from './tenantContext';
import { ApiError } from '../middleware/error';

export interface MesaOpsPlantScope {
  explicit: boolean;
  allPlants: boolean;
  plantCodes: string[];
}

/**
 * The pre-migration implicit all-plant behavior is available only for an
 * explicitly opted-in local/test process. Production ignores the flag even if
 * it is accidentally configured.
 */
export function allowsLegacyMesaOpsUnassignedAccess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.MESAOPS_ALLOW_LEGACY_UNASSIGNED === '1';
}

export function deriveMesaOpsPlantScope(assignments: Array<{
  plantCode: string | null;
  warehouseId: string | null;
  legalEntityId: string | null;
}>, hasAssignmentHistory = assignments.length > 0, allowLegacyUnassigned = false): MesaOpsPlantScope {
  if (assignments.length === 0) {
    if (!hasAssignmentHistory && allowLegacyUnassigned) {
      return { explicit: false, allPlants: true, plantCodes: [] };
    }
    return { explicit: hasAssignmentHistory, allPlants: false, plantCodes: [] };
  }
  const allPlants = assignments.some((assignment) => (
    assignment.plantCode === null && assignment.warehouseId === null && assignment.legalEntityId === null
  ));
  return {
    explicit: true,
    allPlants,
    plantCodes: [...new Set(assignments.map((assignment) => assignment.plantCode).filter((value): value is string => Boolean(value)))],
  };
}

export async function resolveMesaOpsPlantScope(): Promise<MesaOpsPlantScope> {
  const current = tenantContext.getStore();
  if (!current) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  const now = new Date();
  const assignmentHistory = await prisma.roleAssignment.findMany({
    where: {
      organizationId: current.organizationId,
      membershipId: current.membershipId,
      serviceId: 'mesaops',
    },
    select: {
      plantCode: true,
      warehouseId: true,
      legalEntityId: true,
      status: true,
      revokedAt: true,
      validFrom: true,
      validTo: true,
      organizationId: true,
      role: {
        select: {
          organizationId: true,
          erpLegalEntityId: true,
          permissions: {
            where: { permission: { serviceId: 'mesaerp' } },
            select: { id: true },
            take: 1,
          },
          assignments: {
            where: { serviceId: 'mesaerp' },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  const activeAssignments = assignmentHistory.filter((assignment) => (
    assignment.status === 'active'
      && assignment.revokedAt === null
      && (!assignment.validFrom || assignment.validFrom <= now)
      && (!assignment.validTo || assignment.validTo >= now)
      && assignment.organizationId === current.organizationId
      && assignment.legalEntityId === null
      && assignment.warehouseId === null
      && assignment.role.organizationId === current.organizationId
      && assignment.role.erpLegalEntityId === null
      && assignment.role.permissions.length === 0
      && assignment.role.assignments.length === 0
  ));
  return deriveMesaOpsPlantScope(
    activeAssignments,
    assignmentHistory.length > 0,
    allowsLegacyMesaOpsUnassignedAccess(),
  );
}

export function plantCodeFilter(scope: MesaOpsPlantScope): undefined | { in: string[] } {
  return scope.allPlants ? undefined : { in: scope.plantCodes };
}

export function assertMesaOpsPlantAccess(scope: MesaOpsPlantScope, plantCode: string): void {
  if (!scope.allPlants && !scope.plantCodes.includes(plantCode)) {
    throw new ApiError(403, 'plant_forbidden', `Your MesaOps assignment does not permit plant ${plantCode}.`);
  }
}
