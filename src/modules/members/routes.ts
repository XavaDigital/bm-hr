import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { MEMBER_STATUSES } from '../../db/schema.js';
import { importMembersCsv, importTemplateCsv } from './import.js';
import { payHistory } from '../payruns/service.js';
import {
  compensationInputSchema,
  importRequestSchema,
  memberInputSchema,
  memberPatchSchema,
  payScheduleInputSchema,
} from './schemas.js';
import {
  addCompensation,
  createMember,
  deleteCompensation,
  deleteMember,
  getMember,
  listMembers,
  updateMember,
  upsertPaySchedule,
} from './service.js';

export const membersRouter = Router();

// Everything here is admin-only: the directory carries pay data.
membersRouter.use(requireAuth, requireRole('admin'));

const idParam = z.string().uuid();

membersRouter.get('/', async (req, res) => {
  const raw = typeof req.query['status'] === 'string' ? req.query['status'] : '';
  const status = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is (typeof MEMBER_STATUSES)[number] => (MEMBER_STATUSES as readonly string[]).includes(s));
  res.json({ members: await listMembers({ status }) });
});

membersRouter.post('/', async (req, res) => {
  const input = memberInputSchema.parse(req.body);
  const member = await createMember(input, req.user);
  res.status(201).json({ member });
});

membersRouter.get('/import/template', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="team-import-template.csv"');
  res.send(importTemplateCsv());
});

membersRouter.post('/import', async (req, res) => {
  const { csv, dryRun } = importRequestSchema.parse(req.body);
  try {
    res.json(await importMembersCsv(csv, dryRun, req.user));
  } catch (err) {
    if ((err as { status?: number }).status === 400) {
      res.status(400).json({ message: (err as Error).message });
      return;
    }
    throw err;
  }
});

membersRouter.get('/:id', async (req, res) => {
  res.json(await getMember(idParam.parse(req.params['id'])));
});

membersRouter.get('/:id/pay-history', async (req, res) => {
  const memberId = idParam.parse(req.params['id']);
  await getMember(memberId); // 404 if unknown
  res.json({ history: await payHistory(memberId) });
});

membersRouter.patch('/:id', async (req, res) => {
  const member = await updateMember(idParam.parse(req.params['id']), memberPatchSchema.parse(req.body), req.user);
  res.json({ member });
});

membersRouter.delete('/:id', async (req, res) => {
  await deleteMember(idParam.parse(req.params['id']), req.user);
  res.status(204).end();
});

membersRouter.post('/:id/compensation', async (req, res) => {
  const row = await addCompensation(idParam.parse(req.params['id']), compensationInputSchema.parse(req.body), req.user);
  res.status(201).json({ compensation: row });
});

membersRouter.delete('/:id/compensation/:compId', async (req, res) => {
  await deleteCompensation(idParam.parse(req.params['id']), idParam.parse(req.params['compId']), req.user);
  res.status(204).end();
});

membersRouter.put('/:id/pay-schedule', async (req, res) => {
  const schedule = await upsertPaySchedule(idParam.parse(req.params['id']), payScheduleInputSchema.parse(req.body), req.user);
  res.json({ schedule });
});
