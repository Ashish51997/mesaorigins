import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';

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
    const roles = (await request(app).get('/api/roles')).body as Array<{ id: string; isSystem: boolean }>;
    const builtin = roles.find((r) => r.isSystem)!;
    expect((await request(app).delete(`/api/roles/${builtin.id}`)).status).toBe(409);
    const tmp = await request(app).post('/api/roles').send({ name: `Temp ${uniq()}`, screens: [] });
    expect((await request(app).delete(`/api/roles/${tmp.body.id}`)).status).toBe(200);
  });

  async function roleId(name: string): Promise<string> {
    const roles = (await request(app).get('/api/roles')).body as Array<{ id: string; name: string }>;
    return roles.find((r) => r.name === name)!.id;
  }
});
