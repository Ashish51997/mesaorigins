import type { RequestHandler } from 'express';

// Never write bearer tokens or query values to logs. Questionnaire and customer
// portal tokens are credentials, not identifiers, and must be treated like passwords.
export function safeRequestTarget(originalUrl: string): string {
  const path = originalUrl.split('?', 1)[0];
  return path.replace(
    /^(\/api\/public\/mesaleads\/(?:forms|portal)\/)[^/]+/,
    '$1[redacted]',
  );
}

// Minimal request logger. Swap for pino/morgan when observability is added.
export const requestLog: RequestHandler = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[api] ${req.method} ${safeRequestTarget(req.originalUrl)} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
};
