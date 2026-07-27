import { Prisma } from '@prisma/client';

/**
 * Component schemas generated from the Prisma datamodel, so documented response
 * shapes track migrations automatically.
 *
 * Only scalar columns are emitted. Relations are added per-route from the
 * `responseIncludes` metadata, because which relations come back — and how much
 * of each — is decided by the individual service's `include`/`select`.
 */

type JsonSchema = Record<string, unknown>;

const SCALARS: Record<string, JsonSchema> = {
  String: { type: 'string' },
  Boolean: { type: 'boolean' },
  Int: { type: 'integer' },
  BigInt: { type: 'integer', format: 'int64' },
  Float: { type: 'number' },
  Decimal: { type: 'number' },
  DateTime: { type: 'string', format: 'date-time' },
  Bytes: { type: 'string', format: 'byte' },
  Json: { description: 'Arbitrary JSON.' },
};

const models = Prisma.dmmf.datamodel.models;

/** OpenAPI 3.1 spells an optional column as a union with null. */
function nullable(schema: JsonSchema): JsonSchema {
  if (typeof schema.type !== 'string') return schema; // untyped already admits null
  return { ...schema, type: [schema.type, 'null'] };
}

function fieldSchema(field: { type: string; isList: boolean; isRequired: boolean }): JsonSchema {
  const base = SCALARS[field.type] ?? { description: 'Arbitrary JSON.' };
  const schema: JsonSchema = field.isList ? { type: 'array', items: { ...base } } : { ...base };
  return field.isRequired ? schema : nullable(schema);
}

let cached: Record<string, JsonSchema> | undefined;

/** `components.schemas` for every Prisma model, scalars only. */
export function buildModelSchemas(): Record<string, JsonSchema> {
  if (cached) return cached;
  const out: Record<string, JsonSchema> = {};
  for (const model of models) {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const field of model.fields) {
      if (field.kind === 'object') continue; // relation — see relationSchema()
      properties[field.name] = fieldSchema(field);
      if (field.isRequired && !field.isList) required.push(field.name);
    }
    out[model.name] = {
      type: 'object',
      description: `The ${model.name} record as stored. Relation objects appear only on endpoints that include them.`,
      properties,
      ...(required.length ? { required } : {}),
    };
  }
  cached = out;
  return out;
}

export function isKnownModel(name: string): boolean {
  return models.some((m) => m.name === name);
}

/** Field names a model actually has, for validating `responseFields`. */
export function scalarFieldsOf(modelName: string): string[] {
  const model = models.find((m) => m.name === modelName);
  return model ? model.fields.filter((f) => f.kind !== 'object').map((f) => f.name) : [];
}

/**
 * Schema for a relation an endpoint includes. Endpoints usually `select` a few
 * columns of the relation rather than all of them, so the reference is marked
 * as possibly partial instead of promising the whole record.
 */
export function relationSchema(modelName: string, relation: string): JsonSchema {
  const field = models.find((m) => m.name === modelName)?.fields.find((f) => f.name === relation && f.kind === 'object');
  if (!field) {
    return { type: 'object', description: `Derived \`${relation}\` object attached by this endpoint.` };
  }
  const ref = { $ref: `#/components/schemas/${field.type}` };
  const note = `A ${field.type}; this endpoint may select only some of its fields.`;
  if (field.isList) return { type: 'array', items: ref, description: note };
  return field.isRequired ? { ...ref, description: note } : { anyOf: [ref, { type: 'null' }], description: note };
}
