import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { PAY_FREQUENCIES } from '../../db/schema.js';
import {
  addLine,
  createPayRun,
  deletePayRun,
  exportPayRun,
  getPayRun,
  listPayRuns,
  markPaid,
  payRunCsv,
  refreshPayRun,
  removeLine,
  reopenPayRun,
  updateLine,
  updatePayRun,
} from './service.js';

export const payRunsRouter = Router();
payRunsRouter.use(requireAuth, requireRole('admin'));

const id = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const optionalDate = z.union([isoDate, z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v));

const createSchema = z.object({
  payDate: isoDate,
  frequency: z.enum(PAY_FREQUENCIES).default('weekly'),
  periodStart: optionalDate,
  periodEnd: optionalDate,
  notes: z.string().trim().max(2000).nullable().optional(),
});

const patchRunSchema = z.object({
  payDate: isoDate.optional(),
  periodStart: optionalDate,
  periodEnd: optionalDate,
  notes: z.string().trim().max(2000).nullable().optional(),
});

const patchLineSchema = z.object({
  included: z.boolean().optional(),
  thirteenthMonthAmount: z.number().min(0).max(9_999_999).optional(),
  adjustmentsAmount: z.number().min(-9_999_999).max(9_999_999).optional(),
  adjustmentsNote: z.string().trim().max(500).nullable().optional(),
  paymentReference: z.string().trim().max(100).nullable().optional(),
});

payRunsRouter.get('/', async (_req, res) => {
  res.json({ payRuns: await listPayRuns() });
});

payRunsRouter.post('/', async (req, res) => {
  res.status(201).json(await createPayRun(createSchema.parse(req.body), req.user));
});

payRunsRouter.get('/:id', async (req, res) => {
  res.json(await getPayRun(id.parse(req.params['id'])));
});

payRunsRouter.patch('/:id', async (req, res) => {
  res.json(await updatePayRun(id.parse(req.params['id']), patchRunSchema.parse(req.body), req.user));
});

payRunsRouter.delete('/:id', async (req, res) => {
  await deletePayRun(id.parse(req.params['id']), req.user);
  res.status(204).end();
});

payRunsRouter.post('/:id/refresh', async (req, res) => {
  res.json(await refreshPayRun(id.parse(req.params['id']), req.user));
});

payRunsRouter.post('/:id/lines', async (req, res) => {
  const { memberId } = z.object({ memberId: id }).parse(req.body);
  res.status(201).json(await addLine(id.parse(req.params['id']), memberId, req.user));
});

payRunsRouter.patch('/:id/lines/:lineId', async (req, res) => {
  res.json(await updateLine(id.parse(req.params['id']), id.parse(req.params['lineId']), patchLineSchema.parse(req.body), req.user));
});

payRunsRouter.delete('/:id/lines/:lineId', async (req, res) => {
  res.json(await removeLine(id.parse(req.params['id']), id.parse(req.params['lineId']), req.user));
});

payRunsRouter.post('/:id/export', async (req, res) => {
  res.json(await exportPayRun(id.parse(req.params['id']), req.user));
});

payRunsRouter.get('/:id/csv', async (req, res) => {
  const { filename, csv } = await payRunCsv(id.parse(req.params['id']));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

payRunsRouter.post('/:id/mark-paid', async (req, res) => {
  res.json(await markPaid(id.parse(req.params['id']), req.user));
});

payRunsRouter.post('/:id/reopen', async (req, res) => {
  res.json(await reopenPayRun(id.parse(req.params['id']), req.user));
});
