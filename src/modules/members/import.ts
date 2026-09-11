/**
 * CSV import: one row per person, matched to existing members by email.
 * Member fields present in the file are applied; a pay_amount adds a
 * compensation row unless an identical one exists; wise_/pay columns upsert
 * the pay schedule. Dry-run returns the plan without writing.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { compensation, paySchedules } from '../../db/schema.js';
import type { Actor } from '../../audit.js';
import { recordAudit } from '../../audit.js';
import { parseCsvObjects, toCsv } from './csv.js';
import {
  IMPORT_COLUMNS,
  compensationInputSchema,
  memberInputSchema,
  memberPatchSchema,
  payScheduleInputSchema,
  type CompensationInput,
  type MemberInput,
  type MemberPatch,
  type PayScheduleInput,
} from './schemas.js';
import { addCompensation, createMember, findMemberByEmail, updateMember, upsertPaySchedule } from './service.js';

export interface ImportRowPlan {
  line: number;
  name: string;
  email: string | null;
  action: 'create' | 'update' | 'skip' | 'error';
  changes: string[];
  errors: string[];
}

export interface ImportResult {
  dryRun: boolean;
  rows: ImportRowPlan[];
  counts: { create: number; update: number; skip: number; error: number };
}

export function importTemplateCsv(): string {
  return toCsv(IMPORT_COLUMNS, [
    [
      'Juan',
      'Dela Cruz',
      'Juan',
      'juan@example.com',
      '+63 917 000 0000',
      'PH',
      'Asia/Manila',
      'Designer',
      'contractor',
      'active',
      '2024-03-04',
      '',
      '',
      '',
      '200',
      'USD',
      'weekly',
      '2024-03-04',
      'weekly',
      '5',
      'wise',
      '00000000-0000-0000-0000-000000000000',
      'Juan Dela Cruz',
      'juan@example.com',
      'gcash',
      'GCash · 639170000000',
      'PHP',
      'INV',
      '1',
      'true',
    ],
  ]);
}

const blankToUndef = (v: string | undefined): string | undefined => (v === undefined || v === '' ? undefined : v);
const parseBool = (v: string | undefined): boolean | undefined => {
  const s = blankToUndef(v)?.toLowerCase();
  if (s === undefined) return undefined;
  return ['true', 'yes', 'y', '1'].includes(s);
};
const parseNum = (v: string | undefined): number | undefined => {
  const s = blankToUndef(v);
  if (s === undefined) return undefined;
  const n = Number(s.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

function memberFields(r: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map: Record<string, keyof MemberInput> = {
    first_name: 'firstName',
    last_name: 'lastName',
    preferred_name: 'preferredName',
    email: 'email',
    phone: 'phone',
    country: 'country',
    timezone: 'timezone',
    job_title: 'jobTitle',
    employment_type: 'employmentType',
    status: 'status',
    start_date: 'startDate',
    end_date: 'endDate',
    date_of_birth: 'dateOfBirth',
    notes: 'notes',
  };
  for (const [col, key] of Object.entries(map)) {
    if (col in r && blankToUndef(r[col]) !== undefined) out[key] = r[col];
  }
  return out;
}

function compensationFields(r: Record<string, string>): Record<string, unknown> | null {
  const amount = parseNum(r['pay_amount']);
  if (amount === undefined) return null;
  return {
    amount,
    currency: blankToUndef(r['pay_currency']) ?? 'USD',
    period: blankToUndef(r['pay_period']) ?? 'weekly',
    effectiveFrom: blankToUndef(r['pay_effective_from']) ?? blankToUndef(r['start_date']),
    reason: 'initial',
  };
}

function scheduleFields(r: Record<string, string>): Record<string, unknown> | null {
  const cols = [
    'frequency',
    'pay_day',
    'payout_method',
    'wise_recipient_id',
    'wise_recipient_name',
    'wise_recipient_email',
    'wise_recipient_kind',
    'wise_recipient_detail',
    'target_currency',
    'invoice_prefix',
    'next_invoice_number',
    'thirteenth_month',
  ];
  if (!cols.some((c) => blankToUndef(r[c]) !== undefined)) return null;
  const out: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => {
    if (v !== undefined) out[k] = v;
  };
  set('frequency', blankToUndef(r['frequency']));
  set('payDay', parseNum(r['pay_day']));
  set('payoutMethod', blankToUndef(r['payout_method']));
  set('wiseRecipientId', blankToUndef(r['wise_recipient_id']));
  set('wiseRecipientName', blankToUndef(r['wise_recipient_name']));
  set('wiseRecipientEmail', blankToUndef(r['wise_recipient_email']));
  set('wiseRecipientKind', blankToUndef(r['wise_recipient_kind']));
  set('wiseRecipientDetail', blankToUndef(r['wise_recipient_detail']));
  set('targetCurrency', blankToUndef(r['target_currency']));
  set('invoicePrefix', blankToUndef(r['invoice_prefix']));
  set('nextInvoiceNumber', parseNum(r['next_invoice_number']));
  set('thirteenthMonth', parseBool(r['thirteenth_month']));
  return out;
}

function zodMessages(err: z.ZodError, prefix: string): string[] {
  return err.issues.map((i) => `${prefix}${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`);
}

interface PlannedRow extends ImportRowPlan {
  memberId?: string;
  member?: MemberInput | MemberPatch;
  comp?: CompensationInput;
  schedule?: PayScheduleInput;
}

async function planRow(line: number, r: Record<string, string>): Promise<PlannedRow> {
  const name = `${r['first_name'] ?? ''} ${r['last_name'] ?? ''}`.trim();
  const email = blankToUndef(r['email']) ?? null;
  const plan: PlannedRow = { line, name, email, action: 'skip', changes: [], errors: [] };

  const existing = email ? await findMemberByEmail(email) : undefined;
  const rawMember = memberFields(r);
  const parsedMember = existing ? memberPatchSchema.safeParse(rawMember) : memberInputSchema.safeParse(rawMember);
  if (!parsedMember.success) plan.errors.push(...zodMessages(parsedMember.error, ''));

  const rawComp = compensationFields(r);
  if (rawComp) {
    const parsed = compensationInputSchema.safeParse(rawComp);
    if (parsed.success) plan.comp = parsed.data;
    else plan.errors.push(...zodMessages(parsed.error, 'pay: '));
  }

  const rawSched = scheduleFields(r);
  if (rawSched) {
    const parsed = payScheduleInputSchema.safeParse(rawSched);
    if (parsed.success) plan.schedule = parsed.data;
    else plan.errors.push(...zodMessages(parsed.error, 'schedule: '));
  }

  if (plan.errors.length > 0) {
    plan.action = 'error';
    return plan;
  }

  if (existing) {
    plan.memberId = existing.id;
    const patch = parsedMember.data as MemberPatch;
    const changed = Object.entries(patch).filter(([k, v]) => {
      const cur = (existing as Record<string, unknown>)[k];
      // The row was matched on email, so a case-only difference is not a change.
      if (k === 'email' && typeof cur === 'string' && typeof v === 'string') return cur.toLowerCase() !== v.toLowerCase();
      return cur !== v;
    });
    if (changed.length > 0) {
      plan.member = Object.fromEntries(changed) as MemberPatch;
      plan.changes.push(...changed.map(([k]) => `member.${k}`));
    }
    if (plan.comp) {
      const c = plan.comp;
      const [dupe] = await db
        .select({ id: compensation.id })
        .from(compensation)
        .where(
          and(
            eq(compensation.memberId, existing.id),
            eq(compensation.amount, c.amount.toFixed(2)),
            eq(compensation.currency, c.currency),
            eq(compensation.period, c.period),
            eq(compensation.effectiveFrom, c.effectiveFrom),
          ),
        );
      if (dupe) delete plan.comp;
      else plan.changes.push(`pay ${c.amount} ${c.currency}/${c.period} from ${c.effectiveFrom}`);
    }
    if (plan.schedule) {
      const [cur] = await db.select().from(paySchedules).where(eq(paySchedules.memberId, existing.id));
      const diffs = Object.entries(plan.schedule).filter(([k, v]) => (cur as Record<string, unknown> | undefined)?.[k] !== v);
      if (cur && diffs.length === 0) delete plan.schedule;
      else plan.changes.push(...diffs.map(([k]) => `schedule.${k}`));
    }
    plan.action = plan.changes.length > 0 ? 'update' : 'skip';
  } else {
    plan.member = parsedMember.data as MemberInput;
    plan.action = 'create';
    plan.changes.push('member');
    if (plan.comp) plan.changes.push(`pay ${plan.comp.amount} ${plan.comp.currency}/${plan.comp.period} from ${plan.comp.effectiveFrom}`);
    if (plan.schedule) plan.changes.push('schedule');
  }
  return plan;
}

export async function importMembersCsv(csv: string, dryRun: boolean, actor?: Actor): Promise<ImportResult> {
  const { headers, rows } = parseCsvObjects(csv);
  const known = new Set<string>(IMPORT_COLUMNS);
  const unknown = headers.filter((h) => !known.has(h));
  if (!headers.includes('first_name') || !headers.includes('last_name')) {
    throw Object.assign(new Error('CSV must have first_name and last_name columns'), { status: 400 });
  }
  const plans: PlannedRow[] = [];
  const seenEmails = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const plan = await planRow(i + 2, r);
    if (plan.email) {
      const key = plan.email.toLowerCase();
      if (seenEmails.has(key)) {
        plan.action = 'error';
        plan.errors.push(`duplicate email in file: ${plan.email}`);
      }
      seenEmails.add(key);
    }
    if (unknown.length > 0 && i === 0) plan.errors.push(`ignored unknown columns: ${unknown.join(', ')}`);
    plans.push(plan);
  }

  if (!dryRun) {
    for (const p of plans) {
      if (p.action === 'error' || p.action === 'skip') continue;
      let memberId = p.memberId;
      if (p.action === 'create') {
        const created = await createMember(p.member as MemberInput, actor);
        memberId = created.id;
      } else if (p.member && memberId) {
        await updateMember(memberId, p.member as MemberPatch, actor);
      }
      if (!memberId) continue;
      if (p.comp) await addCompensation(memberId, p.comp, actor);
      if (p.schedule) {
        const merged = p.action === 'update' ? { ...(await currentSchedule(memberId)), ...p.schedule } : p.schedule;
        await upsertPaySchedule(memberId, payScheduleInputSchema.parse(merged), actor);
      }
    }
    await recordAudit(actor, 'team_members', 'import', 'import', {
      rows: plans.length,
      created: plans.filter((p) => p.action === 'create').length,
      updated: plans.filter((p) => p.action === 'update').length,
    });
  }

  const counts = { create: 0, update: 0, skip: 0, error: 0 };
  for (const p of plans) counts[p.action]++;
  return {
    dryRun,
    counts,
    rows: plans.map(({ line, name, email, action, changes, errors }) => ({ line, name, email, action, changes, errors })),
  };
}

async function currentSchedule(memberId: string): Promise<Partial<PayScheduleInput>> {
  const [cur] = await db.select().from(paySchedules).where(eq(paySchedules.memberId, memberId));
  if (!cur) return {};
  const { memberId: _m, updatedAt: _u, ...rest } = cur;
  return rest as Partial<PayScheduleInput>;
}
