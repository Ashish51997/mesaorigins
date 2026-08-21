import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import { pathParamsOf, toOpenApiPath, type DiscoveredRoute } from './routes';
import { ROUTE_DOCS, TAGS, type RouteDoc } from './metadata';
import { buildModelSchemas, relationSchema } from './models';

type JsonSchema = Record<string, unknown>;

export const routeKey = (route: Pick<DiscoveredRoute, 'method' | 'path'>): string =>
  `${route.method.toUpperCase()} ${route.path}`;

const ERROR_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'The envelope every failure is returned in.',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', description: 'Stable machine-readable code. Branch on this, not on the message.' },
        message: { type: 'string', description: 'Human-readable explanation, safe to surface in a UI.' },
        details: { description: 'Optional context. For `validation` this is the Zod field-error map.' },
      },
    },
  },
};

function errorResponse(description: string): JsonSchema {
  return { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
}

/** Group the route's documented failures into one response per status code. */
function domainErrorResponses(doc: RouteDoc): Record<string, JsonSchema> {
  const byStatus = new Map<number, string[]>();
  for (const err of doc.errors ?? []) {
    const list = byStatus.get(err.status) ?? [];
    list.push(`\`${err.code}\` — ${err.when}`);
    byStatus.set(err.status, list);
  }
  const out: Record<string, JsonSchema> = {};
  for (const [status, lines] of byStatus) {
    out[String(status)] = errorResponse(lines.map((l) => `- ${l}`).join('\n'));
  }
  return out;
}

function successSchema(doc: RouteDoc): JsonSchema | undefined {
  if (doc.responseSchema) return doc.responseSchema;
  if (!doc.responseModel) return undefined;

  let schema: JsonSchema = { $ref: `#/components/schemas/${doc.responseModel}` };

  if (doc.responseFields?.length) {
    // The service uses a `select`, so pick those columns off the model schema
    // rather than promising the whole record.
    const modelProps = (buildModelSchemas()[doc.responseModel]?.properties ?? {}) as Record<string, JsonSchema>;
    schema = {
      type: 'object',
      description: `A subset of ${doc.responseModel}.`,
      properties: Object.fromEntries(doc.responseFields.map((f) => [f, modelProps[f] ?? {}])),
    };
  } else if (doc.responseIncludes?.length) {
    schema = {
      allOf: [
        { $ref: `#/components/schemas/${doc.responseModel}` },
        {
          type: 'object',
          properties: Object.fromEntries(
            doc.responseIncludes.map((rel) => [rel, relationSchema(doc.responseModel as string, rel)]),
          ),
        },
      ],
    };
  }

  if (doc.responseIsArray) schema = { type: 'array', items: schema };
  if (doc.responseNullable) schema = { oneOf: [schema, { type: 'null' }] };
  return schema;
}

/**
 * The Zod schema that guards the route, as JSON Schema. Draft-07 output is used
 * rather than the library's `openApi3` target because OpenAPI 3.1 schemas are
 * JSON Schema; the `$schema` key is the one thing that does not belong inline.
 */
function bodyJsonSchema(schema: ZodTypeAny): JsonSchema {
  const { $schema, ...rest } = zodToJsonSchema(schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as JsonSchema & { $schema?: string };
  return rest;
}

function serviceTagForPath(path: string): string {
  if (path.startsWith('/api/mesaops/')) return 'MesaOps';
  if (path.startsWith('/api/mesaerp/')) return 'MesaERP';
  if (path.startsWith('/api/mesaleads') || path.startsWith('/api/public/mesaleads')) return 'MesaLeads';
  if (path.startsWith('/api/supplier-portal/')) return 'Supplier Portal';
  return 'Platform';
}

function operationFor(route: DiscoveredRoute, doc: RouteDoc): JsonSchema {
  const responses: Record<string, JsonSchema> = {};

  const schema = successSchema(doc);
  responses[String(doc.status ?? 200)] = {
    description: doc.responseDescription,
    ...(schema ? { content: { 'application/json': { schema } } } : {}),
  };

  if (route.bodySchema) {
    responses['422'] = errorResponse('`validation` — the body failed schema validation. `error.details` carries the field errors.');
  }
  if (!doc.public) {
    responses['401'] = errorResponse('`unauthenticated` — no usable credential, or no membership resolved for it.');
  }
  if (route.permission) {
    responses['403'] = errorResponse(`\`forbidden\` — the caller's role does not hold \`${route.permission}\`.`);
  }
  Object.assign(responses, domainErrorResponses(doc));
  responses['500'] = errorResponse('`internal` — unhandled server error.');

  const parameters: JsonSchema[] = pathParamsOf(route.path).map((name) => ({
    name,
    in: 'path',
    required: true,
    description: doc.params?.[name] ?? `${name} path parameter.`,
    schema: { type: 'string' },
  }));

  for (const [name, query] of Object.entries(doc.query ?? {})) {
    parameters.push({
      name,
      in: 'query',
      required: query.required ?? false,
      description: query.description,
      schema: query.schema ?? { type: 'string' },
    });
  }

  for (const [name, headerDescription] of Object.entries(doc.headers ?? {})) {
    parameters.push({
      name,
      in: 'header',
      // Every documented Idempotency-Key corresponds to a runtime guard. Keep
      // generated clients honest instead of advertising a required write
      // contract as an optional parameter.
      required: name.toLowerCase() === 'idempotency-key',
      description: headerDescription,
      schema: { type: 'string' },
    });
  }

  if (!doc.public) {
    parameters.push({
      name: 'x-org',
      in: 'header',
      required: false,
      description: 'Select one of the authenticated user\'s non-inactive organization memberships by id or slug. Foreign selections fail closed.',
      schema: { type: 'string' },
    });
  }

  const description = [
    doc.description,
    route.permission ? `**Requires permission:** \`${route.permission}\`` : undefined,
  ].filter(Boolean).join('\n\n');

  const serviceTag = serviceTagForPath(route.path);
  const tags = serviceTag === doc.tag ? [doc.tag] : [serviceTag, doc.tag];

  return {
    tags,
    operationId: doc.operationId,
    summary: doc.summary,
    ...(description ? { description } : {}),
    ...(doc.deprecated ? { deprecated: true } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(route.bodySchema
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: bodyJsonSchema(route.bodySchema) } },
          },
        }
      : {}),
    // A public route opts out of the document-wide security requirement.
    ...(doc.public ? { security: [] } : {}),
    responses,
  };
}

