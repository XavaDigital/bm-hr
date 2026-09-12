import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  leaveAdjustments,
  leavePolicies,
  leaveRequests,
  teamMembers,
  type LeaveAdjustment,
  type LeavePolicy,
  type LeaveRequest,
  type TeamMember,
} from '../../db/schema.js';
import { diffRecords, recordAudit, type Actor } from '../../audit.js';
import { ApiError } from '../../http/errors.js';
import { getLeaveSettings, type LeaveSettings } from '../settings/service.js';
import { computeBalance, workingDays, type Accrual, type LeaveBalance, type PolicyLike } from './calc.js';
import type { LeaveAdjustmentInput, LeavePolicyInput, LeaveRequestInput, LeaveRequestPatch } from './schemas.js';

export const isoToday = (): string => new Date().toISOString().slice(0, 10);
const num = (s: string): number => Number(s);
const str = (n: number): string => n.toFixed(2);

export interface PolicyView extends PolicyLike {
  memberId: string;
  /** True when no row exists and the settings defaults are in effect. */
  isDefault: boolean;
}

export interface LeaveRequestView extends Omit<LeaveRequest, 'days'> {
  days: number;
  memberName?: string;
}

export interface LeaveAdjustmentView extends Omit<LeaveAdjustment, 'days'> {
  days: number;
}

export interface MemberLeaveView {
  policy: PolicyView;
  balance: LeaveBalance;
  requests: LeaveRequestView[];
  adjustments: LeaveAdjustmentView[];
}

const toRequestView = (r: LeaveRequest, memberName?: string): LeaveRequestView => ({ ...r, days: num(r.days), ...(memberName ? { memberName } : {}) });
const toAdjustmentView = (a: LeaveAdjustment): LeaveAdjustmentView => ({ ...a, days: num(a.days) });

function toPolicyView(memberId: string, row: LeavePolicy | undefined, defaults: LeaveSettings): PolicyView {
  if (!row) {
    return {
      memberId,
      isDefault: true,
      leaveYearStart: defaults.leaveYearStart,
      annualEntitlementDays: defaults.annualEntitlementDays,
      accrual: defaults.accrual,
      carryOverMaxDays: defaults.carryOverMaxDays,
      sickDays: defaults.sickDays,
    };
  }
  return {
    memberId,
    isDefault: false,
    leaveYearStart: row.leaveYearStart,
    annualEntitlementDays: num(row.annualEntitlementDays),
    accrual: row.accrual as Accrual,
    carryOverMaxDays: num(row.carryOverMaxDays),
    sickDays: row.sickDays === null ? null : num(row.sickDays),
  };
}

async function findMember(id: string): Promise<TeamMember> {
  const [m] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.id, id), isNull(teamMembers.deletedAt)));
  if (!m) throw new ApiError(404, 'Team member not found');
  return m;
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/** Balances for many members in three queries (used by the team list and dashboard). */
export async function balancesFor(members: TeamMember[], today = isoToday()): Promise<Map<string, LeaveBalance>> {
  const out = new Map<string, LeaveBalance>();
  if (members.length === 0) return out;
  const ids = members.map((m) => m.id);
  const defaults = await getLeaveSettings();
  const [policies, requests, adjustments] = await Promise.all([
    db.select().from(leavePolicies).where(inArray(leavePolicies.memberId, ids)),
    db.select().from(leaveRequests).where(inArray(leaveRequests.memberId, ids)),
    db.select().from(leaveAdjustments).where(inArray(leaveAdjustments.memberId, ids)),
  ]);
  const pBy = new Map(policies.map((p) => [p.memberId, p]));
  const rBy = new Map<string, LeaveRequest[]>();
  for (const r of requests) rBy.set(r.memberId, [...(rBy.get(r.memberId) ?? []), r]);
  const aBy = new Map<string, LeaveAdjustment[]>();
  for (const a of adjustments) aBy.set(a.memberId, [...(aBy.get(a.memberId) ?? []), a]);
  for (const m of members) {
    out.set(
      m.id,
      computeBalance(
        toPolicyView(m.id, pBy.get(m.id), defaults),
        m.startDate,
        (rBy.get(m.id) ?? []).map((r) => toRequestView(r)),
        (aBy.get(m.id) ?? []).map(toAdjustmentView),
        today,
      ),
    );
  }
  return out;
}

export async function memberLeave(memberId: string, today = isoToday()): Promise<MemberLeaveView> {
  const m = await findMember(memberId);
  const defaults = await getLeaveSettings();
  const [policyRow] = await db.select().from(leavePolicies).where(eq(leavePolicies.memberId, memberId));
  const requests = (await db.select().from(leaveRequests).where(eq(leaveRequests.memberId, memberId)).orderBy(desc(leaveRequests.startDate))).map((r) =>
    toRequestView(r),
  );
  const adjustments = (await db.select().from(leaveAdjustments).where(eq(leaveAdjustments.memberId, memberId)).orderBy(desc(leaveAdjustments.date))).map(
    toAdjustmentView,
  );
  const policy = toPolicyView(memberId, policyRow, defaults);
  return { policy, balance: computeBalance(policy, m.startDate, requests, adjustments, today), requests, adjustments };
}

