import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

// Marker the OpenAPI generator reads off a mounted handler to recover the body
// schema, so the published spec can never drift from what is actually enforced.
export const BODY_SCHEMA = Symbol.for('erp.openapi.bodySchema');

export interface BodyValidatingHandler extends RequestHandler {
  [BODY_SCHEMA]: ZodTypeAny;
}

// Validate + coerce the request body against a Zod schema. On failure returns
// 422 with field-level details; on success replaces req.body with parsed data.
export const validateBody = (schema: ZodTypeAny): RequestHandler => {
  const handler: RequestHandler = (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(422).json({
        error: { code: 'validation', message: 'Invalid request body.', details: result.error.flatten() },
      });
      return;
    }
    req.body = result.data;
    next();
  };
  return Object.assign(handler, { [BODY_SCHEMA]: schema });
};
