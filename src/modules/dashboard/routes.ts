import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { dashboard } from './service.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requireRole('admin'));

dashboardRouter.get('/', async (req, res) => {
  const asOf = typeof req.query['asOf'] === 'string' ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query['asOf']) : undefined;
  res.json(await dashboard(asOf));
});
