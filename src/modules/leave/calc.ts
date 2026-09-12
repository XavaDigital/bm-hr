/**
 * Pure leave arithmetic. Dates are ISO strings (YYYY-MM-DD), days are
 * decimal working days. No database access here; everything is unit-tested.
 */

export type Accrual = 'front_loaded' | 'monthly';

export interface PolicyLike {
  /** MM-DD */
  leaveYearStart: string;
  annualEntitlementDays: number;
  accrual: Accrual;
  carryOverMaxDays: number;
  sickDays: number | null;
}

export interface RequestLike {
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  paid: boolean;
}

export interface AdjustmentLike {
  date: string;
  days: number;
}

export interface LeaveBalance {
  yearStart: string;
  yearEnd: string;
  /** Unused days brought in from the previous leave year (capped). */
  carryIn: number;
  /** Full-year entitlement, pro-rated for a start date inside the year. */
  entitlement: number;
  /** Portion of the entitlement earned so far this year. */
  accruedToDate: number;
  adjustments: number;
  /** Approved annual leave already in the past this year. */
  taken: number;
  /** Approved annual leave still in the future this year. */
  booked: number;
  /** Requested, not yet approved, this year. */
  pending: number;
  /** carryIn + accruedToDate + adjustments − taken − booked. */
  available: number;
  /** What the balance will be once the whole year has accrued. */
  availableAtYearEnd: number;
  sickTaken: number;
  sickDays: number | null;
  unpaidTaken: number;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

const MS_DAY = 86_400_000;
const toUtc = (iso: string): number => Date.parse(iso + 'T00:00:00Z');
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number): string => fromUtc(toUtc(iso) + n * MS_DAY);

/** Inclusive count of Mon–Fri days between two dates. */
export function workingDays(start: string, end: string): number {
  if (end < start) return 0;
  let n = 0;
  for (let t = toUtc(start); t <= toUtc(end); t += MS_DAY) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

/** The leave year containing `date`, as [start, end] inclusive. */
export function leaveYearFor(leaveYearStart: string, date: string): [string, string] {
  const y = Number(date.slice(0, 4));
  const startThisYear = `${y}-${leaveYearStart}`;
  const start = startThisYear <= date ? startThisYear : `${y - 1}-${leaveYearStart}`;
  const nextStart = `${Number(start.slice(0, 4)) + 1}-${leaveYearStart}`;
  return [start, addDays(nextStart, -1)];
}

/** Whole months completed from `from` to `to` (same-day-of-month counts as complete). */
export function completedMonths(from: string, to: string): number {
  if (to < from) return 0;
  const a = new Date(toUtc(from));
  const b = new Date(toUtc(to));
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** Entitlement for a year, pro-rated by calendar days when the person started inside it. */
export function proratedEntitlement(entitlement: number, yearStart: string, yearEnd: string, memberStart: string | null): number {
  if (!memberStart || memberStart <= yearStart) return round2(entitlement);
  if (memberStart > yearEnd) return 0;
  const total = (toUtc(yearEnd) - toUtc(yearStart)) / MS_DAY + 1;
  const remaining = (toUtc(yearEnd) - toUtc(memberStart)) / MS_DAY + 1;
  return round2((entitlement * remaining) / total);
}

/** How much of the year's entitlement has been earned by `asOf`. */
export function accruedToDate(policy: PolicyLike, yearStart: string, yearEnd: string, memberStart: string | null, asOf: string): number {
  const full = proratedEntitlement(policy.annualEntitlementDays, yearStart, yearEnd, memberStart);
  if (asOf < yearStart) return 0;
  if (policy.accrual === 'front_loaded' || asOf >= yearEnd) return full;
  const anchor = memberStart && memberStart > yearStart ? memberStart : yearStart;
  const months = completedMonths(anchor, asOf);
  return round2(Math.min(full, (policy.annualEntitlementDays * months) / 12));
}

const inYear = (d: string, ys: string, ye: string): boolean => d >= ys && d <= ye;
const sum = (xs: number[]): number => round2(xs.reduce((a, b) => a + b, 0));

/** Which annual-leave requests count against the balance. */
const countsAgainstBalance = (r: RequestLike): boolean => r.type === 'annual' && r.paid && r.status === 'approved';

export function computeBalance(
  policy: PolicyLike,
  memberStart: string | null,
  requests: RequestLike[],
  adjustments: AdjustmentLike[],
  today: string,
): LeaveBalance {
  const [curStart, curEnd] = leaveYearFor(policy.leaveYearStart, today);

  // Walk past years from the earliest relevant date to build the carry-in.
  const earliest = [memberStart, ...requests.map((r) => r.startDate), ...adjustments.map((a) => a.date)]
    .filter((d): d is string => !!d)
    .sort()[0];
  let carryIn = 0;
  if (earliest && earliest < curStart) {
    let [ys, ye] = leaveYearFor(policy.leaveYearStart, earliest);
    while (ye < curStart) {
      const entitlement = proratedEntitlement(policy.annualEntitlementDays, ys, ye, memberStart);
      const adj = sum(adjustments.filter((a) => inYear(a.date, ys, ye)).map((a) => a.days));
      const used = sum(requests.filter((r) => countsAgainstBalance(r) && inYear(r.startDate, ys, ye)).map((r) => r.days));
      const closing = round2(carryIn + entitlement + adj - used);
      carryIn = closing > policy.carryOverMaxDays ? policy.carryOverMaxDays : closing;
      [ys, ye] = leaveYearFor(policy.leaveYearStart, addDays(ye, 1));
    }
  }

  const entitlement = proratedEntitlement(policy.annualEntitlementDays, curStart, curEnd, memberStart);
  const accrued = accruedToDate(policy, curStart, curEnd, memberStart, today);
  const thisYear = requests.filter((r) => inYear(r.startDate, curStart, curEnd));
  const adj = sum(adjustments.filter((a) => inYear(a.date, curStart, curEnd)).map((a) => a.days));
  const taken = sum(thisYear.filter((r) => countsAgainstBalance(r) && r.startDate <= today).map((r) => r.days));
  const booked = sum(thisYear.filter((r) => countsAgainstBalance(r) && r.startDate > today).map((r) => r.days));
  const pending = sum(thisYear.filter((r) => r.type === 'annual' && r.status === 'requested').map((r) => r.days));
  const sickTaken = sum(thisYear.filter((r) => r.type === 'sick' && r.status === 'approved').map((r) => r.days));
  const unpaidTaken = sum(thisYear.filter((r) => (r.type === 'unpaid' || !r.paid) && r.status === 'approved').map((r) => r.days));

  return {
    yearStart: curStart,
    yearEnd: curEnd,
    carryIn: round2(carryIn),
    entitlement,
    accruedToDate: accrued,
    adjustments: adj,
    taken,
    booked,
    pending,
    available: round2(carryIn + accrued + adj - taken - booked),
    availableAtYearEnd: round2(carryIn + entitlement + adj - taken - booked),
    sickTaken,
    sickDays: policy.sickDays,
    unpaidTaken,
  };
}
