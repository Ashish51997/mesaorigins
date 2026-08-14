import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { withTenant } from '../../db';
import { canonicalHash } from '../../lib/canonical';

// No auth header → demo Administrator (can manage everything).
const app = buildApp();
const uniq = () => Math.random().toString(36).slice(2, 7);

describe('admin slice', () => {
  it('lists employees + roles and denies a non-admin', async () => {
    const emp = await request(app).get('/api/employees');
    expect(emp.status).toBe(200);
    expect(emp.body.length).toBeGreaterThan(10);
    const roles = await request(app).get('/api/roles');
    expect(roles.status).toBe(200);
    expect((roles.body as Array<{ name: string }>).some((r) => r.name === 'Operator')).toBe(true);
    // An Operator cannot open the People screen.
    expect((await request(app).get('/api/employees').set('x-dev-user', 'EMP-007')).status).toBe(403);
  });

  it('creates a custom role + employee and enforces access end-to-end', async () => {
    // Custom role: may see roll_queue/holds, NOT formulations.
    const role = await request(app).post('/api/roles').send({ name: `Floor Lead ${uniq()}`, screens: ['roll_queue', 'holds'] });
    expect(role.status).toBe(201);

    const emp = await request(app).post('/api/employees').send({ name: 'Test Lead', email: `lead.${uniq()}@masspolymer.in`, roleId: role.body.id });
    expect(emp.status).toBe(201);
    expect(emp.body.employeeCode).toMatch(/^EMP-\d+$/);
    const code = emp.body.employeeCode;

    // Enforced from the DB role: 200 on an in-role screen, 403 on one that isn't.
    expect((await request(app).get('/api/quality/queue').set('x-dev-user', code)).status).toBe(200);
    expect((await request(app).get('/api/formulations').set('x-dev-user', code)).status).toBe(403);

    // Per-employee override: grant formulations → now allowed for this one person.
    const g = await request(app).put(`/api/employees/${emp.body.id}/grants`).send({ grants: [{ screen: 'formulations', state: 'on' }] });
    expect(g.status).toBe(200);
    expect((await request(app).get('/api/formulations').set('x-dev-user', code)).status).toBe(200);

    // /me/permissions reflects the effective set.
    const me = await request(app).get('/api/me/permissions').set('x-dev-user', code);
    expect(me.body.screens).toContain('formulations');
    expect(me.body.screens).toContain('roll_queue');
    expect(me.body.isAdmin).toBe(false);
  });

  it('reassigning an employee to another role changes their access', async () => {
    const emp = await request(app).post('/api/employees').send({ name: 'Mover', email: `mover.${uniq()}@masspolymer.in`, roleId: (await roleId('Operator')) });
    const code = emp.body.employeeCode;
    expect((await request(app).get('/api/formulations').set('x-dev-user', code)).status).toBe(403); // Operator can't
    await request(app).patch(`/api/employees/${emp.body.id}`).send({ roleId: await roleId('Production Planner') });
    expect((await request(app).get('/api/formulations').set('x-dev-user', code)).status).toBe(200); // Planner can
  });

  it('blocks deleting a built-in role; allows an empty custom one', async () => {
    const roles = (await request(app).get('/api/roles')).body as Array<{ id: string; name: string; isSystem: boolean }>;
    const builtin = roles.find((r) => r.isSystem)!;
    expect((await request(app).delete(`/api/roles/${builtin.id}`)).status).toBe(409);
    const plantScope = roles.find((r) => r.name === 'MesaOps Plant Access')!;
    expect(plantScope.isSystem).toBe(true);
    expect((await request(app).patch(`/api/roles/${plantScope.id}`).send({ screens: ['machines'] })).status).toBe(409);
    expect((await request(app).post('/api/employees').send({
      name: 'Invalid scope-role employee', email: `scope-role.${uniq()}@masspolymer.in`, roleId: plantScope.id,
    })).status).toBe(409);
    expect((await request(app).post('/api/roles').send({ name: 'MesaOps Plant Access', screens: [] })).status).toBe(409);
    const tmp = await request(app).post('/api/roles').send({ name: `Temp ${uniq()}`, screens: [] });
    expect((await request(app).delete(`/api/roles/${tmp.body.id}`)).status).toBe(200);
  });

  it('administers only idempotent, versioned MesaOps plant assignments', async () => {
    const me = (await request(app).get('/api/me')).body.user as { organizationId: string; membershipId: string };
    const suffix = uniq();
    const role = await request(app).post('/api/roles').send({
      name: `Scoped Operator ${suffix}`,
      screens: ['tasks', 'logbook', 'roll_queue', 'inventory'],
    });
    expect(role.status).toBe(201);
    const employee = await request(app).post('/api/employees').send({
      name: `Scoped Operator ${suffix}`,
      email: `scoped.${suffix}@masspolymer.in`,
      roleId: role.body.id,
    });
    expect(employee.status).toBe(201);

    const body = { membershipId: employee.body.id, roleId: role.body.id, plantCode: 'plant-a' };
    expect((await request(app).post('/api/mesaops/role-assignments').send(body)).status).toBe(400);
    expect((await request(app).post('/api/mesaops/role-assignments')
      .set('Idempotency-Key', `scope-service-${suffix}`)
      .send({ ...body, serviceId: 'mesaerp' })).status).toBe(422);

    const createKey = `scope-create-${suffix}`;
    const created = await request(app).post('/api/mesaops/role-assignments')
      .set('Idempotency-Key', createKey)
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      organizationId: me.organizationId,
      membershipId: employee.body.id,
      roleId: role.body.id,
      serviceId: 'mesaops',
      legalEntityId: null,
      plantCode: 'PLANT-A',
      warehouseId: null,
      status: 'active',
      rowVersion: 0,
    });

    const replay = await request(app).post('/api/mesaops/role-assignments')
      .set('Idempotency-Key', createKey)
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(created.body.id);
    const conflict = await request(app).post('/api/mesaops/role-assignments')
      .set('Idempotency-Key', createKey)
      .send({ ...body, plantCode: 'PLANT-B' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('idempotency_conflict');

    const erpAssignment = await withTenant(me.organizationId, (tx) => tx.roleAssignment.findFirst({
      where: { serviceId: 'mesaerp', status: 'active' },
      include: { role: true },
    }));
    expect(erpAssignment).toBeTruthy();
    expect((await request(app).patch(`/api/roles/${erpAssignment!.roleId}`).send({ name: `Forged ERP role ${suffix}` })).body.error.code)
      .toBe('mesaerp_role_forbidden');
    expect((await request(app).delete(`/api/roles/${erpAssignment!.roleId}`)).body.error.code)
      .toBe('mesaerp_role_forbidden');
    const erpRoleAttempt = await request(app).post('/api/mesaops/role-assignments')
      .set('Idempotency-Key', `scope-erp-role-${suffix}`)
      .send({ membershipId: employee.body.id, roleId: erpAssignment!.roleId, plantCode: 'PLANT-A' });
    expect(erpRoleAttempt.status).toBe(409);
    expect(erpRoleAttempt.body.error.code).toBe('mesaerp_role_forbidden');

    const hiddenErpRevoke = await request(app).post(`/api/mesaops/role-assignments/${erpAssignment!.id}/revoke`)
      .set('Idempotency-Key', `scope-erp-revoke-${suffix}`)
      .send({ expectedVersion: erpAssignment!.rowVersion, reason: 'Must remain ERP-owned' });
    expect(hiddenErpRevoke.status).toBe(404);

    const stale = await request(app).post(`/api/mesaops/role-assignments/${created.body.id}/revoke`)
      .set('Idempotency-Key', `scope-stale-${suffix}`)
      .send({ expectedVersion: 99, reason: 'Stale administrator view' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');

    const revokeKey = `scope-revoke-${suffix}`;
    const revoked = await request(app).post(`/api/mesaops/role-assignments/${created.body.id}/revoke`)
      .set('Idempotency-Key', revokeKey)
      .send({ expectedVersion: 0, reason: 'Plant assignment ended' });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({ status: 'revoked', rowVersion: 1, revokedBy: me.membershipId });
    const revokeReplay = await request(app).post(`/api/mesaops/role-assignments/${created.body.id}/revoke`)
      .set('Idempotency-Key', revokeKey)
      .send({ expectedVersion: 0, reason: 'Plant assignment ended' });
    expect(revokeReplay.status).toBe(200);
    expect(revokeReplay.body.id).toBe(created.body.id);

    const evidence = await withTenant(me.organizationId, (tx) => tx.auditEvent.findMany({
      where: { entity: 'RoleAssignment', entityId: created.body.id },
      orderBy: { at: 'asc' },
    }));
    expect(evidence.map((event) => event.action)).toEqual([
      'mesaops.role_assignment.create',
      'mesaops.role_assignment.revoke',
    ]);

    // Moving the employee off the custom role removes ordinary role usage, but
    // the revoked plant-scope assignment remains security history. Deleting the
    // role must not cascade that row and erase the explicit scope history.
    const reassigned = await request(app).patch(`/api/employees/${employee.body.id}`).send({ roleId: await roleId('Operator') });
    expect(reassigned.status).toBe(200);
    const deleteScopedRole = await request(app).delete(`/api/roles/${role.body.id}`);
    expect(deleteScopedRole.status).toBe(409);
    expect(deleteScopedRole.body.error.code).toBe('role_scope_history_retained');
    const retainedAssignment = await withTenant(me.organizationId, (tx) => tx.roleAssignment.findUnique({ where: { id: created.body.id } }));
    expect(retainedAssignment).toMatchObject({ status: 'revoked', roleId: role.body.id });
  });

  it('administers immutable MesaOps statutory rules with exact access, idempotency, CAS and maker-checker', async () => {
    const suffix = `${Date.now()}-${uniq()}`;
    const sourceEvidence = { reviewedBy: 'statutory-counsel-fixture', capturedAt: '2026-08-14T10:00:00.000Z', scope: 'India PRIMARY supply' };
    const body = {
      version: `IN-${suffix}`,
      countryCode: 'IN',
      plantCode: `STAT-${uniq()}`.toUpperCase(),
      movementType: 'supply',
      effectiveFrom: '2090-04-01',
      effectiveTo: '2091-03-31',
      requiresInvoice: true,
      requiresEWayBill: true,
      reviewedExemptionReason: '',
      sourceReference: `statutory-review:${suffix}`,
      sourceEvidence,
      sourceChecksum: canonicalHash(sourceEvidence),
    };

    const denied = await request(app).get('/api/mesaops/admin/statutory-rule-profiles').set('x-dev-user', 'EMP-007');
    expect(denied.status).toBe(403);
    expect((await request(app).post('/api/mesaops/admin/statutory-rule-profiles').set('x-dev-user', 'EMP-002').send(body)).status).toBe(400);

    const key = `stat-profile-${suffix}`;
    const created = await request(app).post('/api/mesaops/admin/statutory-rule-profiles')
      .set('x-dev-user', 'EMP-002')
      .set('Idempotency-Key', key)
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      version: body.version,
      status: 'draft',
      plantCode: body.plantCode,
      movementType: 'supply',
      rowVersion: 0,
    });
    const replay = await request(app).post('/api/mesaops/admin/statutory-rule-profiles')
      .set('x-dev-user', 'EMP-002')
      .set('Idempotency-Key', key)
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(created.body.id);
    const conflict = await request(app).post('/api/mesaops/admin/statutory-rule-profiles')
      .set('x-dev-user', 'EMP-002')
      .set('Idempotency-Key', key)
      .send({ ...body, version: `${body.version}-changed` });
    expect(conflict.body.error.code).toBe('idempotency_conflict');

    const selfApproval = await request(app).post(`/api/mesaops/admin/statutory-rule-profiles/${created.body.id}/approve`)
      .set('x-dev-user', 'EMP-002')
      .set('Idempotency-Key', `stat-self-${suffix}`)
      .send({ expectedRowVersion: 0, approvalNote: 'Independent review complete' });
    expect(selfApproval.status).toBe(409);
    expect(selfApproval.body.error.code).toBe('maker_checker_required');
    const stale = await request(app).post(`/api/mesaops/admin/statutory-rule-profiles/${created.body.id}/approve`)
      .set('x-dev-user', 'EMP-020')
      .set('Idempotency-Key', `stat-stale-${suffix}`)
      .send({ expectedRowVersion: 99, approvalNote: 'Independent review complete' });
    expect(stale.body.error.code).toBe('version_conflict');
    const approved = await request(app).post(`/api/mesaops/admin/statutory-rule-profiles/${created.body.id}/approve`)
      .set('x-dev-user', 'EMP-020')
      .set('Idempotency-Key', `stat-approve-${suffix}`)
      .send({ expectedRowVersion: 0, approvalNote: 'Independent review complete' });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'approved', rowVersion: 1 });
    expect(approved.body.approvedBy).not.toBe(approved.body.createdBy);

    const listed = await request(app).get('/api/mesaops/admin/statutory-rule-profiles').set('x-dev-user', 'EMP-020');
    expect(listed.status).toBe(200);
    expect((listed.body as Array<{ id: string }>).some((row) => row.id === created.body.id)).toBe(true);

    await expect(withTenant('org-demo', (tx) => tx.mesaOpsStatutoryRuleProfile.update({
      where: { id: created.body.id },
      data: { requiresEWayBill: false, rowVersion: { increment: 1 } },
    }))).rejects.toThrow(/immutable/i);
  });

  async function roleId(name: string): Promise<string> {
    const roles = (await request(app).get('/api/roles')).body as Array<{ id: string; name: string }>;
    return roles.find((r) => r.name === name)!.id;
  }
});
