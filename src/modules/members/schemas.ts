import { z } from 'zod';
import {
  COMPENSATION_REASONS,
  EMPLOYMENT_TYPES,
  MEMBER_STATUSES,
  PAYOUT_METHODS,
  PAY_FREQUENCIES,
  PAY_PERIODS,
  WISE_RECIPIENT_KINDS,
} from '../../db/schema.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const optionalText = z.string().trim().max(500).nullable().optional();
/** Empty string from a form means "clear it". */
const optionalDate = z.union([isoDate, z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v));

export const memberInputSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  preferredName: optionalText,
  email: z.string().trim().email().max(254).nullable().optional().or(z.literal('').transform(() => null)),
  phone: optionalText,
  country: optionalText,
  timezone: optionalText,
  jobTitle: optionalText,
  employmentType: z.enum(EMPLOYMENT_TYPES).default('contractor'),
  status: z.enum(MEMBER_STATUSES).default('active'),
  startDate: optionalDate,
  endDate: optionalDate,
  dateOfBirth: optionalDate,
  notes: z.string().trim().max(10_000).nullable().optional(),
});
export type MemberInput = z.infer<typeof memberInputSchema>;

export const memberPatchSchema = memberInputSchema.partial();
export type MemberPatch = z.infer<typeof memberPatchSchema>;

export const compensationInputSchema = z.object({
  amount: z.number().positive().max(9_999_999_999),
  currency: z.string().trim().length(3).toUpperCase().default('USD'),
  period: z.enum(PAY_PERIODS),
  effectiveFrom: isoDate,
  reason: z.enum(COMPENSATION_REASONS).default('pay_rise'),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type CompensationInput = z.infer<typeof compensationInputSchema>;

export const payScheduleInputSchema = z.object({
  frequency: z.enum(PAY_FREQUENCIES).default('weekly'),
  payDay: z.number().int().min(1).max(31).nullable().optional(),
  payoutMethod: z.enum(PAYOUT_METHODS).default('wise'),
  wiseRecipientId: optionalText,
  wiseRecipientName: optionalText,
  wiseRecipientEmail: optionalText,
  wiseRecipientKind: z.enum(WISE_RECIPIENT_KINDS).nullable().optional(),
  wiseRecipientDetail: optionalText,
  targetCurrency: z.string().trim().length(3).toUpperCase().nullable().optional().or(z.literal('').transform(() => null)),
  invoicePrefix: optionalText,
  nextInvoiceNumber: z.number().int().min(0).nullable().optional(),
  thirteenthMonth: z.boolean().default(false),
  thirteenthMonthPayMonth: z.number().int().min(1).max(12).default(12),
});
export type PayScheduleInput = z.infer<typeof payScheduleInputSchema>;

/** Columns accepted by the CSV importer, in template order. */
export const IMPORT_COLUMNS = [
  'first_name',
  'last_name',
  'preferred_name',
  'email',
  'phone',
  'country',
  'timezone',
  'job_title',
  'employment_type',
  'status',
  'start_date',
  'end_date',
  'date_of_birth',
  'notes',
  'pay_amount',
  'pay_currency',
  'pay_period',
  'pay_effective_from',
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
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const importRequestSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  dryRun: z.boolean().default(true),
});
