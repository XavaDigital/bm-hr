/**
 * bm-hr data model, Phase 1 (PLAN.md §4): who is on the team, what they are
 * paid (append-only history), how and when they are paid, and an audit log.
 * Leave, pay runs, onboarding and the notes timeline arrive in later phases.
 *
 * Identity users are referenced by their bm-identity uuid/email in actor
 * columns only — there is no local users table and no local role (fleet
 * access contract).
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const hr = pgSchema('hr');

export const EMPLOYMENT_TYPES = ['employee', 'contractor'] as const;
export const MEMBER_STATUSES = ['onboarding', 'active', 'offboarded'] as const;
export const PAY_PERIODS = ['weekly', 'fortnightly', 'monthly', 'annual'] as const;
export const COMPENSATION_REASONS = ['initial', 'pay_rise', 'adjustment'] as const;
export const PAY_FREQUENCIES = ['weekly', 'fortnightly', 'monthly'] as const;
export const PAYOUT_METHODS = ['wise', 'xero_bank', 'other'] as const;
export const WISE_RECIPIENT_KINDS = ['gcash', 'wise_account'] as const;

export const teamMembers = hr.table(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    preferredName: text('preferred_name'),
    email: text('email'),
    phone: text('phone'),
    country: text('country'),
    timezone: text('timezone'),
    jobTitle: text('job_title'),
    employmentType: text('employment_type').notNull().default('contractor'),
    status: text('status').notNull().default('active'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    dateOfBirth: date('date_of_birth'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete: an accidental record can be removed without losing history. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_hr_members_email')
      .on(sql`lower(${t.email})`)
      .where(sql`${t.deletedAt} is null and ${t.email} is not null`),
    index('idx_hr_members_status').on(t.status),
  ],
);

export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;

/**
 * Pay history, append-only. Current pay = latest row whose effective_from is
 * not in the future; last pay rise = latest row with reason 'pay_rise'.
 */
export const compensation = hr.table(
  'compensation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    period: text('period').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    reason: text('reason').notNull().default('pay_rise'),
    notes: text('notes'),
    createdBy: text('created_by'),
    createdByEmail: text('created_by_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_hr_compensation_member').on(t.memberId, t.effectiveFrom)],
);

export type Compensation = typeof compensation.$inferSelect;

/**
 * How and when each person is paid. Wise recipients are referenced by the id
 * Wise assigned them; bank and wallet details never live here.
 */
