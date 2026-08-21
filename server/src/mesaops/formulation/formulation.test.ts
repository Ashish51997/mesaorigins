import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';

// Integration tests against a live Postgres (seeded demo tenant). No auth header
// → demo Administrator (can do everything).
const app = buildApp();
const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase();

interface Formula { id: string; code: string; rev: number; active: boolean; locked: boolean; components: Array<{ name: string; pct: number }>; }

describe('formulation slice', () => {
  it('lists the seeded formulations with their revisions and lock state', async () => {
    const r = await request(app).get('/api/mesaops/v1/formulations');
    expect(r.status).toBe(200);
    const rows = r.body as Formula[];
    const rf03 = rows.filter((f) => f.code === 'RF03');
    expect(rf03.length).toBeGreaterThanOrEqual(2);
    expect(rf03.find((f) => f.rev === 1)?.locked).toBe(true);   // locked by a CAPA
    expect(rf03.find((f) => f.rev === 2)?.active).toBe(true);   // latest is active
  });

  it('adds a formulation, then a new revision supersedes the prior active one', async () => {
    const code = `TF${uniq()}`;
    const first = await request(app).post('/api/mesaops/v1/formulations').send({
      code, product: 'Test PVC compound',
      components: [{ name: 'PVC resin', pct: 80 }, { name: 'CaCO3', pct: 20, lotId: 'L-1' }],
    });
    expect(first.status).toBe(201);
    expect(first.body.rev).toBe(1);
    expect(first.body.active).toBe(true);

    const second = await request(app).post('/api/mesaops/v1/formulations').send({
      code, product: 'Test PVC compound', components: [{ name: 'PVC resin', pct: 82 }, { name: 'CaCO3', pct: 18 }],
    });
    expect(second.status).toBe(201);
    expect(second.body.rev).toBe(2);
    expect(second.body.active).toBe(true);

    // Rev 1 has been retired now that Rev 2 is the active revision.
    const rows = (await request(app).get('/api/mesaops/v1/formulations')).body as Formula[];
    expect(rows.find((f) => f.code === code && f.rev === 1)?.active).toBe(false);
  });

  it('edits a revision, and refuses to edit a locked one (409)', async () => {
    const rows = (await request(app).get('/api/mesaops/v1/formulations')).body as Formula[];

    const editable = rows.find((f) => f.code === 'RF03' && f.rev === 2)!;
    const ok = await request(app).patch(`/api/mesaops/v1/formulations/${editable.id}`)
      .send({ components: [{ name: 'RPVC resin', pct: 81 }, { name: 'CaCO3 filler', pct: 13 }, { name: 'Stabilizer', pct: 6 }] });
    expect(ok.status).toBe(200);
    expect(ok.body.components[0].pct).toBe(81);

    const locked = rows.find((f) => f.code === 'RF03' && f.rev === 1)!;
    const blocked = await request(app).patch(`/api/mesaops/v1/formulations/${locked.id}`).send({ product: 'nope' });
    expect(blocked.status).toBe(409);
  });

  it('denies an Operator from the formulations board (403)', async () => {
    const r = await request(app).get('/api/mesaops/v1/formulations').set('x-dev-user', 'EMP-007');
    expect(r.status).toBe(403);
  });

  it('grants the Owner role full access across every gated screen', async () => {
    // Screens gated to different roles — an Operator is blocked from all of these.
    const gated = ['/formulations', '/plans', '/planning/orders', '/complaints', '/employees', '/dispatches'];
    const owner = await Promise.all(gated.map((p) => request(app).get(`/api${p}`).set('x-dev-user', 'EMP-019').then((r) => [p, r.status] as const)));
    expect(owner.filter(([, s]) => s !== 200)).toEqual([]); // Owner (EMP-019) passes them all

    // Contrast: the Operator is forbidden from the same set.
    const operator = await Promise.all(gated.map((p) => request(app).get(`/api${p}`).set('x-dev-user', 'EMP-007').then((r) => r.status)));
    expect(operator.every((s) => s === 403)).toBe(true);
  });
});
