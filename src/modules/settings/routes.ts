import { Router } from 'express';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { getDigestSettings, getLeaveSettings, getWiseSettings, putDigestSettings, putLeaveSettings, putWiseSettings } from './service.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireRole('admin'));

settingsRouter.get('/digest', async (_req, res) => {
  res.json({ digest: await getDigestSettings() });
});

settingsRouter.put('/digest', async (req, res) => {
  res.json({ digest: await putDigestSettings(req.body, req.user) });
});

settingsRouter.get('/leave', async (_req, res) => {
  res.json({ leave: await getLeaveSettings() });
});

settingsRouter.put('/leave', async (req, res) => {
  res.json({ leave: await putLeaveSettings(req.body, req.user) });
});

settingsRouter.get('/wise', async (_req, res) => {
  res.json({ wise: await getWiseSettings() });
});

settingsRouter.put('/wise', async (req, res) => {
  res.json({ wise: await putWiseSettings(req.body, req.user) });
});
