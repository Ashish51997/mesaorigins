import { describe, expect, it } from 'vitest';
import { basePrisma, withTenant } from '../../db';
import { hashPassword, verifyPassword } from '../../lib/password';
import { tenantContext, type TenantCtx } from '../../lib/tenantContext';
import { createEmployee, setEmployeePassword } from './service';

describe('admin global identity safety', () => {
  it('preserves a reused identity and blocks organization password resets once it is shared', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const firstOrganizationId = `identity-first-org-${suffix}`;
    const secondOrganizationId = `identity-second-org-${suffix}`;
    const sharedUserId = `identity-shared-user-${suffix}`;
    const singleUserId = `identity-single-user-${suffix}`;
    const firstMembershipId = `identity-first-membership-${suffix}`;
    const singleMembershipId = `identity-single-membership-${suffix}`;
    const sharedEmail = `shared-identity-${suffix}@example.com`;
    const originalPassword = 'original-shared-password-99';
    const replacementPassword = 'replacement-password-99';
    const originalHash = await hashPassword(originalPassword);
    const singleOriginalHash = await hashPassword('single-original-password-99');

    const secondOrganizationContext: TenantCtx = {
      organizationId: secondOrganizationId,
      userId: `identity-actor-${suffix}`,
      membershipId: `identity-actor-membership-${suffix}`,
      role: 'Administrator',
      email: `identity-actor-${suffix}@example.com`,
    };

    try {
      await basePrisma.organization.createMany({
        data: [
          { id: firstOrganizationId, name: 'First Identity Organization', slug: firstOrganizationId },
          { id: secondOrganizationId, name: 'Second Identity Organization', slug: secondOrganizationId },
        ],
      });

      const secondOrganizationRole = await withTenant(secondOrganizationId, (tx) => tx.role.create({
        data: {
          organizationId: secondOrganizationId,
          name: `Identity Test Role ${suffix}`,
          screens: ['screen:users'],
          isAdmin: false,
          isSystem: false,
        },
      }));

      await basePrisma.user.createMany({
        data: [
          { id: sharedUserId, email: sharedEmail, name: 'Canonical Shared Name', passwordHash: originalHash },
          { id: singleUserId, email: `single-identity-${suffix}@example.com`, name: 'Single Organization User', passwordHash: singleOriginalHash },
        ],
      });
      await basePrisma.membership.createMany({
        data: [
          {
            id: firstMembershipId,
            organizationId: firstOrganizationId,
            userId: sharedUserId,
            employeeCode: `IDENTITY-FIRST-${suffix}`,
            department: 'Operations',
            role: 'Administrator',
          },
          {
            id: singleMembershipId,
            organizationId: secondOrganizationId,
            userId: singleUserId,
            employeeCode: `IDENTITY-SINGLE-${suffix}`,
            department: 'Operations',
            role: secondOrganizationRole.name,
            roleId: secondOrganizationRole.id,
          },
        ],
      });

      const secondMembership = await tenantContext.run(secondOrganizationContext, () => createEmployee({
        name: 'Attempted Organization-Specific Rename',
        email: sharedEmail,
        roleId: secondOrganizationRole.id,
        department: 'Sales',
      }));

      const reusedIdentity = await basePrisma.user.findUniqueOrThrow({ where: { id: sharedUserId } });
      expect(reusedIdentity.name).toBe('Canonical Shared Name');
      expect(reusedIdentity.passwordHash).toBe(originalHash);
      expect(secondMembership.user).toEqual({ name: 'Canonical Shared Name', email: sharedEmail });
      expect(await basePrisma.membership.count({ where: { userId: sharedUserId } })).toBe(2);

      await expect(tenantContext.run(secondOrganizationContext, () => setEmployeePassword(
        secondMembership.id,
        { password: replacementPassword },
      ))).rejects.toMatchObject({ status: 409, code: 'shared_identity_password' });

      const afterRejectedReset = await basePrisma.user.findUniqueOrThrow({ where: { id: sharedUserId } });
      expect(afterRejectedReset.passwordHash).toBe(originalHash);
      const rejectedAudits = await withTenant(secondOrganizationId, (tx) => tx.auditEvent.count({
        where: { action: 'employee.password_set', entityId: sharedUserId },
      }));
      expect(rejectedAudits).toBe(0);

      await expect(tenantContext.run(secondOrganizationContext, () => setEmployeePassword(
        firstMembershipId,
        { password: replacementPassword },
      ))).rejects.toMatchObject({ status: 404, code: 'not_found' });
      expect((await basePrisma.user.findUniqueOrThrow({ where: { id: sharedUserId } })).passwordHash).toBe(originalHash);

      await expect(tenantContext.run(secondOrganizationContext, () => setEmployeePassword(
        singleMembershipId,
        { password: replacementPassword },
      ))).resolves.toEqual({ ok: true });

      const updatedSingleIdentity = await basePrisma.user.findUniqueOrThrow({ where: { id: singleUserId } });
      expect(updatedSingleIdentity.passwordHash).not.toBe(singleOriginalHash);
      expect(await verifyPassword(replacementPassword, updatedSingleIdentity.passwordHash!)).toBe(true);

      const successAudit = await withTenant(secondOrganizationId, (tx) => tx.auditEvent.findFirst({
        where: { action: 'employee.password_set', entityId: singleUserId },
        orderBy: { at: 'desc' },
      }));
      expect(successAudit?.after).toEqual({ set: true, membershipId: singleMembershipId });
      expect(JSON.stringify(successAudit)).not.toContain(replacementPassword);
    } finally {
      await basePrisma.organization.deleteMany({
        where: { id: { in: [firstOrganizationId, secondOrganizationId] } },
      });
      await basePrisma.user.deleteMany({
        where: { id: { in: [sharedUserId, singleUserId] } },
      });
    }
  });
});
