import type { RequestHandler } from 'express';

// Minimal request logger. Swap for pino/morgan when observability is added.
export const requestLog: RequestHandler = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[api] ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
};