const INTRO = `
REST API for MesaOrigins: the manufacturing value chain from customer
inquiry through order, production plan, shift logbook, quality inspection,
finished-goods stock and dispatch, plus the complaint/CAPA loop that closes
back onto it.

**This document is generated from the running server.** Paths, methods, request
bodies, authentication and the permission each route is gated on are read from
the live Express router stack and the Zod schemas that validate the requests, so
they cannot drift from what is enforced.

### Conventions

- Base path \`/api\`. Request and response bodies are JSON.
- Every failure uses the same envelope: \`{ "error": { "code", "message", "details?" } }\`.
  Branch on \`error.code\`, which is stable; \`message\` is for humans.
- Writes are validated with Zod and return \`422\` with a field-level error map on failure.
- Lifecycle transitions are their own endpoints (\`/orders/{id}/cancel\`,
  \`/logbooks/{id}/submit\`, \`/capas/{id}/close\`) and are transactional where they
  touch several tables.
- Every request is scoped to the caller's organization; there is no way to read
  or write another tenant's rows.
- Response schemas come from the Prisma datamodel. Where an endpoint includes a
  relation, the nested object may carry only the fields that endpoint selects.

### Authorization

Authentication establishes *who* you are; each route additionally requires a
feature permission, listed in its description as **Requires permission**. Roles
map to permissions server-side — the client's own checks are cosmetic only.
`.trim();

/** Component schema names referenced anywhere inside a value. */
function refsIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) refsIn(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const match = key === '$ref' && typeof child === 'string' ? /^#\/components\/schemas\/(.+)$/.exec(child) : null;
      if (match) found.add(match[1]);
      else refsIn(child, found);
    }
  }
  return found;
}

/**
 * Keep only the model schemas the document actually reaches. The datamodel has
 * tables the API never returns (audit events, the organization row itself), and
 * publishing them as part of the contract would imply they are part of it.
 */
function reachableSchemas(paths: unknown, all: Record<string, JsonSchema>): Record<string, JsonSchema> {
  const queue = [...refsIn(paths)];
  const keep = new Set(queue);
  while (queue.length) {
    const name = queue.pop() as string;
    for (const ref of refsIn(all[name])) {
      if (!keep.has(ref)) { keep.add(ref); queue.push(ref); }
    }
  }
  return Object.fromEntries(Object.entries(all).filter(([name]) => keep.has(name)));
}

/**
 * Builds the OpenAPI document for the given routes, which the caller discovers
 * from the live router stack.
 */
export function buildOpenApiSpec(routes: DiscoveredRoute[]): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {};

  for (const route of routes) {
    const doc = ROUTE_DOCS[routeKey(route)];
    if (!doc) continue; // openapi.test.ts fails the build on any gap
    const path = toOpenApiPath(route.path);
    paths[path] ??= {};
    paths[path][route.method] = operationFor(route, doc);
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'MesaOrigins API',
      version: '1.0.0',
      description: INTRO,
      license: { name: 'UNLICENSED' },
    },
    servers: [{ url: '/', description: 'This server' }],
    tags: TAGS,
    security: [{ AuthSession: [] }, { DevUser: [] }],
    paths,
    components: {
      securitySchemes: {
        AuthSession: {
          type: 'apiKey',
          in: 'cookie',
          name: '__Secure-authjs.session-token',
          description:
            'Auth.js database session cookie. Production requires DEV_AUTH=0 and AUTH_SECRET; Google and email/password sign-in both establish this server-side session.',
        },
        DevUser: {
          type: 'apiKey',
          in: 'header',
          name: 'x-dev-user',
          description:
            'Development only, active while `DEV_AUTH` is on. Pass an employee code or email to act as that member; omit it to fall back to a seeded Administrator. Pair with `x-org` (`x-dev-org` remains a compatibility alias) to choose the organization. Never enable this in production.',
        },
      },
      schemas: { Error: ERROR_SCHEMA, ...reachableSchemas(paths, buildModelSchemas()) },
    },
  };
}
