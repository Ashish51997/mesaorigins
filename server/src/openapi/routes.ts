import type { Router, RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { BODY_SCHEMA } from '../middleware/validate';
import { REQUIRED_PERMISSION } from '../middleware/authz';

/** A route as it is actually mounted, with the guards attached to it. */
export interface DiscoveredRoute {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  /** Express-style path, e.g. `/api/employees/:id/grants`. */
  path: string;
  /** Feature key from `requirePermission`, if the route is gated. */
  permission?: string;
  /** Zod schema from `validateBody`, if the route validates a body. */
  bodySchema?: ZodTypeAny;
}

const METHODS = new Set(['get', 'post', 'patch', 'put', 'delete']);

// Express hides the mount path of a sub-router inside the layer's compiled
// regexp. `fast_slash` means it was mounted at '/', which is the case for every
// module router here; anything else we recover from the regexp source.
function mountPathOf(layer: { regexp?: RegExp & { fast_slash?: boolean } }): string {
  const re = layer.regexp;
  if (!re || re.fast_slash) return '';
  const literal = re.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\?\/\|\$\)$/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/');
  return /^[/\w-]*$/.test(literal) ? literal : '';
}

function joinPath(prefix: string, path: string): string {
  const joined = `${prefix}${path === '/' ? '' : path}`;
  return joined.startsWith('/') ? joined : `/${joined}`;
}

/**
 * Walks a mounted Express router and returns every route on it, together with
 * the permission key and body schema its middleware carry. This is the single
 * source of truth for the OpenAPI document: a route cannot exist in the server
 * without appearing here.
 */
export function collectRoutes(router: Router, prefix = ''): DiscoveredRoute[] {
  const out: DiscoveredRoute[] = [];

  const stack = (router as unknown as { stack?: unknown[] }).stack ?? [];
  for (const entry of stack) {
    const layer = entry as {
      route?: {
        path: string | string[];
        methods?: Record<string, boolean>;
        stack: { method?: string; handle: RequestHandler }[];
      };
      handle?: Router & { stack?: unknown[] };
      regexp?: RegExp & { fast_slash?: boolean };
    };

    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      let permission: string | undefined;
      let bodySchema: ZodTypeAny | undefined;

      // Every handler layer of a route repeats the route's method, so take the
      // methods from the route itself and only mine the layers for metadata.
      for (const handlerLayer of layer.route.stack) {
        const handle = handlerLayer.handle as RequestHandler & {
          [REQUIRED_PERMISSION]?: string;
          [BODY_SCHEMA]?: ZodTypeAny;
        };
        permission ??= handle[REQUIRED_PERMISSION];
        bodySchema ??= handle[BODY_SCHEMA];
      }

      const methods = Object.entries(layer.route.methods ?? {})
        .filter(([method, enabled]) => enabled && METHODS.has(method))
        .map(([method]) => method);

      for (const path of paths) {
        for (const method of methods) {
          out.push({ method: method as DiscoveredRoute['method'], path: joinPath(prefix, path), permission, bodySchema });
        }
      }
      continue;
    }

    if (layer.handle && Array.isArray(layer.handle.stack)) {
      out.push(...collectRoutes(layer.handle, `${prefix}${mountPathOf(layer)}`));
    }
  }

  return out;
}

/** `/employees/:id/grants` → `/employees/{id}/grants` */
export function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** Names of the `:params` in an Express path, in order. */
export function pathParamsOf(expressPath: string): string[] {
  return [...expressPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}
