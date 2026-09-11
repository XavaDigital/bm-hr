import dayjs from 'dayjs';
import { PERIOD_LABELS, type Compensation } from './types';

export function fullName(m: { firstName: string; lastName: string; preferredName?: string | null }): string {
  const base = `${m.firstName} ${m.lastName}`.trim();
  return m.preferredName && m.preferredName !== m.firstName ? `${base} (${m.preferredName})` : base;
}

export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
}

export function pay(c: Compensation | null): string {
  if (!c) return '—';
  return `${money(c.amount, c.currency)} / ${PERIOD_LABELS[c.period]}`;
}

export function date(d: string | null | undefined): string {
  return d ? dayjs(d).format('D MMM YYYY') : '—';
}

export function tenure(months: number | null): string {
  if (months === null) return '—';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  return m === 0 ? `${y} yr` : `${y} yr ${m} mo`;
}

export function sinceRelative(d: string | null | undefined): string {
  if (!d) return 'never';
  const months = dayjs().diff(dayjs(d), 'month');
  if (months < 1) return 'this month';
  if (months < 12) return `${months} mo ago`;
  const y = Math.floor(months / 12);
  return `${y} yr${y > 1 ? 's' : ''} ago`;
}
