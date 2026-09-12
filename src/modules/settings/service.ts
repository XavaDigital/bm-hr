import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { settings } from '../../db/schema.js';
import { recordAudit, type Actor } from '../../audit.js';

/** Header row of the saved-recipients batch template downloaded from the Wise account (docs/wise-template-header.csv). */
export const DEFAULT_WISE_HEADERS = [
  'recipientId',
  'name',
  'recipientEmail',
  'recipientDetail',
  'sourceCurrency',
  'targetCurrency',
  'amountCurrency',
  'amount',
  'paymentReference',
  'referenceNumber',
  'receiverType',
];

const feeModelSchema = z.object({
  amountMode: z.enum(['source', 'target']),
  feeFixed: z.number().min(0).max(1000).default(0),
  feePct: z.number().min(0).max(0.5).default(0),
});

export const wiseSettingsSchema = z.object({
  sourceCurrency: z.string().trim().length(3).toUpperCase().default('USD'),
  headers: z.array(z.string().trim().min(1)).min(1).default(DEFAULT_WISE_HEADERS),
  kinds: z
    .object({
      gcash: feeModelSchema.default({ amountMode: 'source', feeFixed: 0, feePct: 0 }),
      wise_account: feeModelSchema.default({ amountMode: 'target', feeFixed: 0, feePct: 0 }),
    })
    .default({
      gcash: { amountMode: 'source', feeFixed: 0, feePct: 0 },
      wise_account: { amountMode: 'target', feeFixed: 0, feePct: 0 },
    }),
});
export type WiseSettings = z.infer<typeof wiseSettingsSchema>;

export const DEFAULT_WISE_SETTINGS: WiseSettings = wiseSettingsSchema.parse({});

export const leaveSettingsSchema = z.object({
  leaveYearStart: z.string().regex(/^\d{2}-\d{2}$/, 'MM-DD').default('01-01'),
  annualEntitlementDays: z.number().min(0).max(365).default(10),
  accrual: z.enum(['front_loaded', 'monthly']).default('monthly'),
  carryOverMaxDays: z.number().min(0).max(365).default(5),
  sickDays: z.number().min(0).max(365).nullable().default(null),
  /** Months since the last pay rise (or start) after which the dashboard flags someone. */
  payRiseDueMonths: z.number().int().min(1).max(120).default(12),
});
export type LeaveSettings = z.infer<typeof leaveSettingsSchema>;
export const DEFAULT_LEAVE_SETTINGS: LeaveSettings = leaveSettingsSchema.parse({});

const LEAVE_KEY = 'leave';

export async function getLeaveSettings(): Promise<LeaveSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, LEAVE_KEY));
  if (!row) return DEFAULT_LEAVE_SETTINGS;
  const parsed = leaveSettingsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_LEAVE_SETTINGS;
}

export async function putLeaveSettings(input: unknown, actor?: Actor): Promise<LeaveSettings> {
  const value = leaveSettingsSchema.parse(input);
  await db
    .insert(settings)
    .values({ key: LEAVE_KEY, value, updatedBy: actor?.email ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: actor?.email ?? null, updatedAt: new Date() } });
  await recordAudit(actor, 'settings', LEAVE_KEY, 'update', value);
  return value;
}

const WISE_KEY = 'wise';

export async function getWiseSettings(): Promise<WiseSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, WISE_KEY));
  if (!row) return DEFAULT_WISE_SETTINGS;
  const parsed = wiseSettingsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_WISE_SETTINGS;
}

export async function putWiseSettings(input: unknown, actor?: Actor): Promise<WiseSettings> {
  const value = wiseSettingsSchema.parse(input);
  await db
    .insert(settings)
    .values({ key: WISE_KEY, value, updatedBy: actor?.email ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: actor?.email ?? null, updatedAt: new Date() } });
  await recordAudit(actor, 'settings', WISE_KEY, 'update', value);
  return value;
}
