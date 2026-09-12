import { z } from 'zod';
import { LEAVE_ACCRUALS, LEAVE_STATUSES, LEAVE_TYPES } from '../../db/schema.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const leavePolicyInputSchema = z.object({
  leaveYearStart: z.string().regex(/^\d{2}-\d{2}$/, 'MM-DD').default('01-01'),
  annualEntitlementDays: z.number().min(0).max(365),
  accrual: z.enum(LEAVE_ACCRUALS).default('monthly'),
  carryOverMaxDays: z.number().min(0).max(365).default(0),
  sickDays: z.number().min(0).max(365).nullable().optional(),
});
export type LeavePolicyInput = z.infer<typeof leavePolicyInputSchema>;

export const leaveRequestInputSchema = z
  .object({
    memberId: z.string().uuid(),
    type: z.enum(LEAVE_TYPES).default('annual'),
    startDate: isoDate,
    endDate: isoDate,
    /** Omit to use the Mon–Fri count. */
    days: z.number().min(0).max(366).optional(),
    status: z.enum(LEAVE_STATUSES).default('approved'),
    paid: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'endDate must not be before startDate', path: ['endDate'] });
export type LeaveRequestInput = z.infer<typeof leaveRequestInputSchema>;

export const leaveRequestPatchSchema = z
  .object({
    type: z.enum(LEAVE_TYPES).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    days: z.number().min(0).max(366).optional(),
    status: z.enum(LEAVE_STATUSES).optional(),
    paid: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { message: 'endDate must not be before startDate', path: ['endDate'] });
export type LeaveRequestPatch = z.infer<typeof leaveRequestPatchSchema>;

export const leaveAdjustmentInputSchema = z.object({
  date: isoDate,
  days: z.number().min(-365).max(365).refine((n) => n !== 0, 'days cannot be zero'),
  reason: z.string().trim().min(1).max(500),
});
export type LeaveAdjustmentInput = z.infer<typeof leaveAdjustmentInputSchema>;

export const listRequestsQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  memberId: z.string().uuid().optional(),
  status: z.enum(LEAVE_STATUSES).optional(),
});
