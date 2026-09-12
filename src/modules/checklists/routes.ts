import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import {
  addTask,
  applyTemplate,
  createTemplate,
  deleteTask,
  deleteTemplate,
  listTemplates,
  memberChecklist,
  seedDefaultTemplates,
  taskInputSchema,
  taskPatchSchema,
  templateInputSchema,
  templatePatchSchema,
  updateTask,
  updateTemplate,
} from './service.js';

const id = z.string().uuid();

/** /api/checklists/templates */
export const checklistsRouter = Router();
checklistsRouter.use(requireAuth, requireRole('admin'));

checklistsRouter.get('/templates', async (_req, res) => {
  res.json({ templates: await listTemplates() });
});

checklistsRouter.post('/templates/seed-defaults', async (req, res) => {
  res.json({ templates: await seedDefaultTemplates(req.user) });
});

checklistsRouter.post('/templates', async (req, res) => {
  res.status(201).json({ template: await createTemplate(templateInputSchema.parse(req.body), req.user) });
});

checklistsRouter.patch('/templates/:id', async (req, res) => {
  res.json({ template: await updateTemplate(id.parse(req.params['id']), templatePatchSchema.parse(req.body), req.user) });
});

checklistsRouter.delete('/templates/:id', async (req, res) => {
  await deleteTemplate(id.parse(req.params['id']), req.user);
  res.status(204).end();
});

/** Mounted under /api/members. */
export const memberChecklistRouter = Router();
memberChecklistRouter.use(requireAuth, requireRole('admin'));

memberChecklistRouter.get('/:id/checklist', async (req, res) => {
  res.json(await memberChecklist(id.parse(req.params['id'])));
});

memberChecklistRouter.post('/:id/checklist/apply', async (req, res) => {
  const { templateId } = z.object({ templateId: id }).parse(req.body);
  res.json(await applyTemplate(id.parse(req.params['id']), templateId, req.user));
});

memberChecklistRouter.post('/:id/checklist', async (req, res) => {
  res.status(201).json(await addTask(id.parse(req.params['id']), taskInputSchema.parse(req.body), req.user));
});

memberChecklistRouter.patch('/:id/checklist/:taskId', async (req, res) => {
  res.json(await updateTask(id.parse(req.params['id']), id.parse(req.params['taskId']), taskPatchSchema.parse(req.body), req.user));
});

memberChecklistRouter.delete('/:id/checklist/:taskId', async (req, res) => {
  res.json(await deleteTask(id.parse(req.params['id']), id.parse(req.params['taskId']), req.user));
});
