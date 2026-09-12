/**
 * Everything the home page shows, in one call. Read-only; computed from the
 * same summaries the team list uses.
 */
import { and, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { payRunLines, payRuns } from '../../db/schema.js';
import { progressFor, type ChecklistProgress } from '../checklists/service.js';
import { addDays, completedMonths, type LeaveBalance } from '../leave/calc.js';
import { balancesFor, isoToday, listRequests, type LeaveRequestView } from '../leave/service.js';
import { listMembers, type MemberSummary } from '../members/service.js';
import { listPayRuns, type RunSummary } from '../payruns/service.js';
import { getLeaveSettings } from '../settings/service.js';

export interface Dashboard {
  today: string;
  counts: { active: number; onboarding: number; offboardedThisYear: number };
  upcomingLeave: LeaveRequestView[];
  pendingRequests: LeaveRequestView[];
  anniversaries: { memberId: string; name: string; date: string; years: number; daysAway: number }[];
  birthdays: { memberId: string; name: string; date: string; daysAway: number }[];
  payRiseDue: { memberId: string; name: string; since: string; monthsSince: number; currentPay: string | null; thresholdMonths: number }[];
  thirteenthMonth: { memberId: string; name: string; payMonth: number; estimate: number | null; paidThisYear: boolean }[];
  onboarding: { memberId: string; name: string; startDate: string | null; jobTitle: string | null; progress: ChecklistProgress | null }[];
  lowLeave: { memberId: string; name: string; available: number }[];
  payRuns: { drafts: RunSummary[]; last: RunSummary | null; suggestedNextPayDate: string; hasRunForSuggested: boolean };
}

const name = (m: MemberSummary): string => `${m.member.firstName} ${m.member.lastName}`.trim();
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Next Friday on or after today. */
function nextFriday(today: string): string {
  const d = new Date(today + 'T00:00:00Z').getUTCDay();
  return addDays(today, (5 - d + 7) % 7);
}

export async function dashboard(today = isoToday()): Promise<Dashboard> {
  const [members, leaveSettings, runs] = await Promise.all([listMembers(), getLeaveSettings(), listPayRuns()]);
  const current = members.filter((m) => m.member.status !== 'offboarded');
  const horizon = addDays(today, 30);
  const year = today.slice(0, 4);
  const month = Number(today.slice(5, 7));
  const nextMonth = (month % 12) + 1;

  const [upcoming, pending, balances] = await Promise.all([
    listRequests({ from: today, to: horizon }),
    listRequests({ status: 'requested' }),
    balancesFor(
      current.map((m) => m.member),
      today,
    ),
  ]);

  // Who has already had a 13th-month amount in an exported/paid run this year?
  const thirteenthIds = new Set(
    (
      await db
        .select({ memberId: payRunLines.memberId, payDate: payRuns.payDate })
        .from(payRunLines)
        .innerJoin(payRuns, eq(payRuns.id, payRunLines.payRunId))
        .where(and(gt(payRunLines.thirteenthMonthAmount, '0'), inArray(payRuns.status, ['exported', 'paid']), eq(payRunLines.included, true)))
    )
      .filter((r) => r.payDate.startsWith(year))
      .map((r) => r.memberId),
  );

  const onboardingMembers = current.filter((m) => m.member.status === 'onboarding');
  const progress = await progressFor(
    onboardingMembers.map((m) => m.member.id),
    'onboarding',
    today,
  );

  const suggested = nextFriday(today);
  return {
    today,
    counts: {
      active: members.filter((m) => m.member.status === 'active').length,
      onboarding: members.filter((m) => m.member.status === 'onboarding').length,
      offboardedThisYear: members.filter((m) => m.member.status === 'offboarded' && (m.member.endDate ?? '').startsWith(year)).length,
    },
    upcomingLeave: upcoming.filter((r) => r.status !== 'cancelled'),
    pendingRequests: pending,
    anniversaries: current
      .filter((m) => m.nextAnniversary && m.daysToAnniversary !== null && m.daysToAnniversary <= 30 && m.member.startDate)
      .map((m) => ({
        memberId: m.member.id,
        name: name(m),
        date: m.nextAnniversary!,
        years: Number(m.nextAnniversary!.slice(0, 4)) - Number(m.member.startDate!.slice(0, 4)),
        daysAway: m.daysToAnniversary!,
      }))
      .sort((a, b) => a.daysAway - b.daysAway),
    birthdays: current
      .filter((m) => m.nextBirthday && daysBetween(today, m.nextBirthday) <= 30)
      .map((m) => ({ memberId: m.member.id, name: name(m), date: m.nextBirthday!, daysAway: daysBetween(today, m.nextBirthday!) }))
      .sort((a, b) => a.daysAway - b.daysAway),
    payRiseDue: current
      .filter((m) => m.member.status === 'active')
      .map((m) => {
        const since = m.lastPayRise?.effectiveFrom ?? m.currentPay?.effectiveFrom ?? m.member.startDate;
        return since
          ? {
              memberId: m.member.id,
              name: name(m),
              since,
              monthsSince: completedMonths(since, today),
              currentPay: m.currentPay ? `${m.currentPay.amount} ${m.currentPay.currency}/${m.currentPay.period}` : null,
              thresholdMonths: leaveSettings.payRiseDueMonths,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x && x.monthsSince >= leaveSettings.payRiseDueMonths)
      .sort((a, b) => b.monthsSince - a.monthsSince),
    thirteenthMonth: current
      .filter((m) => m.schedule?.thirteenthMonth && [month, nextMonth].includes(m.schedule.thirteenthMonthPayMonth))
      .map((m) => ({
        memberId: m.member.id,
        name: name(m),
        payMonth: m.schedule!.thirteenthMonthPayMonth,
        estimate: m.currentPay ? Math.round((annual(m.currentPay.amount, m.currentPay.period) / 12) * 100) / 100 : null,
        paidThisYear: thirteenthIds.has(m.member.id),
      })),
    onboarding: onboardingMembers.map((m) => ({
      memberId: m.member.id,
      name: name(m),
      startDate: m.member.startDate,
      jobTitle: m.member.jobTitle,
      progress: progress.get(m.member.id) ?? null,
    })),
    lowLeave: current
      .map((m) => ({ memberId: m.member.id, name: name(m), available: (balances.get(m.member.id) as LeaveBalance | undefined)?.available ?? 0 }))
      .filter((x) => x.available < 0),
    payRuns: {
      drafts: runs.filter((r) => r.run.status === 'draft'),
      last: runs.find((r) => r.run.status !== 'draft') ?? null,
      suggestedNextPayDate: suggested,
      hasRunForSuggested: runs.some((r) => r.run.payDate === suggested),
    },
  };
}

function annual(amount: number, period: string): number {
  return amount * ({ weekly: 52, fortnightly: 26, monthly: 12, annual: 1 }[period] ?? 1);
}
