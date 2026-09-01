import 'dotenv/config';
import express from 'express';
import path from 'path';
import { readFile } from 'node:fs/promises';
import { mountApi } from './app';
import { errorHandler } from './middleware/error';
import { basePrisma } from './db';
import { assertProductionConfig, setDraining } from './runtime';
import { startIntegrationOutboxWorker, stopIntegrationOutboxWorker } from './lib/integrationOutboxWorker';

// Boots the ERP backend: the REST API + the SPA (Vite middleware in dev, static
// dist in prod). Replaces the old top-level server.ts.
const PORT = Number(process.env.PORT ?? 4000);

async function start(): Promise<void> {
  assertProductionConfig();
  const app = express();
  let closeDevelopmentServer: (() => Promise<void>) | undefined;

  mountApi(app); // JSON parsing, authentication, service gates and /api routes

  // The customer page URL contains a bearer token. Prevent browsers, caches
  // and search engines from propagating or retaining it.
  app.use('/mesaleads/q', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    next();
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'custom' });
    closeDevelopmentServer = () => vite.close();
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) return next();
      try {
        const templatePath = path.resolve(process.cwd(), 'index.html');
        const template = await readFile(templatePath, 'utf8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });
  } else {
    const clientPath = path.join(process.cwd(), 'dist', 'client');
    app.use(express.static(clientPath, {
      dotfiles: 'deny',
      index: false,
      setHeaders(res, filePath) {
        if (
          filePath.includes(`${path.sep}assets${path.sep}`)
          || filePath.includes(`${path.sep}app-assets${path.sep}`)
        ) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith(`${path.sep}sw.js`) || filePath.endsWith(`${path.sep}manifest.webmanifest`)) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }));
    app.get('/', (_req, res) => {
      // Marketing homepage is served by Vercel at the public apex domain.
      // Direct Cloud Run hits on / should not serve the app SPA shell.
      res.redirect(302, 'https://mesaorigins.com');
    });
    app.get('*', (req, res) => {
      // A missing asset, API/auth path or server-bundle probe must never receive
      // the SPA shell. Only extensionless browser navigations use client routing.
      if (req.path.startsWith('/api') || req.path.startsWith('/auth') || path.extname(req.path) || !req.accepts('html')) {
        res.status(404).end();
        return;
      }
      if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientPath, 'index.html'));
    });
  }

  app.use(errorHandler); // must be last

  startIntegrationOutboxWorker();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ERP BACKEND] Server running on http://0.0.0.0:${PORT}`);
  });

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    setDraining(true);
    const outboxStopped = stopIntegrationOutboxWorker();
    console.log(`[ERP BACKEND] ${signal} received; draining requests.`);

    const forceExit = setTimeout(() => {
      console.error('[ERP BACKEND] Graceful shutdown timed out.');
      process.exit(1);
    }, 8_000);
    forceExit.unref();

    server.close((serverError) => {
      // Stop database work before disconnecting Prisma. This prevents an
      // in-flight claimed event from losing its durable receipt during drain.
      Promise.allSettled([outboxStopped]).then(async (workerResults) => {
        const resourceResults = await Promise.allSettled([
          basePrisma.$disconnect(),
          closeDevelopmentServer?.() ?? Promise.resolve(),
        ]);
        const results = [...workerResults, ...resourceResults];
        clearTimeout(forceExit);
        const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (serverError || rejected) {
          console.error('[ERP BACKEND] Shutdown failed:', serverError ?? rejected?.reason);
          process.exit(1);
        }
        console.log('[ERP BACKEND] Shutdown complete.');
        process.exit(0);
      });
    });
    server.closeIdleConnections?.();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[ERP BACKEND] Failed to start:', err);
  basePrisma.$disconnect().finally(() => process.exit(1));
});
