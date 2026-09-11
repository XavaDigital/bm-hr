import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  compensation,
  paySchedules,
  teamMembers,
  type Compensation,
  type PaySchedule,
  type TeamMember,
} from '../../db/schema.js';
import { diffRecords, recordAudit, type Actor } from '../../audit.js';
import { ApiError } from '../../http/errors.js';
import type { CompensationInput, MemberInput, MemberPatch, PayScheduleInput } from './schemas.js';

// ---------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------

export interface CompensationView extends Omit<Compensation, 'amount'> {
  amount: number;
}

export interface MemberSummary {
  member: TeamMember;
  currentPay: CompensationView | null;
  lastPayRise: CompensationView | null;
  upcomingPay: CompensationView[];
  schedule: PaySchedule | null;
  tenureMonths: number | null;
  nextAnniversary: string | null;
  daysToAnniversary: number | null;
  nextBirthday: string | null;
}

export function toCompensationView(row: Compensation): CompensationView {
  return { ...row, amount: Number(row.amount) };
}

function isoToday(today: Date): string {
  return today.toISOString().slice(0, 10);
}

/** Next occurrence (on/after today) of a month-day, as YYYY-MM-DD. */
export function nextOccurrence(dateStr: string, today: Date): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const todayStr = isoToday(today);
  const y = today.getUTCFullYear();
  for (const year of [y, y + 1]) {
    const candidate = new Date(Date.UTC(year, month - 1, Math.min(day, daysInMonth(year, month))));
    const s = candidate.toISOString().slice(0, 10);
    if (s >= todayStr) return s;
  }
  return null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export function summarise(
  member: TeamMember,
  comps: Compensation[],
  schedule: PaySchedule | null,
  today = new Date(),
): MemberSummary {
  const todayStr = isoToday(today);
  const sorted = [...comps].sort(
    (a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const current = sorted.find((c) => c.effectiveFrom <= todayStr) ?? null;
  const lastRise = sorted.find((c) => c.reason === 'pay_rise' && c.effectiveFrom <= todayStr) ?? null;
  const upcoming = sorted.filter((c) => c.effectiveFrom > todayStr);
  // Anniversary only makes sense once a first year has passed; before that the
  // "next anniversary" is the first one.
  const nextAnniversary = member.startDate && member.startDate < todayStr ? nextOccurrence(member.startDate, today) : null;
  return {
    member,
    currentPay: current ? toCompensationView(current) : null,
    lastPayRise: lastRise ? toCompensationView(lastRise) : null,
    upcomingPay: upcoming.map(toCompensationView),
    schedule,
    tenureMonths: member.startDate && member.startDate <= todayStr ? monthsBetween(member.startDate, todayStr) : null,
    nextAnniversary,
    daysToAnniversary: nextAnniversary ? daysBetween(todayStr, nextAnniversary) : null,
    nextBirthday: member.dateOfBirth ? nextOccurrence(member.dateOfBirth, today) : null,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listMembers(opts: { status?: string[] } = {}): Promise<MemberSummary[]> {
  const where = [isNull(teamMembers.deletedAt)];
  if (opts.status && opts.status.length > 0) where.push(inArray(teamMembers.status, opts.status));
  const members = await db
    .select()
    .from(teamMembers)
    .where(and(...where))
    .orderBy(teamMembers.firstName, teamMembers.lastName);
  if (members.length === 0) return [];
  const ids = members.map((m) => m.id);
  const comps = await db.select().from(compensation).where(inArray(compensation.memberId, ids));
  const schedules = await db.select().from(paySchedules).where(inArray(paySchedules.memberId, ids));
  const compsBy = new Map<string, Compensation[]>();
  for (const c of comps) compsBy.set(c.memberId, [...(compsBy.get(c.memberId) ?? []), c]);
  const schedBy = new Map(schedules.map((s) => [s.memberId, s]));
  return members.map((m) => summarise(m, compsBy.get(m.id) ?? [], schedBy.get(m.id) ?? null));
}

async function findMember(id: string): Promise<TeamMember> {
  const [m] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.id, id), isNull(teamMembers.deletedAt)));
  if (!m) throw new ApiError(404, 'Team member not found');
  return m;
}

export async function getMember(id: string): Promise<MemberSummary & { compensation: CompensationView[] }> {
  const m = await findMember(id);
  const comps = await db
    .select()
    .from(compensation)
    .where(eq(compensation.memberId, id))
    .orderBy(desc(compensation.effectiveFrom), desc(compensation.createdAt));
  const [schedule] = await db.select().from(paySchedules).where(eq(paySchedules.memberId, id));
  return { ...summarise(m, comps, schedule ?? null), compensation: comps.map(toCompensationView) };
}

export async function findMemberByEmail(email: string): Promise<TeamMember | undefined> {
  const rows = await db.select().from(teamMembers).where(isNull(teamMembers.deletedAt));
  const lower = email.toLowerCase();
  return rows.find((r) => r.email?.toLowerCase() === lower);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === '23505';
}

export async function createMember(input: MemberInput, actor?: Actor): Promise<TeamMember> {
  try {
    const [row] = await db.insert(teamMembers).values(input).returning();
    await recordAudit(actor, 'team_members', row!.id, 'create', row);
    return row!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, 'A team member with that email already exists', 'DUPLICATE_EMAIL');
    throw err;
  }
}

