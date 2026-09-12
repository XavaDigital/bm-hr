/**
 * Weekly digest: the dashboard, as an email. Rendered from the same
 * aggregation the home page uses, so the two never disagree.
 */
import { recordAudit } from '../../audit.js';
import { dashboard, type Dashboard } from '../dashboard/service.js';
import { getDigestSettings } from '../settings/service.js';
import { sendMail } from './mail.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function money(n: number, cur = 'USD'): string {
  return `${cur} ${n.toFixed(2)}`;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

interface Section {
  title: string;
  lines: string[];
  emptyText: string;
}

export function digestSections(d: Dashboard, appUrl: string): Section[] {
  const pr = d.payRuns;
  const payLines: string[] = [`Next pay date ${fmtDate(pr.suggestedNextPayDate)}: ${pr.hasRunForSuggested ? 'run exists' : 'NO RUN YET'}`];
  for (const r of pr.drafts) payLines.push(`Draft for ${fmtDate(r.run.payDate)}: ${r.totals.included} people, ${money(r.totals.exportAmount, r.run.sourceCurrency)} (${appUrl}/pay-runs/${r.run.id})`);
  if (pr.last) payLines.push(`Last run ${fmtDate(pr.last.run.payDate)}: ${pr.last.run.status}, ${money(pr.last.totals.exportAmount, pr.last.run.sourceCurrency)}`);

  return [
    { title: 'Pay runs', lines: payLines, emptyText: '' },
    {
      title: 'Leave in the next 30 days',
      lines: d.upcomingLeave.map((r) => `${r.memberName}: ${r.type} ${fmtDate(r.startDate)}${r.endDate !== r.startDate ? ` – ${fmtDate(r.endDate)}` : ''} (${r.days}d)${r.status === 'requested' ? ' — REQUESTED' : ''}`),
      emptyText: 'Nobody off.',
    },
    {
      title: 'Leave requests waiting for approval',
      lines: d.pendingRequests.map((r) => `${r.memberName}: ${fmtDate(r.startDate)}${r.endDate !== r.startDate ? ` – ${fmtDate(r.endDate)}` : ''} (${r.days}d) — ${appUrl}/leave`),
      emptyText: 'None.',
    },
    {
      title: 'Anniversaries and birthdays (30 days)',
      lines: [
        ...d.anniversaries.map((a) => ({ t: `${a.name}: ${a.years} year${a.years === 1 ? '' : 's'} on ${fmtDate(a.date)}`, d: a.daysAway })),
        ...d.birthdays.map((b) => ({ t: `${b.name}: birthday ${fmtDate(b.date)}`, d: b.daysAway })),
      ]
        .sort((x, y) => x.d - y.d)
        .map((x) => `${x.t} (${x.d === 0 ? 'today' : `in ${x.d}d`})`),
      emptyText: 'None coming up.',
    },
    {
      title: 'Pay rise review due',
      lines: d.payRiseDue.map((p) => `${p.name}: last change ${fmtDate(p.since)}, ${p.monthsSince} months ago${p.currentPay ? ` (${p.currentPay})` : ''}`),
      emptyText: 'Everyone reviewed within the threshold.',
    },
    {
      title: '13th month pay',
      lines: d.thirteenthMonth.map((t) => `${t.name}: ${MONTHS[t.payMonth - 1]}${t.estimate !== null ? `, about ${money(t.estimate)}` : ''} — ${t.paidThisYear ? 'already in a run' : 'not yet in a run'}`),
      emptyText: 'Not due this month or next.',
    },
    {
      title: 'Onboarding',
      lines: d.onboarding.map((o) => `${o.name}${o.jobTitle ? ` (${o.jobTitle})` : ''}${o.startDate ? `, starts ${fmtDate(o.startDate)}` : ''}${o.progress ? ` — ${o.progress.done}/${o.progress.total} tasks done${o.progress.overdue ? `, ${o.progress.overdue} overdue` : ''}` : ''}`),
      emptyText: 'Nobody onboarding.',
    },
    {
      title: 'Negative leave balances',
      lines: d.lowLeave.map((l) => `${l.name}: ${l.available} days`),
      emptyText: 'None.',
    },
  ];
}

export function renderDigest(d: Dashboard, subjectPrefix: string, appUrl: string): { subject: string; text: string; html: string } {
  const sections = digestSections(d, appUrl);
  const subject = `${subjectPrefix} Week of ${fmtDate(d.today)}: ${d.pendingRequests.length} pending leave, ${d.payRiseDue.length} pay rises due, ${d.upcomingLeave.length} away soon`.trim();

  const text = [
    `BeastMode HR digest for ${fmtDate(d.today)}`,
    `${d.counts.active} active, ${d.counts.onboarding} onboarding. ${appUrl}`,
    '',
    ...sections.flatMap((s) => [s.title.toUpperCase(), ...(s.lines.length ? s.lines.map((l) => `- ${l}`) : [s.emptyText]), '']),
  ].join('\n');

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#222;max-width:640px;margin:0 auto;padding:16px">
<h2 style="margin:0 0 4px">BeastMode HR — ${esc(fmtDate(d.today))}</h2>
<p style="margin:0 0 16px;color:#666">${d.counts.active} active, ${d.counts.onboarding} onboarding · <a href="${esc(appUrl)}">Open HR</a></p>
${sections
  .map(
    (s) => `<h3 style="margin:16px 0 6px;font-size:15px;border-bottom:1px solid #eee;padding-bottom:4px">${esc(s.title)}</h3>
${s.lines.length ? `<ul style="margin:0;padding-left:18px">${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : `<p style="margin:0;color:#888">${esc(s.emptyText)}</p>`}`,
  )
  .join('\n')}
<p style="margin-top:24px;color:#999;font-size:12px">Sent by bm-hr. Change recipients or turn this off in Settings.</p>
</body></html>`;
  return { subject, text, html };
}

export function appUrl(): string {
  return (process.env.APP_BASE_URL ?? '').replace(/\/$/, '') || 'https://hr.beastmode.co.nz';
}

export async function previewDigest(asOf?: string): Promise<{ subject: string; text: string; html: string; recipients: string[]; enabled: boolean }> {
  const [d, s] = await Promise.all([dashboard(asOf), getDigestSettings()]);
  return { ...renderDigest(d, s.subjectPrefix, appUrl()), recipients: s.recipients, enabled: s.enabled };
}

export interface DigestRunResult {
  sent: boolean;
  reason?: string;
  recipients: string[];
  subject?: string;
}

/** Send the digest to the configured recipients. `force` ignores the enabled flag (the Send-now button). */
export async function runDigest(opts: { force?: boolean; to?: string[]; actorEmail?: string } = {}): Promise<DigestRunResult> {
  const s = await getDigestSettings();
  const recipients = opts.to ?? s.recipients;
  if (!opts.force && !s.enabled) return { sent: false, reason: 'digest disabled in settings', recipients };
  if (recipients.length === 0) return { sent: false, reason: 'no recipients configured', recipients };
  const d = await dashboard();
  const msg = renderDigest(d, s.subjectPrefix, appUrl());
  const r = await sendMail({ to: recipients, ...msg });
  await recordAudit(opts.actorEmail ? { id: 'digest', email: opts.actorEmail } : undefined, 'digest', d.today, 'create', {
    sent: r.ok,
    ...(r.ok ? { id: r.id } : { reason: r.reason }),
    recipients,
  });
  return r.ok ? { sent: true, recipients, subject: msg.subject } : { sent: false, reason: r.reason, recipients, subject: msg.subject };
}
