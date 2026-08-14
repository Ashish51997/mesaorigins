import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp, discoverRoutes } from '../app';
import { ROUTE_DOCS } from './metadata';
import { buildOpenApiSpec, routeKey } from './spec';
import { toOpenApiPath } from './routes';
import { isKnownModel, scalarFieldsOf } from './models';

const routes = discoverRoutes();
const spec = buildOpenApiSpec(routes) as {
  paths: Record<string, Record<string, {
    operationId: string;
    tags: string[];
    responses: Record<string, unknown>;
    parameters?: Array<{ name: string; in: string; required: boolean }>;
  }>>;
  tags: { name: string }[];
  components: { schemas: Record<string, unknown> };
};

describe('openapi document', () => {
  it('discovers the whole route table', () => {
    expect(routes.length).toBeGreaterThan(60);
  });

  // The guard that keeps metadata.ts honest: add a route, document it.
  it('documents every mounted route', () => {
    const undocumented = routes.map(routeKey).filter((key) => !ROUTE_DOCS[key]);
    expect(undocumented, `Add these to server/src/openapi/metadata.ts:\n${undocumented.join('\n')}`).toEqual([]);
  });

  it('has no documentation for routes that no longer exist', () => {
    const mounted = new Set(routes.map(routeKey));
    const stale = Object.keys(ROUTE_DOCS).filter((key) => !mounted.has(key));
    expect(stale, `Remove these from server/src/openapi/metadata.ts:\n${stale.join('\n')}`).toEqual([]);
  });

  it('gives every operation a unique operationId', () => {
    const ids = Object.values(spec.paths).flatMap((methods) => Object.values(methods).map((op) => op.operationId));
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('files every operation under a declared tag', () => {
    const declared = new Set(spec.tags.map((t) => t.name));
    const used = Object.values(spec.paths).flatMap((methods) => Object.values(methods).flatMap((op) => op.tags));
    expect([...new Set(used)].filter((t) => !declared.has(t))).toEqual([]);
  });

  it('emits an operation for each discovered route', () => {
    for (const route of routes) {
      expect(spec.paths[toOpenApiPath(route.path)]?.[route.method], routeKey(route)).toBeDefined();
    }
  });

  it('does not publish the retired shared data document', () => {
    expect(routes.some((route) => route.path === '/api/data')).toBe(false);
    expect(spec.paths['/api/data']).toBeUndefined();
    expect(spec.tags.map((tag) => tag.name)).not.toContain('Legacy');
  });

  it('references only real Prisma models and fields', () => {
    for (const [key, doc] of Object.entries(ROUTE_DOCS)) {
      if (!doc.responseModel) continue;
      expect(isKnownModel(doc.responseModel), `${key} → ${doc.responseModel}`).toBe(true);
      const fields = scalarFieldsOf(doc.responseModel);
      for (const field of doc.responseFields ?? []) {
        expect(fields, `${key} → ${doc.responseModel}.${field}`).toContain(field);
      }
    }
  });

  it('documents the error envelope on every operation', () => {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        expect(Object.keys(op.responses), `${method.toUpperCase()} ${path}`).toContain('500');
      }
    }
  });

  it('describes a 403 wherever a permission is enforced', () => {
    for (const route of routes.filter((r) => r.permission)) {
      const op = spec.paths[toOpenApiPath(route.path)][route.method];
      expect(Object.keys(op.responses), routeKey(route)).toContain('403');
    }
  });

  it('describes a 422 wherever a body is validated', () => {
    for (const route of routes.filter((r) => r.bodySchema)) {
      const op = spec.paths[toOpenApiPath(route.path)][route.method];
      expect(Object.keys(op.responses), routeKey(route)).toContain('422');
    }
  });

  it('marks every documented idempotency key as a required request header', () => {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const idempotency = operation.parameters?.find((parameter) => (
          parameter.in === 'header' && parameter.name.toLowerCase() === 'idempotency-key'
        ));
        if (idempotency) {
          expect(idempotency.required, `${method.toUpperCase()} ${path}`).toBe(true);
        }
      }
    }
  });
});

describe('docs endpoints', () => {
  const app = buildApp();

  it('serves the spec without a credential', async () => {
    const r = await request(app).get('/api/openapi.json');
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe('3.1.0');
    expect(r.body.info.title).toBe('Mesadesk API');
    const served = Object.values(r.body.paths as Record<string, object>).flatMap((methods) => Object.keys(methods));
    expect(served.length).toBe(routes.length);
  });

  it('serves the reference UI', async () => {
    const r = await request(app).get('/api/docs');
    expect(r.status).toBe(200);
    expect(r.text).toContain('/api/openapi.json');
  });

  it('does not shadow the real API 404 for unknown paths', async () => {
    const r = await request(app).get('/api/docs-not-a-route');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
  });
});
