import express, { type Router } from 'express';
import { apiReference } from '@scalar/express-api-reference';
import { buildOpenApiSpec } from './spec';
import type { DiscoveredRoute } from './routes';

/**
 * Serves the API contract: the machine-readable spec at `/api/openapi.json` and
 * a browsable reference at `/api/docs`.
 *
 * The document is generated from the routes the caller hands in — the same ones
 * the server mounts — and cached after the first request, since the route table
 * is fixed once the process is up.
 */
export function createDocsRouter(getRoutes: () => DiscoveredRoute[]): Router {
  const router = express.Router();
  let spec: ReturnType<typeof buildOpenApiSpec> | undefined;
  const getSpec = () => (spec ??= buildOpenApiSpec(getRoutes()));

  router.get('/openapi.json', (_req, res) => { res.json(getSpec()); });

  router.use(
    '/docs',
    apiReference({
      url: '/api/openapi.json',
      pageTitle: 'MesaOrigins API',
      theme: 'default',
    }),
  );

  return router;
}
