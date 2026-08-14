import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUserContext } from '../../lib/authContext';
import { errorHandler } from '../../middleware/error';
import { resolveTenant } from '../../middleware/tenant';
import { createMesaErpHandoffTdsRouter, MESAERP_HANDOFF_PERMISSION } from '../handoffTdsRouter';

function buildApp(allowed = false) {
  const handoff = {
    hasPermission: vi.fn(async (input: { legalEntityId: string; permission: string }) => (
      allowed && input.legalEntityId === 'company-a' && input.permission === MESAERP_HANDOFF_PERMISSION
    )),
    approveMapping: vi.fn(async (
      legalEntityId: string,
      mappingId: string,
      body: { expectedRowVersion: number; reason: string },
      idempotencyKey: string,
    ) => ({ id: mappingId, legalEntityId, ...body, idempotencyKey, status: 'approved', active: true, rowVersion: body.expectedRowVersion + 1 })),
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const organization = {
      organizationId: 'org-a', organizationName: 'Org A', organizationSlug: 'org-a',
      membershipId: req.header('x-test-member') || 'maker-a', employeeCode: 'EMP-1',
      role: req.header('x-test-admin') === '1' ? 'Administrator' : 'ERP User',
      isAdmin: req.header('x-test-admin') === '1', screens: ['legacy-admin'],
      services: [{ id: 'mesaerp', name: 'MesaERP', description: '', status: 'active', sortOrder: 30 }],
    };
    req.user = {
      userId: `user-${organization.membershipId}`,
      email: `${organization.membershipId}@example.test`,
      name: organization.membershipId,
      ...organization,
      organizations: [organization],
    } satisfies AuthenticatedUserContext;
    next();
  });
  app.use(resolveTenant);
  app.use('/api/mesaerp/v1', createMesaErpHandoffTdsRouter(handoff as never));
  app.use(errorHandler);
  return { app, handoff };
}

describe('MesaERP handoff mapping approval API', () => {
  it('is default-deny even for a legacy administrator', async () => {
    const { app, handoff } = buildApp(false);
    const response = await request(app)
      .post('/api/mesaerp/v1/entities/company-a/handoff-mappings/map-1/approve')
      .set('x-test-admin', '1')
      .set('Idempotency-Key', 'mapping-approval-denied')
      .send({ expectedRowVersion: 0, reason: 'Reviewed mapping evidence' });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toContain(MESAERP_HANDOFF_PERMISSION);
    expect(handoff.approveMapping).not.toHaveBeenCalled();
  });

  it('validates the checker evidence and forwards the idempotent approval contract', async () => {
    const { app, handoff } = buildApp(true);
    const invalid = await request(app)
      .post('/api/mesaerp/v1/entities/company-a/handoff-mappings/map-1/approve')
      .set('Idempotency-Key', 'mapping-approval-invalid')
      .send({ expectedRowVersion: 0, reason: '' });
    expect(invalid.status).toBe(422);
    expect(handoff.approveMapping).not.toHaveBeenCalled();

    const missingKey = await request(app)
      .post('/api/mesaerp/v1/entities/company-a/handoff-mappings/map-1/approve')
      .send({ expectedRowVersion: 4, reason: 'Reviewed mapping evidence' });
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe('idempotency_key_required');

    const approved = await request(app)
      .post('/api/mesaerp/v1/entities/company-a/handoff-mappings/map-1/approve')
      .set('x-test-member', 'checker-b')
      .set('Idempotency-Key', 'mapping-approval-accepted')
      .send({ expectedRowVersion: 4, reason: 'Reviewed mapping evidence' });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ id: 'map-1', status: 'approved', active: true, rowVersion: 5 });
    expect(handoff.approveMapping).toHaveBeenCalledWith(
      'company-a',
      'map-1',
      { expectedRowVersion: 4, reason: 'Reviewed mapping evidence' },
      'mapping-approval-accepted',
    );
  });
});
