import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { mountApi } from './app';
import { errorHandler } from './middleware/error';

// Boots the ERP backend: the REST API + the SPA (Vite middleware in dev, static
// dist in prod). Replaces the old top-level server.ts.
const PORT = Number(process.env.PORT ?? 3000);

async function start(): Promise<void> {
  const app = express();

  mountApi(app); // express.json + /api routes + legacy /api/data

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
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
