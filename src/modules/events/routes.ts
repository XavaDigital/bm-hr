/** Per-member notes timeline: /api/members/:id/events */
import { Router } from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { db } from '../../db/index.js';
import { EVENT_TYPES, memberEvents, teamMembers } from '../../db/schema.js';
import { diffRecords, recordAudit } from '../../audit.js';
import { ApiError } from '../../http/errors.js';

const id = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const eventInputSchema = z.object({
  date: isoDate,
  type: z.enum(EVENT_TYPES).default('note'),
  text: z.string().trim().min(1).max(10_000),
});
const eventPatchSchema = eventInputSchema.partial();

async function assertMember(memberId: string): Promise<void> {
  const [m] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.id, memberId), isNull(teamMembers.deletedAt)));
  if (!m) throw new ApiError(404, 'Team member not found');
}

export const memberEventsRouter = Router();
memberEventsRouter.use(requireAuth, requireRole('admin'));

memberEventsRouter.get('/:id/events', async (req, res) => {
  const memberId = id.parse(req.params['id']);
  await assertMember(memberId);
  const events = await db.select().from(memberEvents).where(eq(memberEvents.memberId, memberId)).orderBy(desc(memberEvents.date), desc(memberEvents.createdAt));
  res.json({ events });
});

memberEventsRouter.post('/:id/events', async (req, res) => {
  const memberId = id.parse(req.params['id']);
  await assertMember(memberId);
  const input = eventInputSchema.parse(req.body);
  const [row] = await db
    .insert(memberEvents)
    .values({ memberId, ...input, createdByEmail: req.user?.email ?? null })
    .returning();
  await recordAudit(req.user, 'member_events', row!.id, 'create', { type: row!.type });
  res.status(201).json({ event: row });
});

memberEventsRouter.patch('/:id/events/:eventId', async (req, res) => {
  const memberId = id.parse(req.params['id']);
  const eventId = id.parse(req.params['eventId']);
  const [before] = await db
    .select()
    .from(memberEvents)
    .where(and(eq(memberEvents.id, eventId), eq(memberEvents.memberId, memberId)));
  if (!before) throw new ApiError(404, 'Event not found');
  const patch = eventPatchSchema.parse(req.body);
  const [after] = await db
    .update(memberEvents)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(memberEvents.id, eventId))
    .returning();
  const diff = diffRecords(before as Record<string, unknown>, after as Record<string, unknown>);
  delete diff['updatedAt'];
  if (Object.keys(diff).length > 0) await recordAudit(req.user, 'member_events', eventId, 'update', diff);
  res.json({ event: after });
});

memberEventsRouter.delete('/:id/events/:eventId', async (req, res) => {
  const memberId = id.parse(req.params['id']);
  const eventId = id.parse(req.params['eventId']);
  const [row] = await db
    .select()
    .from(memberEvents)
    .where(and(eq(memberEvents.id, eventId), eq(memberEvents.memberId, memberId)));
  if (!row) throw new ApiError(404, 'Event not found');
  await db.delete(memberEvents).where(eq(memberEvents.id, eventId));
  await recordAudit(req.user, 'member_events', eventId, 'delete', { type: row.type, date: row.date });
  res.status(204).end();
});
