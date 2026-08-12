import 'dotenv/config';
import express from 'express';
import path from 'path';
import { readFile } from 'node:fs/promises';
import { createServer as createViteServer } from 'vite';
import { mountApi } from './app';
import { errorHandler } from './middleware/error';

// Boots the ERP backend: the REST API + the SPA (Vite middleware in dev, static
// dist in prod). Replaces the old top-level server.ts.
const PORT = Number(process.env.PORT ?? 3000);

async function start(): Promise<void> {
  const app = express();

  mountApi(app); // express.json + /api routes + legacy /api/data

  // The customer page URL contains a bearer token. Prevent browsers, caches
  // and search engines from propagating or retaining it.
  app.use('/mesaleads/q', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    next();
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'custom' });
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
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => { res.sendFile(path.join(distPath, 'index.html')); });
  }

  app.use(errorHandler); // must be last

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ERP BACKEND] Server running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[ERP BACKEND] Failed to start:', err);
  process.exit(1);
});
