import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasAnyMesaErpCompanyAccess, hasMesaErpPermission } from '../access';

const enabled = process.env.RUN_MESAERP_DB_INTEGRATION === '1';
const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const run = `${process.pid}-${Date.now().toString(36)}`;
const organizationId = `access-scope-org-${run}`;
const otherOrganizationId = `access-scope-other-org-${run}`;
const companyA = `access-scope-a-${run}`;
const companyB = `access-scope-b-${run}`;
const grantorId = `access-scope-grantor-${run}`;
const recipientId = `access-scope-recipient-${run}`;
const platformId = `access-scope-platform-${run}`;
const companyRoleId = `access-scope-role-${run}`;
const platformRoleId = `access-scope-platform-role-${run}`;
const permissionKey = 'mesaerp.vendor.read';

describe.skipIf(!enabled)('MesaERP exact role, assignment and delegation company scope', () => {
  beforeAll(async () => {
    const permission = await direct.permission.findUniqueOrThrow({
      where: { serviceId_key: { serviceId: 'mesaerp', key: permissionKey } },
    });
    const platformPermission = await direct.permission.findUniqueOrThrow({
      where: { serviceId_key: { serviceId: 'mesaerp', key: 'mesaerp.legal_entity.manage' } },
    });
    await direct.organization.createMany({ data: [
      { id: organizationId, name: 'Access scope test', slug: organizationId },
      { id: otherOrganizationId, name: 'Other access scope tenant', slug: otherOrganizationId },
    ] });
    await direct.user.createMany({ data: [grantorId, recipientId, platformId].map((id) => ({
      id: `user-${id}`, email: `${id}@example.test`, name: id,
    })) });
    await direct.membership.createMany({ data: [grantorId, recipientId, platformId].map((id, index) => ({
      id, organizationId, userId: `user-${id}`, employeeCode: `AS-${index}-${run}`, department: 'ERP', role: 'ERP',
    })) });
    await direct.legalEntity.createMany({ data: [
      { id: companyA, organizationId, code: `A-${run}`, legalName: 'Company A' },
      { id: companyB, organizationId, code: `B-${run}`, legalName: 'Company B' },
    ] });
    await direct.role.createMany({ data: [
      { id: companyRoleId, organizationId, erpLegalEntityId: companyA, name: `Company role ${run}`, screens: [] },
      { id: platformRoleId, organizationId, erpLegalEntityId: null, name: `Platform role ${run}`, screens: [] },
    ] });
    await direct.rolePermission.createMany({ data: [
      { organizationId, roleId: companyRoleId, permissionId: permission.id, effect: 'allow' },
      { organizationId, roleId: platformRoleId, permissionId: platformPermission.id, effect: 'allow' },
    ] });
    await direct.roleAssignment.createMany({ data: [
      { organizationId, membershipId: grantorId, roleId: companyRoleId, serviceId: 'mesaerp', legalEntityId: companyA },
      { organizationId, membershipId: platformId, roleId: platformRoleId, serviceId: 'mesaerp', legalEntityId: null },
    ] });
    await direct.delegation.create({ data: {
      organizationId, fromMembershipId: grantorId, toMembershipId: recipientId, serviceId: 'mesaerp',
      legalEntityId: companyA, permissions: [permissionKey], validFrom: new Date(Date.now() - 60_000),
      validTo: new Date(Date.now() + 60 * 60 * 1000), reason: 'Scoped regression test',
    } });
  });

  afterAll(async () => { await direct.$disconnect(); });

  it('allows only the company bound on both the role and its assignment', async () => {
    await expect(hasMesaErpPermission({ organizationId, membershipId: grantorId, permission: permissionKey, legalEntityId: companyA })).resolves.toBe(true);
    await expect(hasMesaErpPermission({ organizationId, membershipId: grantorId, permission: permissionKey, legalEntityId: companyB })).resolves.toBe(false);
    await expect(hasAnyMesaErpCompanyAccess({ organizationId, membershipId: grantorId, legalEntityId: companyA })).resolves.toBe(true);
    await expect(hasAnyMesaErpCompanyAccess({ organizationId, membershipId: grantorId, legalEntityId: companyB })).resolves.toBe(false);
  });

  it('does not let an organization bootstrap role bleed into a company', async () => {
    await expect(hasMesaErpPermission({ organizationId, membershipId: platformId, permission: 'mesaerp.legal_entity.manage' })).resolves.toBe(true);
    await expect(hasMesaErpPermission({ organizationId, membershipId: platformId, permission: 'mesaerp.legal_entity.manage', legalEntityId: companyA })).resolves.toBe(false);
  });

  it('fails closed if a role is rebound after its assignment was created', async () => {
    await direct.role.update({ where: { id: companyRoleId }, data: { erpLegalEntityId: companyB } });
    await expect(hasMesaErpPermission({ organizationId, membershipId: grantorId, permission: permissionKey, legalEntityId: companyA })).resolves.toBe(false);
    await expect(hasMesaErpPermission({ organizationId, membershipId: grantorId, permission: permissionKey, legalEntityId: companyB })).resolves.toBe(false);
    await expect(hasAnyMesaErpCompanyAccess({ organizationId, membershipId: grantorId, legalEntityId: companyA })).resolves.toBe(false);
    await direct.role.update({ where: { id: companyRoleId }, data: { erpLegalEntityId: companyA } });

    await direct.role.update({ where: { id: companyRoleId }, data: { organizationId: otherOrganizationId } });
    await expect(hasMesaErpPermission({ organizationId, membershipId: grantorId, permission: permissionKey, legalEntityId: companyA })).resolves.toBe(false);
    await expect(hasAnyMesaErpCompanyAccess({ organizationId, membershipId: grantorId, legalEntityId: companyA })).resolves.toBe(false);
    await direct.role.update({ where: { id: companyRoleId }, data: { organizationId } });
  });

  it('requires a delegated permission and the grantor current exact-company authority', async () => {
    await expect(hasMesaErpPermission({ organizationId, membershipId: recipientId, permission: permissionKey, legalEntityId: companyA })).resolves.toBe(true);
    await expect(hasMesaErpPermission({ organizationId, membershipId: recipientId, permission: permissionKey, legalEntityId: companyB })).resolves.toBe(false);
    await direct.roleAssignment.updateMany({
      where: { organizationId, membershipId: grantorId, roleId: companyRoleId },
      data: { status: 'revoked', revokedAt: new Date(), revokedBy: 'test-checker', revocationReason: 'Regression test' },
    });
    await expect(hasMesaErpPermission({ organizationId, membershipId: recipientId, permission: permissionKey, legalEntityId: companyA })).resolves.toBe(false);
  });

  it('rejects a mismatched company assignment at the database boundary', async () => {
    await expect(direct.roleAssignment.create({ data: {
      organizationId, membershipId: recipientId, roleId: companyRoleId, serviceId: 'mesaerp', legalEntityId: companyB,
    } })).rejects.toThrow(/role and assignment company scopes must match exactly/);
  });
});