export const paySchedules = hr.table('pay_schedules', {
  memberId: uuid('member_id')
    .primaryKey()
    .references(() => teamMembers.id),
  frequency: text('frequency').notNull().default('weekly'),
  /** Weekday 1 (Mon) to 7 (Sun) for weekly/fortnightly; day of month for monthly. */
  payDay: integer('pay_day'),
  payoutMethod: text('payout_method').notNull().default('wise'),
  wiseRecipientId: text('wise_recipient_id'),
  wiseRecipientName: text('wise_recipient_name'),
  wiseRecipientEmail: text('wise_recipient_email'),
  wiseRecipientKind: text('wise_recipient_kind'),
  wiseRecipientDetail: text('wise_recipient_detail'),
  targetCurrency: text('target_currency'),
  invoicePrefix: text('invoice_prefix'),
  nextInvoiceNumber: integer('next_invoice_number'),
  /** Zero-pad width for the reference number (INV0008 = 4, INV022 = 3, INV 104 = 0). */
  invoicePad: integer('invoice_pad').notNull().default(0),
  thirteenthMonth: boolean('thirteenth_month').notNull().default(false),
  thirteenthMonthPayMonth: integer('thirteenth_month_pay_month').notNull().default(12),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PaySchedule = typeof paySchedules.$inferSelect;

/** Key/value app settings (e.g. the Wise export configuration). */
export const settings = hr.table('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const PAY_RUN_STATUSES = ['draft', 'exported', 'paid'] as const;
export const AMOUNT_MODES = ['source', 'target'] as const;

/**
 * One pay run per pay date. draft → exported (CSV handed to Wise; lines are
 * frozen) → paid. Amounts on lines are snapshots so history never shifts.
 */
export const payRuns = hr.table(
  'pay_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payDate: date('pay_date').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    frequency: text('frequency').notNull().default('weekly'),
    sourceCurrency: text('source_currency').notNull().default('USD'),
    status: text('status').notNull().default('draft'),
    notes: text('notes'),
    exportedAt: timestamp('exported_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdBy: text('created_by'),
    createdByEmail: text('created_by_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_hr_pay_runs_date').on(t.payDate)],
);

export type PayRun = typeof payRuns.$inferSelect;

/**
 * One line per person per run. net = base + 13th month + adjustments (all in
 * the run's source currency). export_amount is what goes in the Wise file:
 * in `source` mode it is net grossed up by the fee model so the recipient
 * receives net after Wise's fee; in `target` mode it is net itself.
 */
export const payRunLines = hr.table(
  'pay_run_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payRunId: uuid('pay_run_id')
      .notNull()
      .references(() => payRuns.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    included: boolean('included').notNull().default(true),
    memberName: text('member_name').notNull().default(''),
    baseAmount: numeric('base_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    thirteenthMonthAmount: numeric('thirteenth_month_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    adjustmentsAmount: numeric('adjustments_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    adjustmentsNote: text('adjustments_note'),
    netAmount: numeric('net_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    amountMode: text('amount_mode').notNull().default('source'),
    feeFixed: numeric('fee_fixed', { precision: 12, scale: 2 }).notNull().default('0'),
    feePct: numeric('fee_pct', { precision: 9, scale: 6 }).notNull().default('0'),
    grossUpAmount: numeric('gross_up_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    exportAmount: numeric('export_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    exportCurrency: text('export_currency').notNull().default('USD'),
    paymentReference: text('payment_reference'),
    paymentReferenceManual: boolean('payment_reference_manual').notNull().default(false),
    recipientId: text('recipient_id'),
    recipientName: text('recipient_name'),
    recipientEmail: text('recipient_email'),
    recipientDetail: text('recipient_detail'),
    recipientKind: text('recipient_kind'),
    targetCurrency: text('target_currency'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_hr_pay_run_lines_member').on(t.payRunId, t.memberId), index('idx_hr_pay_run_lines_member').on(t.memberId)],
);

export type PayRunLine = typeof payRunLines.$inferSelect;

export const LEAVE_ACCRUALS = ['front_loaded', 'monthly'] as const;
export const LEAVE_TYPES = ['annual', 'sick', 'unpaid', 'public_holiday', 'other'] as const;
export const LEAVE_STATUSES = ['requested', 'approved', 'cancelled'] as const;

/**
 * Per-person leave rule. Balance = carry-in + accrued-to-date + adjustments
 * − approved annual days (see modules/leave/calc.ts). Defaults come from the
 * `leave` settings key; a row exists only once someone edits it.
 */
export const leavePolicies = hr.table('leave_policies', {
  memberId: uuid('member_id')
    .primaryKey()
    .references(() => teamMembers.id),
  /** MM-DD the leave year starts on. */
  leaveYearStart: text('leave_year_start').notNull().default('01-01'),
  annualEntitlementDays: numeric('annual_entitlement_days', { precision: 6, scale: 2 }).notNull().default('10'),
  accrual: text('accrual').notNull().default('monthly'),
  carryOverMaxDays: numeric('carry_over_max_days', { precision: 6, scale: 2 }).notNull().default('5'),
  sickDays: numeric('sick_days', { precision: 6, scale: 2 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LeavePolicy = typeof leavePolicies.$inferSelect;

export const leaveRequests = hr.table(
  'leave_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    type: text('type').notNull().default('annual'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    /** Working days, editable (half days allowed). */
    days: numeric('days', { precision: 6, scale: 2 }).notNull(),
    status: text('status').notNull().default('approved'),
    paid: boolean('paid').notNull().default(true),
    notes: text('notes'),
    createdByEmail: text('created_by_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_hr_leave_requests_member').on(t.memberId, t.startDate), index('idx_hr_leave_requests_dates').on(t.startDate, t.endDate)],
);

export type LeaveRequest = typeof leaveRequests.$inferSelect;

/** Manual balance corrections (+/- days), e.g. an opening balance from the old spreadsheet. */
export const leaveAdjustments = hr.table(
  'leave_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    date: date('date').notNull(),
    days: numeric('days', { precision: 6, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    createdByEmail: text('created_by_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_hr_leave_adjustments_member').on(t.memberId, t.date)],
);

export type LeaveAdjustment = typeof leaveAdjustments.$inferSelect;

export const CHECKLIST_KINDS = ['onboarding', 'offboarding'] as const;

export interface ChecklistTemplateItem {
  title: string;
  /** Days after the start date (onboarding) or end date (offboarding); null = no due date. */
  dueDays: number | null;
}

/** Reusable onboarding/offboarding checklists. */
export const checklistTemplates = hr.table('checklist_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('onboarding'),
  items: jsonb('items').$type<ChecklistTemplateItem[]>().notNull().default([]),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;

/** One person's checklist tasks, created from a template or by hand. */
export const checklistTasks = hr.table(
  'checklist_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    kind: text('kind').notNull().default('onboarding'),
    title: text('title').notNull(),
    dueDate: date('due_date'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneByEmail: text('done_by_email'),
    sortOrder: integer('sort_order').notNull().default(0),
    templateId: uuid('template_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_hr_checklist_tasks_member').on(t.memberId, t.kind)],
);

export type ChecklistTask = typeof checklistTasks.$inferSelect;

export const EVENT_TYPES = ['note', 'review', 'warning', 'milestone', 'other'] as const;

/** Free-text timeline per person: notes, reviews, warnings, milestones. */
export const memberEvents = hr.table(
  'member_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    date: date('date').notNull(),
    type: text('type').notNull().default('note'),
    text: text('text').notNull(),
    createdByEmail: text('created_by_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_hr_member_events_member').on(t.memberId, t.date)],
);

export type MemberEvent = typeof memberEvents.$inferSelect;

/** Every write, with who did it and what changed. */
export const auditLog = hr.table(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: text('actor_id'),
    actorEmail: text('actor_email'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    action: text('action').notNull(),
    diff: jsonb('diff'),
  },
  (t) => [index('idx_hr_audit_row').on(t.tableName, t.rowId)],
);
