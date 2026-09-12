import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import {
  CHECKLIST_KINDS,
  checklistTasks,
  checklistTemplates,
  teamMembers,
  type ChecklistTask,
  type ChecklistTemplate,
  type ChecklistTemplateItem,
  type TeamMember,
} from '../../db/schema.js';
import { recordAudit, type Actor } from '../../audit.js';
import { ApiError } from '../../http/errors.js';
import { addDays } from '../leave/calc.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const templateItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueDays: z.number().int().min(-365).max(365).nullable().default(null),
});

export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(CHECKLIST_KINDS).default('onboarding'),
  items: z.array(templateItemSchema).max(100).default([]),
  isDefault: z.boolean().default(false),
});
export type TemplateInput = z.infer<typeof templateInputSchema>;
export const templatePatchSchema = templateInputSchema.partial();

export const taskInputSchema = z.object({
  kind: z.enum(CHECKLIST_KINDS).default('onboarding'),
  title: z.string().trim().min(1).max(200),
  dueDate: z.union([isoDate, z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : (v ?? null))),
});
export const taskPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  dueDate: z.union([isoDate, z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
  done: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_TEMPLATES: TemplateInput[] = [
  {
    name: 'Contractor onboarding',
    kind: 'onboarding',
    isDefault: true,
    items: [
      { title: 'Signed contractor agreement on file', dueDays: 0 },
      { title: 'ID and tax details collected', dueDays: 0 },
      { title: 'Set up as a Wise recipient; recipientId entered on pay schedule', dueDays: 0 },
      { title: 'Pay and 13th-month terms entered on profile', dueDays: 0 },
      { title: 'Google Workspace account created', dueDays: 0 },
      { title: 'Added to Slack channels', dueDays: 0 },
      { title: 'Tool access granted (Figma, drives, etc.)', dueDays: 1 },
      { title: 'Intro call with the team', dueDays: 3 },
      { title: 'First pay run includes them', dueDays: 7 },
      { title: '30-day check-in', dueDays: 30 },
      { title: '90-day review', dueDays: 90 },
    ],
  },
  {
    name: 'Offboarding',
    kind: 'offboarding',
    isDefault: true,
    items: [
      { title: 'Final pay run and any owed leave settled', dueDays: 0 },
      { title: 'Remove Slack, Google Workspace and tool access', dueDays: 0 },
      { title: 'Collect or wipe company assets and files', dueDays: 0 },
      { title: 'Remove Wise recipient', dueDays: 1 },
      { title: 'Status set to offboarded with end date', dueDays: 0 },
      { title: 'Exit conversation notes recorded', dueDays: 3 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function listTemplates(): Promise<ChecklistTemplate[]> {
  return db.select().from(checklistTemplates).orderBy(asc(checklistTemplates.kind), asc(checklistTemplates.name));
}

export async function seedDefaultTemplates(actor?: Actor): Promise<ChecklistTemplate[]> {
  const existing = await listTemplates();
  if (existing.length > 0) return existing;
  for (const t of DEFAULT_TEMPLATES) await createTemplate(t, actor);
  return listTemplates();
}

export async function createTemplate(input: TemplateInput, actor?: Actor): Promise<ChecklistTemplate> {
  if (input.isDefault) await db.update(checklistTemplates).set({ isDefault: false }).where(eq(checklistTemplates.kind, input.kind));
  const [row] = await db.insert(checklistTemplates).values(input).returning();
  await recordAudit(actor, 'checklist_templates', row!.id, 'create', { name: row!.name, kind: row!.kind });
  return row!;
}

export async function updateTemplate(id: string, patch: Partial<TemplateInput>, actor?: Actor): Promise<ChecklistTemplate> {
  const [before] = await db.select().from(checklistTemplates).where(eq(checklistTemplates.id, id));
  if (!before) throw new ApiError(404, 'Template not found');
  const kind = patch.kind ?? before.kind;
  if (patch.isDefault) await db.update(checklistTemplates).set({ isDefault: false }).where(eq(checklistTemplates.kind, kind));
  const [after] = await db
    .update(checklistTemplates)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(checklistTemplates.id, id))
    .returning();
  await recordAudit(actor, 'checklist_templates', id, 'update', patch);
  return after!;
}

export async function deleteTemplate(id: string, actor?: Actor): Promise<void> {
  const [row] = await db.select().from(checklistTemplates).where(eq(checklistTemplates.id, id));
  if (!row) throw new ApiError(404, 'Template not found');
  await db.delete(checklistTemplates).where(eq(checklistTemplates.id, id));
  await recordAudit(actor, 'checklist_templates', id, 'delete', { name: row.name });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface ChecklistProgress {
  total: number;
  done: number;
  overdue: number;
}

export interface MemberChecklist {
  tasks: ChecklistTask[];
  onboarding: ChecklistProgress;
  offboarding: ChecklistProgress;
}

async function findMember(id: string): Promise<TeamMember> {
  const [m] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.id, id), isNull(teamMembers.deletedAt)));
  if (!m) throw new ApiError(404, 'Team member not found');
  return m;
}

export function progressOf(tasks: ChecklistTask[], today: string): ChecklistProgress {
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.doneAt).length,
    overdue: tasks.filter((t) => !t.doneAt && t.dueDate && t.dueDate < today).length,
  };
}

export async function memberChecklist(memberId: string, today = new Date().toISOString().slice(0, 10)): Promise<MemberChecklist> {
  await findMember(memberId);
  const tasks = await db
    .select()
    .from(checklistTasks)
    .where(eq(checklistTasks.memberId, memberId))
    .orderBy(asc(checklistTasks.kind), asc(checklistTasks.sortOrder), asc(checklistTasks.createdAt));
  return {
    tasks,
    onboarding: progressOf(
      tasks.filter((t) => t.kind === 'onboarding'),
      today,
    ),
    offboarding: progressOf(
      tasks.filter((t) => t.kind === 'offboarding'),
      today,
    ),
  };
}

/** Progress for many members in one query (dashboard). */
export async function progressFor(memberIds: string[], kind: (typeof CHECKLIST_KINDS)[number], today: string): Promise<Map<string, ChecklistProgress>> {
  const out = new Map<string, ChecklistProgress>();
  if (memberIds.length === 0) return out;
  const rows = await db
    .select()
    .from(checklistTasks)
    .where(and(inArray(checklistTasks.memberId, memberIds), eq(checklistTasks.kind, kind)));
  const by = new Map<string, ChecklistTask[]>();
  for (const r of rows) by.set(r.memberId, [...(by.get(r.memberId) ?? []), r]);
  for (const [id, tasks] of by) out.set(id, progressOf(tasks, today));
  return out;
}

/** Create tasks from a template. Titles already present for that kind are skipped. */
export async function applyTemplate(memberId: string, templateId: string, actor?: Actor): Promise<MemberChecklist> {
  const m = await findMember(memberId);
  const [t] = await db.select().from(checklistTemplates).where(eq(checklistTemplates.id, templateId));
  if (!t) throw new ApiError(404, 'Template not found');
  const anchor = t.kind === 'offboarding' ? m.endDate : m.startDate;
  const existing = await db
    .select({ title: checklistTasks.title })
    .from(checklistTasks)
    .where(and(eq(checklistTasks.memberId, memberId), eq(checklistTasks.kind, t.kind)));
  const have = new Set(existing.map((e) => e.title.toLowerCase()));
  let order = existing.length;
  let created = 0;
  for (const item of t.items as ChecklistTemplateItem[]) {
    if (have.has(item.title.toLowerCase())) continue;
    await db.insert(checklistTasks).values({
      memberId,
      kind: t.kind,
      title: item.title,
      dueDate: anchor && item.dueDays !== null ? addDays(anchor, item.dueDays) : null,
      sortOrder: order++,
      templateId: t.id,
    });
    created++;
  }
  await recordAudit(actor, 'checklist_tasks', memberId, 'create', { template: t.name, created });
  return memberChecklist(memberId);
}

export async function addTask(memberId: string, input: z.infer<typeof taskInputSchema>, actor?: Actor): Promise<MemberChecklist> {
  await findMember(memberId);
  const existing = await db
    .select({ id: checklistTasks.id })
    .from(checklistTasks)
    .where(and(eq(checklistTasks.memberId, memberId), eq(checklistTasks.kind, input.kind)));
  const [row] = await db
    .insert(checklistTasks)
    .values({ memberId, kind: input.kind, title: input.title, dueDate: input.dueDate, sortOrder: existing.length })
    .returning();
  await recordAudit(actor, 'checklist_tasks', row!.id, 'create', { title: row!.title });
  return memberChecklist(memberId);
}

export async function updateTask(memberId: string, taskId: string, patch: z.infer<typeof taskPatchSchema>, actor?: Actor): Promise<MemberChecklist> {
  const [task] = await db
    .select()
    .from(checklistTasks)
    .where(and(eq(checklistTasks.id, taskId), eq(checklistTasks.memberId, memberId)));
  if (!task) throw new ApiError(404, 'Task not found');
  const set: Partial<typeof checklistTasks.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
  if (patch.done !== undefined) {
    set.doneAt = patch.done ? new Date() : null;
    set.doneByEmail = patch.done ? (actor?.email ?? null) : null;
  }
  await db.update(checklistTasks).set(set).where(eq(checklistTasks.id, taskId));
  await recordAudit(actor, 'checklist_tasks', taskId, 'update', patch);
  return memberChecklist(memberId);
}

export async function deleteTask(memberId: string, taskId: string, actor?: Actor): Promise<MemberChecklist> {
  const [task] = await db
    .select()
    .from(checklistTasks)
    .where(and(eq(checklistTasks.id, taskId), eq(checklistTasks.memberId, memberId)));
  if (!task) throw new ApiError(404, 'Task not found');
  await db.delete(checklistTasks).where(eq(checklistTasks.id, taskId));
  await recordAudit(actor, 'checklist_tasks', taskId, 'delete', { title: task.title });
  return memberChecklist(memberId);
}
