import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { workingDays } from './calc.js';
import {
  leaveAdjustmentInputSchema,
  leavePolicyInputSchema,
  leaveRequestInputSchema,
  leaveRequestPatchSchema,
  listRequestsQuerySchema,
} from './schemas.js';
import { addAdjustment, createRequest, deleteAdjustment, deleteRequest, listRequests, memberLeave, updateRequest, upsertPolicy } from './service.js';

const id = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Team-wide leave: /api/leave/... */
export const leaveRouter = Router();
leaveRouter.use(requireAuth, requireRole('admin'));

leaveRouter.get('/requests', async (req, res) => {
  res.json({ requests: await listRequests(listRequestsQuerySchema.parse(req.query)) });
});

leaveRouter.post('/requests', async (req, res) => {
  res.status(201).json({ request: await createRequest(leaveRequestInputSchema.parse(req.body), req.user) });
});

leaveRouter.patch('/requests/:id', async (req, res) => {
  res.json({ request: await updateRequest(id.parse(req.params['id']), leaveRequestPatchSchema.parse(req.body), req.user) });
});

leaveRouter.delete('/requests/:id', async (req, res) => {
  await deleteRequest(id.parse(req.params['id']), req.user);
  res.status(204).end();
});

leaveRouter.get('/working-days', (req, res) => {
  const { start, end } = z.object({ start: isoDate, end: isoDate }).parse(req.query);
  res.json({ days: workingDays(start, end) });
});

/** Per-member leave, mounted under /api/members. */
export const memberLeaveRouter = Router();
memberLeaveRouter.use(requireAuth, requireRole('admin'));

memberLeaveRouter.get('/:id/leave', async (req, res) => {
  const asOf = typeof req.query['asOf'] === 'string' ? isoDate.parse(req.query['asOf']) : undefined;
  res.json(await memberLeave(id.parse(req.params['id']), asOf));
});

memberLeaveRouter.put('/:id/leave-policy', async (req, res) => {
  res.json({ policy: await upsertPolicy(id.parse(req.params['id']), leavePolicyInputSchema.parse(req.body), req.user) });
});

memberLeaveRouter.post('/:id/leave-adjustments', async (req, res) => {
  res.status(201).json({ adjustment: await addAdjustment(id.parse(req.params['id']), leaveAdjustmentInputSchema.parse(req.body), req.user) });
});

memberLeaveRouter.delete('/:id/leave-adjustments/:adjId', async (req, res) => {
  await deleteAdjustment(id.parse(req.params['id']), id.parse(req.params['adjId']), req.user);
  res.status(204).end();
});
