import type { ErrorRequestHandler, RequestHandler } from 'express';

// Domain error carrying an HTTP status + stable code. Services throw these;
// the handler renders them in the standard envelope.
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Resource not found.' } });
};

// Central error → { error: { code, message, details? } }. Maps common Prisma
// error codes to friendly HTTP statuses (P2025 missing row, P2002 unique clash,
// P2003 FK violation).
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  const code = (err as { code?: string })?.code;
  if (code === 'P2025') {
    res.status(404).json({ error: { code: 'not_found', message: 'Record not found.' } });
    return;
  }
  if (code === 'P2002') {
    res.status(409).json({ error: { code: 'conflict', message: 'A record with that unique value already exists.', details: (err as { meta?: unknown }).meta } });
    return;
  }
  if (code === 'P2003') {
    res.status(409).json({ error: { code: 'fk_violation', message: 'Referenced record does not exist.', details: (err as { meta?: unknown }).meta } });
    return;
  }
  console.error('[api] unhandled error:', err);
  res.status(500).json({ error: { code: 'internal', message: 'Internal server error.' } });
};
