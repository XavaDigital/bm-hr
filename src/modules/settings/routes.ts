import { Router } from 'express';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { getWiseSettings, putWiseSettings } from './service.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireRole('admin'));

settingsRouter.get('/wise', async (_req, res) => {
  res.json({ wise: await getWiseSettings() });
});

settingsRouter.put('/wise', async (req, res) => {
  res.json({ wise: await putWiseSettings(req.body, req.user) });
});
