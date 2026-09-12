/**
 * Outbound email via Mailgun's HTTP API (the fleet already uses Mailgun in
 * bm-email). No SDK: one multipart POST. Env-gated: MAILGUN_API_KEY +
 * MAILGUN_DOMAIN unset = sending answers 'unconfigured' and nothing leaves.
 * MAILGUN_BASE_URL defaults to the US endpoint; EU domains use
 * https://api.eu.mailgun.net.
 */

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export function mailConfigured(): boolean {
  return !!(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN);
}

let fetchOverride: typeof fetch | null = null;
export function setMailFetchForTests(fn: typeof fetch | null): void {
  fetchOverride = fn;
}

export async function sendMail(msg: MailMessage): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (!mailConfigured()) return { ok: false, reason: 'unconfigured' };
  if (msg.to.length === 0) return { ok: false, reason: 'no recipients' };
  const base = (process.env.MAILGUN_BASE_URL ?? 'https://api.mailgun.net').replace(/\/$/, '');
  const domain = process.env.MAILGUN_DOMAIN!;
  const from = process.env.DIGEST_FROM ?? `BeastMode HR <hr@${domain}>`;
  const form = new FormData();
  form.set('from', from);
  form.set('to', msg.to.join(','));
  form.set('subject', msg.subject);
  form.set('text', msg.text);
  form.set('html', msg.html);
  const doFetch = fetchOverride ?? fetch;
  try {
    const res = await doFetch(`${base}/v3/${domain}/messages`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64')}` },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (res.status >= 200 && res.status < 300) return { ok: true, id: body.id ?? '' };
    return { ok: false, reason: `mailgun ${res.status}: ${body.message ?? 'error'}` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'network error' };
  }
}