export async function upsertPolicy(memberId: string, input: LeavePolicyInput, actor?: Actor): Promise<PolicyView> {
  await findMember(memberId);
  const values = {
    memberId,
    leaveYearStart: input.leaveYearStart,
    annualEntitlementDays: str(input.annualEntitlementDays),
    accrual: input.accrual,
    carryOverMaxDays: str(input.carryOverMaxDays),
    sickDays: input.sickDays === null || input.sickDays === undefined ? null : str(input.sickDays),
    updatedAt: new Date(),
  };
  const [before] = await db.select().from(leavePolicies).where(eq(leavePolicies.memberId, memberId));
  const [after] = await db.insert(leavePolicies).values(values).onConflictDoUpdate({ target: leavePolicies.memberId, set: values }).returning();
  if (before) {
    const diff = diffRecords(before as Record<string, unknown>, after as Record<string, unknown>);
    delete diff['updatedAt'];
    if (Object.keys(diff).length > 0) await recordAudit(actor, 'leave_policies', memberId, 'update', diff);
  } else {
    await recordAudit(actor, 'leave_policies', memberId, 'create', after);
  }
  return toPolicyView(memberId, after, await getLeaveSettings());
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export async function listRequests(q: { from?: string; to?: string; memberId?: string; status?: string }): Promise<LeaveRequestView[]> {
  const where = [isNull(teamMembers.deletedAt)];
  if (q.from) where.push(gte(leaveRequests.endDate, q.from));
  if (q.to) where.push(lte(leaveRequests.startDate, q.to));
  if (q.memberId) where.push(eq(leaveRequests.memberId, q.memberId));
  if (q.status) where.push(eq(leaveRequests.status, q.status));
  const rows = await db
    .select({ r: leaveRequests, firstName: teamMembers.firstName, lastName: teamMembers.lastName })
    .from(leaveRequests)
    .innerJoin(teamMembers, eq(teamMembers.id, leaveRequests.memberId))
    .where(and(...where))
    .orderBy(asc(leaveRequests.startDate));
  return rows.map(({ r, firstName, lastName }) => toRequestView(r, `${firstName} ${lastName}`.trim()));
}

export async function createRequest(input: LeaveRequestInput, actor?: Actor): Promise<LeaveRequestView> {
  const m = await findMember(input.memberId);
  const days = input.days ?? workingDays(input.startDate, input.endDate);
  const [row] = await db
    .insert(leaveRequests)
    .values({
      memberId: input.memberId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      days: str(days),
      status: input.status,
      paid: input.paid ?? input.type !== 'unpaid',
      notes: input.notes ?? null,
      createdByEmail: actor?.email ?? null,
    })
    .returning();
  await recordAudit(actor, 'leave_requests', row!.id, 'create', row);
  return toRequestView(row!, `${m.firstName} ${m.lastName}`.trim());
}

export async function updateRequest(id: string, patch: LeaveRequestPatch, actor?: Actor): Promise<LeaveRequestView> {
  const [before] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
  if (!before) throw new ApiError(404, 'Leave request not found');
  const startDate = patch.startDate ?? before.startDate;
  const endDate = patch.endDate ?? before.endDate;
  if (endDate < startDate) throw new ApiError(400, 'endDate must not be before startDate');
  const datesChanged = startDate !== before.startDate || endDate !== before.endDate;
  const days = patch.days !== undefined ? patch.days : datesChanged ? workingDays(startDate, endDate) : num(before.days);
  const type = patch.type ?? before.type;
  const [after] = await db
    .update(leaveRequests)
    .set({
      type,
      startDate,
      endDate,
      days: str(days),
      status: patch.status ?? before.status,
      paid: patch.paid !== undefined ? patch.paid : patch.type !== undefined ? type !== 'unpaid' : before.paid,
      notes: patch.notes !== undefined ? patch.notes : before.notes,
      updatedAt: new Date(),
    })
    .where(eq(leaveRequests.id, id))
    .returning();
  const diff = diffRecords(before as Record<string, unknown>, after as Record<string, unknown>);
  delete diff['updatedAt'];
  if (Object.keys(diff).length > 0) await recordAudit(actor, 'leave_requests', id, 'update', diff);
  return toRequestView(after!);
}

export async function deleteRequest(id: string, actor?: Actor): Promise<void> {
  const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
  if (!row) throw new ApiError(404, 'Leave request not found');
  await db.delete(leaveRequests).where(eq(leaveRequests.id, id));
  await recordAudit(actor, 'leave_requests', id, 'delete', row);
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

export async function addAdjustment(memberId: string, input: LeaveAdjustmentInput, actor?: Actor): Promise<LeaveAdjustmentView> {
  await findMember(memberId);
  const [row] = await db
    .insert(leaveAdjustments)
    .values({ memberId, date: input.date, days: str(input.days), reason: input.reason, createdByEmail: actor?.email ?? null })
    .returning();
  await recordAudit(actor, 'leave_adjustments', row!.id, 'create', row);
  return toAdjustmentView(row!);
}

export async function deleteAdjustment(memberId: string, id: string, actor?: Actor): Promise<void> {
  const [row] = await db
    .select()
    .from(leaveAdjustments)
    .where(and(eq(leaveAdjustments.id, id), eq(leaveAdjustments.memberId, memberId)));
  if (!row) throw new ApiError(404, 'Adjustment not found');
  await db.delete(leaveAdjustments).where(eq(leaveAdjustments.id, id));
  await recordAudit(actor, 'leave_adjustments', id, 'delete', row);
}
