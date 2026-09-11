import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireAuth, requireRole } from './middleware.js';
import { signSession } from './session.js';

const getUser = vi.fn();
vi.mock('../identity/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../identity/client.js')>();
  return { ...orig, identityGetUser: (id: string) => getUser(id) };
});

function app() {
  const a = express();
  a.get('/me', requireAuth, (req, res) => res.json(req.user));
  a.get('/admin', requireAuth, requireRole('admin'), (_req, res) => res.json({ ok: true }));
  return a;
}

const rec = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'david@xavadigital.com',
  name: 'David',
  disabled: false,
  avatarUrl: null,
  googleLinked: true,
  grants: { hr: { role: 'admin', via: 'grant' } },
  ...over,
});

describe('requireAuth', () => {
  let token: string;
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
    process.env.IDENTITY_API_URL = 'https://identity.test';
    process.env.IDENTITY_API_SECRET = 's';
    token = signSession({ userId: 'u1', email: 'david@xavadigital.com', name: 'David', role: 'admin' });
    getUser.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('401 without a session', async () => {
    const res = await request(app()).get('/me');
    expect(res.status).toBe(401);
  });

  it('accepts the cookie and uses identity role', async () => {
    getUser.mockResolvedValue(rec());
    const res = await request(app()).get('/me').set('Cookie', `hr_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'u1', role: 'admin' });
  });

  it('403 NO_APP_ACCESS when the hr grant is gone, and clears the cookie', async () => {
    getUser.mockResolvedValue(rec({ grants: {} }));
    const res = await request(app()).get('/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NO_APP_ACCESS');
    expect(res.headers['set-cookie']?.[0]).toContain('hr_session=;');
  });

  it('403 ACCOUNT_DISABLED', async () => {
    getUser.mockResolvedValue(rec({ disabled: true }));
    const res = await request(app()).get('/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_DISABLED');
  });

  it('fails closed on an unknown role', async () => {
    getUser.mockResolvedValue(rec({ grants: { hr: { role: 'wizard', via: 'grant' } } }));
    const res = await request(app()).get('/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('serves the login-time role when identity is unreachable', async () => {
    getUser.mockResolvedValue('unavailable');
    const res = await request(app()).get('/admin').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('503 when identity is unreachable and the token carries no usable role', async () => {
    getUser.mockResolvedValue('unavailable');
    const bad = signSession({ userId: 'u1', email: 'x', name: 'x', role: '' });
    const res = await request(app()).get('/me').set('Authorization', `Bearer ${bad}`);
    expect(res.status).toBe(503);
  });

  it('503 when identity is not configured at all', async () => {
    delete process.env.IDENTITY_API_SECRET;
    const res = await request(app()).get('/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(503);
  });
});
