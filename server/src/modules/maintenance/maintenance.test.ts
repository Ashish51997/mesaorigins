import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';

// Integration tests against a live Postgres (seeded demo tenant). No auth header
// → demo Administrator (can do everything).
const app = buildApp();
const uniq = () => Math.random().toString(36).slice(2, 8);

describe('maintenance slice', () => {
  it('lists the tenant machine registry', async () => {
    const r = await request(app).get('/api/machines');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body[0]).toHaveProperty('code');
  });

  it('registers a new machine and rejects duplicate codes', async () => {
    const code = `T${uniq().slice(0, 4).toUpperCase()}`;
    const add = await request(app).post('/api/machines').send({
      code, line: 'Test line', family: 'PVC', logbookFormat: 'QR/MFG/013', status: 'running',
    });
    expect(add.status).toBe(201);
    expect(add.body.code).toBe(code);
    expect(add.body.line).toBe('Test line');

    const dup = await request(app).post('/api/machines').send({
      code, line: 'Another line', family: 'LDPE',
    });
    expect(dup.status).toBe(409);
  });

  it('adds a maintenance task for a machine, then completes it', async () => {
    const machines = await request(app).get('/api/machines');
    const machine = machines.body[0];

    const add = await request(app).post('/api/maintenance').send({
      machineId: machine.id, taskName: `Bearing check ${uniq()}`, type: 'Preventive', frequency: 'Monthly', dueDate: '2026-09-15', cost: 200,
    });
    expect(add.status).toBe(201);
    expect(add.body.machine.code).toBe(machine.code); // task is linked to its machine
    expect(add.body.status).toBe('scheduled');

    const done = await request(app).post(`/api/maintenance/${add.body.id}/complete`);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('completed');
  });

  it('requires a machine (422 for missing, 422 for unknown)', async () => {
    const missing = await request(app).post('/api/maintenance').send({ taskName: 'x', dueDate: '2026-09-01' });
    expect(missing.status).toBe(422);
    const unknown = await request(app).post('/api/maintenance').send({ machineId: 'does-not-exist', taskName: 'x', dueDate: '2026-09-01' });
    expect(unknown.status).toBe(422);
  });

  it('denies a Sales Exec from the maintenance schedule (403)', async () => {
    const r = await request(app).get('/api/maintenance').set('x-dev-user', 'EMP-003');
    expect(r.status).toBe(403);
  });
});
