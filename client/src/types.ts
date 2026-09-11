export type EmploymentType = 'employee' | 'contractor';
export type MemberStatus = 'onboarding' | 'active' | 'offboarded';
export type PayPeriod = 'weekly' | 'fortnightly' | 'monthly' | 'annual';
export type CompensationReason = 'initial' | 'pay_rise' | 'adjustment';
export type PayFrequency = 'weekly' | 'fortnightly' | 'monthly';
export type PayoutMethod = 'wise' | 'xero_bank' | 'other';
export type WiseRecipientKind = 'gcash' | 'wise_account';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface TeamMember {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  timezone: string | null;
  jobTitle: string | null;
  employmentType: EmploymentType;
  status: MemberStatus;
  startDate: string | null;
  endDate: string | null;
  dateOfBirth: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Compensation {
  id: string;
  memberId: string;
  amount: number;
  currency: string;
  period: PayPeriod;
  effectiveFrom: string;
  reason: CompensationReason;
  notes: string | null;
  createdByEmail: string | null;
  createdAt: string;
}

export interface PaySchedule {
  memberId: string;
  frequency: PayFrequency;
  payDay: number | null;
  payoutMethod: PayoutMethod;
  wiseRecipientId: string | null;
  wiseRecipientName: string | null;
  wiseRecipientEmail: string | null;
  wiseRecipientKind: WiseRecipientKind | null;
  wiseRecipientDetail: string | null;
  targetCurrency: string | null;
  invoicePrefix: string | null;
  nextInvoiceNumber: number | null;
  invoicePad: number;
  thirteenthMonth: boolean;
  thirteenthMonthPayMonth: number;
}

export type PayRunStatus = 'draft' | 'exported' | 'paid';
export type AmountMode = 'source' | 'target';

export interface PayRun {
  id: string;
  payDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  frequency: PayFrequency;
  sourceCurrency: string;
  status: PayRunStatus;
  notes: string | null;
  exportedAt: string | null;
  paidAt: string | null;
  createdByEmail: string | null;
  createdAt: string;
}

export interface PayRunLine {
  id: string;
  payRunId: string;
  memberId: string;
  included: boolean;
  memberName: string;
  baseAmount: number;
  thirteenthMonthAmount: number;
  adjustmentsAmount: number;
  adjustmentsNote: string | null;
  netAmount: number;
  amountMode: AmountMode;
  feeFixed: number;
  feePct: number;
  grossUpAmount: number;
  exportAmount: number;
  exportCurrency: string;
  paymentReference: string | null;
  paymentReferenceManual: boolean;
  recipientId: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  recipientDetail: string | null;
  recipientKind: WiseRecipientKind | null;
  targetCurrency: string | null;
}

export interface LineIssue {
  lineId: string;
  memberName: string;
  level: 'error' | 'warning';
  message: string;
}

export interface RunTotals {
  lines: number;
  included: number;
  netAmount: number;
  exportAmount: number;
  grossUpAmount: number;
}

export interface RunView {
  run: PayRun;
  lines: PayRunLine[];
  totals: RunTotals;
  issues: LineIssue[];
}

export interface RunSummary {
  run: PayRun;
  totals: RunTotals;
}

export interface PayHistoryEntry {
  runId: string;
  payDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: PayRunStatus;
  baseAmount: number;
  thirteenthMonthAmount: number;
  adjustmentsAmount: number;
  adjustmentsNote: string | null;
  netAmount: number;
  exportAmount: number;
  exportCurrency: string;
  paymentReference: string | null;
}

export interface FeeModel {
  amountMode: AmountMode;
  feeFixed: number;
  feePct: number;
}

export interface WiseSettings {
  sourceCurrency: string;
  headers: string[];
  kinds: { gcash: FeeModel; wise_account: FeeModel };
}

export const RUN_STATUS_LABELS: Record<PayRunStatus, string> = { draft: 'Draft', exported: 'Exported', paid: 'Paid' };
export const RUN_STATUS_COLOR: Record<PayRunStatus, string> = { draft: 'blue', exported: 'gold', paid: 'green' };

export interface MemberSummary {
  member: TeamMember;
  currentPay: Compensation | null;
  lastPayRise: Compensation | null;
  upcomingPay: Compensation[];
  schedule: PaySchedule | null;
  tenureMonths: number | null;
  nextAnniversary: string | null;
  daysToAnniversary: number | null;
  nextBirthday: string | null;
}

export interface MemberDetail extends MemberSummary {
  compensation: Compensation[];
}

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

export const STATUS_LABELS: Record<MemberStatus, string> = {
  onboarding: 'Onboarding',
  active: 'Active',
  offboarded: 'Offboarded',
};

export const PERIOD_LABELS: Record<PayPeriod, string> = {
  weekly: 'week',
  fortnightly: 'fortnight',
  monthly: 'month',
  annual: 'year',
};

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
