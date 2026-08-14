import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { tenantContext } from './tenantContext';
import { resolveMesaOpsPlantScope } from './mesaOpsScope';

const enabled = process.env.RUN_MESAERP_DB_INTEGRATION === '1'
  && Boolean(process.env.DIRECT_DATABASE_URL);
const owner = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_DATABASE_URL } },
});

describe.skipIf(!enabled)('MesaOps explicit plant scope database acceptance', () => {
  const suffix = randomUUID();
  const organizationId = `mesaops-scope-org-${suffix}`;
  const userId = `mesaops-scope-user-${suffix}`;
  const membershipId = `mesaops-scope-member-${suffix}`;
  const roleId = `mesaops-scope-role-${suffix}`;
  const assignmentId = `mesaops-scope-assignment-${suffix}`;

  afterAll(async () => {
    await owner.organization.deleteMany({ where: { id: organizationId } });
    await owner.user.deleteMany({ where: { id: userId } });
    await owner.$disconnect();
  });

  it('denies zero history, grants an explicit wildcard, then denies revoked history', async () => {
    await owner.organization.create({
      data: { id: organizationId, name: 'MesaOps Scope Fixture', slug: organizationId },
    });
    await owner.organizationService.create({
      data: { organizationId, serviceId: 'mesaops', status: 'active' },
    });
    await owner.user.create({
      data: { id: userId, email: `${suffix}@scope.fixture.invalid`, name: 'Scope Fixture' },
    });
    await owner.role.create({
      data: {
        id: roleId,
        organizationId,
        name: 'Fixture Plant Role',
        screens: [],
        isAdmin: false,
        isSystem: false,
      },
    });
    await owner.membership.create({
      data: {
        id: membershipId,
        organizationId,
        userId,
        employeeCode: `SCOPE-${suffix}`,
        department: 'Production',
        role: 'Fixture Plant Role',
        roleId,
        status: 'active',
      },
    });

    const context = {
      organizationId,
      userId,
      membershipId,
      role: 'Fixture Plant Role',
      email: `${suffix}@scope.fixture.invalid`,
    };
    await expect(tenantContext.run(context, resolveMesaOpsPlantScope)).resolves.toEqual({
      explicit: false,
      allPlants: false,
      plantCodes: [],
    });

    await owner.roleAssignment.create({
      data: {
        id: assignmentId,
        organizationId,
        membershipId,
        roleId,
        serviceId: 'mesaops',
        legalEntityId: null,
        plantCode: null,
        warehouseId: null,
        status: 'active',
      },
    });
    await expect(tenantContext.run(context, resolveMesaOpsPlantScope)).resolves.toEqual({
      explicit: true,
      allPlants: true,
      plantCodes: [],
    });

    await owner.roleAssignment.update({
      where: { id: assignmentId },
      data: {
        status: 'revoked',
        revokedAt: new Date(),
        revokedBy: membershipId,
        revocationReason: 'scope acceptance test',
        rowVersion: { increment: 1 },
      },
    });
    await expect(tenantContext.run(context, resolveMesaOpsPlantScope)).resolves.toEqual({
      explicit: true,
      allPlants: false,
      plantCodes: [],
    });
  });
});
