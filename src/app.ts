import express from 'express';
import type { Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbReady } from './db/index.js';
import { authRouter } from './auth/routes.js';
import { membersRouter } from './modules/members/routes.js';
import { payRunsRouter } from './modules/payruns/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { errorHandler } from './http/errors.js';

/**
 * Build the Express app. Exported as a factory so tests can exercise routes
 * (via supertest) without binding a port.
 */
export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', async (_req, res) => {
    const db = await dbReady();
    res.status(db === 'connected' || db === 'not_configured' ? 200 : 503).json({
      status: db === 'error' ? 'degraded' : 'ok',
      db,
      uptime: process.uptime(),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/members', membersRouter);
  app.use('/api/pay-runs', payRunsRouter);
  app.use('/api/settings', settingsRouter);

  // Unknown /api/* paths are a JSON 404, never the SPA shell.
  app.use('/api', (_req, res) => {
    res.status(404).json({ message: 'Not found' });
  });

  // ---- Frontend (bundled SPA) --------------------------------------------
  // The Vite build is copied to `<app>/public` in the Docker image. When
  // present, serve the static assets and fall back to index.html for client
  // routes. When absent (dev/tests), `/` returns a small JSON descriptor.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = path.resolve(__dirname, '..', 'public');
  if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.json({ service: 'bm-hr', status: 'ok', api: '/api', health: '/api/health' });
    });
  }

  app.use(errorHandler);
  return app;
}
