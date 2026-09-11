/**
 * Client for the BeastMode identity service (bm-identity). bm-hr is a tenant:
 * login delegates there with OUR per-app bearer secret, and live sessions
 * re-check `disabled` + the `hr` grant through the ≤60s cache below
 * (stale-while-error: an identity blip never logs the owner out; a revoke or
 * disable lands within about a minute).
 *
 * Ported from bm-sales src/identity/client.ts with bm-team-engage's stricter
 * transport semantics (non-2xx/404 statuses are "unavailable", not "no user").
 *
 * Unconfigured (no IDENTITY_API_URL/SECRET) = every sign-in answers 501 and
 * every authed request fails closed. There is no local login policy (fleet
 * access contract).
 */

export interface IdentityRecord {
  id: string;
  email: string;
  name: string;
  disabled: boolean;
  avatarUrl: string | null;
  googleLinked: boolean;
  grants: Record<string, { role: string; via: 'grant' | 'domain' }>;
}

/** This app's id in the identity registry — the key under `grants`. */
export const APP_ID = 'hr';

/** Role vocabulary registered for `hr`. Any other string fails closed. */
export const SESSION_ROLES = new Set(['admin']);

export function identityConfigured(): boolean {
  return !!(process.env.IDENTITY_API_URL && process.env.IDENTITY_API_SECRET);
}

// Test hook: swap the transport so tests never reach the real API.
let fetchOverride: typeof fetch | null = null;
export function setIdentityFetchForTests(fn: typeof fetch | null): void {
  fetchOverride = fn;
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const base = (process.env.IDENTITY_API_URL ?? '').replace(/\/$/, '');
  const doFetch = fetchOverride ?? fetch;
  const res = await doFetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.IDENTITY_API_SECRET}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: json };
}

/** Delegated Google login. Relays the identity service's status + body. Throws on transport failure. */
export async function identityGoogleLogin(
  credential: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return call('POST', '/v1/google-login', { credential });
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; rec: IdentityRecord | null }>();

/**
 * Identity lookup with the fleet-standard cache and semantic split: `null`
 * means DEFINITIVELY unknown (a real 404 — fail closed), 'unavailable' means
 * the service could not be reached or answered abnormally and nothing is
 * cached (caller decides; see auth/middleware.ts).
 */
export async function identityGetUser(id: string): Promise<IdentityRecord | null | 'unavailable'> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rec;
  try {
    const { status, body } = await call('GET', `/v1/users/${encodeURIComponent(id)}`);
    if (status === 200) {
      const rec = body as unknown as IdentityRecord;
      cache.set(id, { at: Date.now(), rec });
      return rec;
    }
    if (status === 404) {
      cache.set(id, { at: Date.now(), rec: null });
      return null;
    }
    throw new Error(`identity answered ${status}`);
  } catch {
    if (hit) return hit.rec; // stale-while-error
    return 'unavailable';
  }
}

export type GrantVerdict =
  | { ok: true; role: string }
  | { ok: false; reason: 'no_access' }
  | { ok: false; reason: 'unknown_role'; role: string }
  | { ok: false; reason: 'disabled' }
  | { ok: false; reason: 'unavailable' };

/** Resolve what a live session is allowed, from the identity record. */
export function resolveSessionGrant(rec: IdentityRecord | null | 'unavailable'): GrantVerdict {
  if (rec === 'unavailable') return { ok: false, reason: 'unavailable' };
  if (rec === null) return { ok: false, reason: 'no_access' };
  if (rec.disabled) return { ok: false, reason: 'disabled' };
  const grant = rec.grants?.[APP_ID];
  if (!grant) return { ok: false, reason: 'no_access' };
  if (!SESSION_ROLES.has(grant.role)) return { ok: false, reason: 'unknown_role', role: grant.role };
  return { ok: true, role: grant.role };
}

/** Test hook. */
export function clearIdentityCache(): void {
  cache.clear();
}