export async function updateMember(id: string, patch: MemberPatch, actor?: Actor): Promise<TeamMember> {
  const before = await findMember(id);
  try {
    const [after] = await db
      .update(teamMembers)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(teamMembers.id, id))
      .returning();
    const diff = diffRecords(before as Record<string, unknown>, after as Record<string, unknown>);
    delete diff['updatedAt'];
    if (Object.keys(diff).length > 0) await recordAudit(actor, 'team_members', id, 'update', diff);
    return after!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, 'A team member with that email already exists', 'DUPLICATE_EMAIL');
    throw err;
  }
}

export async function deleteMember(id: string, actor?: Actor): Promise<void> {
  await findMember(id);
  await db.update(teamMembers).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(teamMembers.id, id));
  await recordAudit(actor, 'team_members', id, 'delete');
}

export async function addCompensation(memberId: string, input: CompensationInput, actor?: Actor): Promise<CompensationView> {
  await findMember(memberId);
  const [row] = await db
    .insert(compensation)
    .values({
      memberId,
      amount: input.amount.toFixed(2),
      currency: input.currency,
      period: input.period,
      effectiveFrom: input.effectiveFrom,
      reason: input.reason,
      notes: input.notes ?? null,
      createdBy: actor?.id ?? null,
      createdByEmail: actor?.email ?? null,
    })
    .returning();
  await recordAudit(actor, 'compensation', row!.id, 'create', row);
  return toCompensationView(row!);
}

export async function deleteCompensation(memberId: string, compId: string, actor?: Actor): Promise<void> {
  const [row] = await db
    .select()
    .from(compensation)
    .where(and(eq(compensation.id, compId), eq(compensation.memberId, memberId)));
  if (!row) throw new ApiError(404, 'Compensation entry not found');
  await db.delete(compensation).where(eq(compensation.id, compId));
  await recordAudit(actor, 'compensation', compId, 'delete', row);
}

export async function upsertPaySchedule(memberId: string, input: PayScheduleInput, actor?: Actor): Promise<PaySchedule> {
  await findMember(memberId);
  const [before] = await db.select().from(paySchedules).where(eq(paySchedules.memberId, memberId));
  const values = { ...input, memberId, updatedAt: new Date() };
  const [after] = await db
    .insert(paySchedules)
    .values(values)
    .onConflictDoUpdate({ target: paySchedules.memberId, set: values })
    .returning();
  if (before) {
    const diff = diffRecords(before as Record<string, unknown>, after as Record<string, unknown>);
    delete diff['updatedAt'];
    if (Object.keys(diff).length > 0) await recordAudit(actor, 'pay_schedules', memberId, 'update', diff);
  } else {
    await recordAudit(actor, 'pay_schedules', memberId, 'create', after);
  }
  return after!;
}
