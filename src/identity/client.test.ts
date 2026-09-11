import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearIdentityCache,
  identityGetUser,
  identityGoogleLogin,
  resolveSessionGrant,
  setIdentityFetchForTests,
  type IdentityRecord,
} from './client.js';

function jsonResponse(status: number, data: unknown): Response {
  return { status, ok: status < 400, json: async () => data } as unknown as Response;
}

const record = (over: Partial<IdentityRecord> = {}): IdentityRecord => ({
  id: 'u1',
  email: 'david@xavadigital.com',
  name: 'David',
  disabled: false,
  avatarUrl: null,
  googleLinked: true,
  grants: { hr: { role: 'admin', via: 'grant' } },
  ...over,
});

describe('resolveSessionGrant', () => {
  it('grants a recognised hr role', () => {
    expect(resolveSessionGrant(record())).toEqual({ ok: true, role: 'admin' });
  });
  it('fails closed when the hr key is absent', () => {
    expect(resolveSessionGrant(record({ grants: { salesflow: { role: 'admin', via: 'grant' } } }))).toEqual({
      ok: false,
      reason: 'no_access',
    });
  });
  it('fails closed on an unknown role (registry drift)', () => {
    expect(resolveSessionGrant(record({ grants: { hr: { role: 'superuser', via: 'grant' } } }))).toEqual({
      ok: false,
      reason: 'unknown_role',
      role: 'superuser',
    });
  });
  it('disabled trumps grants', () => {
    expect(resolveSessionGrant(record({ disabled: true }))).toEqual({ ok: false, reason: 'disabled' });
  });
  it('404 is no_access; unreachable is unavailable', () => {
    expect(resolveSessionGrant(null)).toEqual({ ok: false, reason: 'no_access' });
    expect(resolveSessionGrant('unavailable')).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('identity transport', () => {
  beforeEach(() => {
    process.env.IDENTITY_API_URL = 'https://identity.test/';
    process.env.IDENTITY_API_SECRET = 'hr-secret';
    clearIdentityCache();
  });
  afterEach(() => {
    setIdentityFetchForTests(null);
    delete process.env.IDENTITY_API_URL;
    delete process.env.IDENTITY_API_SECRET;
  });

  it('posts the credential with the per-app bearer', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    setIdentityFetchForTests(((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(jsonResponse(200, { user: { id: 'u1' } }));
    }) as unknown as typeof fetch);
    const r = await identityGoogleLogin('cred');
    expect(r.status).toBe(200);
    expect(calls[0]!.url).toBe('https://identity.test/v1/google-login');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer hr-secret');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ credential: 'cred' });
  });

  it('caches lookups for 60s and serves stale on error', async () => {
    let n = 0;
    setIdentityFetchForTests((() => {
      n++;
      if (n === 1) return Promise.resolve(jsonResponse(200, record()));
      return Promise.reject(new Error('ECONNREFUSED'));
    }) as unknown as typeof fetch);
    expect(await identityGetUser('u1')).toMatchObject({ id: 'u1' });
    expect(await identityGetUser('u1')).toMatchObject({ id: 'u1' });
    expect(n).toBe(1);
    clearIdentityCache();
    expect(await identityGetUser('u1')).toBe('unavailable');
  });

  it('treats 404 as definitive and 5xx as unavailable', async () => {
    setIdentityFetchForTests((() => Promise.resolve(jsonResponse(404, {}))) as unknown as typeof fetch);
    expect(await identityGetUser('gone')).toBeNull();
    setIdentityFetchForTests((() => Promise.resolve(jsonResponse(502, {}))) as unknown as typeof fetch);
    expect(await identityGetUser('other')).toBe('unavailable');
  });
});
