import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('../../db/index.js', async () => {
  const { createTestDb } = await import('../../db/test-helpers.js');
  const t = await createTestDb();
  return { db: t.db, dbReady: async () => 'connected', closeDb: async () => t.client.close() };
});

const getUser = vi.fn();
vi.mock('../../identity/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../identity/client.js')>();
  return { ...orig, identityGetUser: (id: string) => getUser(id) };
});

let app: Express;
let auth: string;
let setMailFetchForTests: (fn: typeof fetch | null) => void;
let setBackupFetchForTests: (fn: typeof fetch | null) => void;

function jsonResponse(status: number, data: unknown): Response {
  return { status, ok: status < 400, json: async () => data, text: async () => JSON.stringify(data) } as unknown as Response;
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
  process.env.IDENTITY_API_URL = 'https://identity.test';
  process.env.IDENTITY_API_SECRET = 's';
  process.env.INTERNAL_JOB_SECRET = 'job-secret';
  process.env.APP_BASE_URL = 'https://hr.test';
  const { createApp } = await import('../../app.js');
  const { signSession } = await import('../../auth/session.js');
  ({ setMailFetchForTests } = await import('./mail.js'));
  ({ setBackupFetchForTests } = await import('../backup/service.js'));
  app = createApp();
  auth = `Bearer ${signSession({ userId: 'u1', email: 'david@xavadigital.com', name: 'David', role: 'admin' })}`;
  getUser.mockResolvedValue({ id: 'u1', email: 'david@xavadigital.com', name: 'David', disabled: false, grants: { hr: { role: 'admin', via: 'grant' } } });
  await request(app).post('/api/members').set('Authorization', auth).send({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', startDate: '2024-03-04' });
  await request(app).put('/api/settings/digest').set('Authorization', auth).send({ enabled: false, recipients: ['david@xavadigital.com'] });
});

afterAll(async () => {
  const { closeDb } = await import('../../db/index.js');
  await closeDb();
});

beforeEach(() => {
  getUser.mockResolvedValue({ id: 'u1', email: 'david@xavadigital.com', name: 'David', disabled: false, grants: { hr: { role: 'admin', via: 'grant' } } });
});

afterEach(() => {
  setMailFetchForTests(null);
  setBackupFetchForTests(null);
  delete process.env.MAILGUN_API_KEY;
  delete process.env.MAILGUN_DOMAIN;
  delete process.env.BACKUP_BUCKET;
  delete process.env.GOOGLE_ACCESS_TOKEN;
});

describe('digest', () => {
  it('previews from the dashboard with subject, text and html', async () => {
    const res = await request(app).get('/api/digest/preview?asOf=2026-09-12').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.subject).toMatch(/^\[BeastMode HR\] Week of 12 Sep/);
    expect(res.body.text).toContain('PAY RUNS');
    expect(res.body.html).toContain('https://hr.test');
    expect(res.body.recipients).toEqual(['david@xavadigital.com']);
    expect(res.body.mailConfigured).toBe(false);
  });

  it('send-now is 501 without Mailgun, and posts to Mailgun when configured', async () => {
    let res = await request(app).post('/api/digest/send').set('Authorization', auth).send({});
    expect(res.status).toBe(501);

    process.env.MAILGUN_API_KEY = 'key-x';
    process.env.MAILGUN_DOMAIN = 'mg.beastmode.co.nz';
    const calls: { url: string; init: RequestInit }[] = [];
    setMailFetchForTests(((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(jsonResponse(200, { id: '<msg@mg>', message: 'Queued' }));
    }) as unknown as typeof fetch);

    res = await request(app).post('/api/digest/send').set('Authorization', auth).send({ to: ['me@example.com'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: true, recipients: ['me@example.com'] });
    expect(calls[0]!.url).toBe('https://api.mailgun.net/v3/mg.beastmode.co.nz/messages');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('api:key-x').toString('base64')}`);
    const form = calls[0]!.init.body as FormData;
    expect(form.get('to')).toBe('me@example.com');
    expect(String(form.get('subject'))).toContain('Week of');
  });

  it('scheduler endpoint honours the enabled flag and the job secret', async () => {
    process.env.MAILGUN_API_KEY = 'key-x';
    process.env.MAILGUN_DOMAIN = 'mg.beastmode.co.nz';
    let sends = 0;
    setMailFetchForTests((() => {
      sends++;
      return Promise.resolve(jsonResponse(200, { id: 'x' }));
    }) as unknown as typeof fetch);

    let res = await request(app).post('/api/internal/digest');
    expect(res.status).toBe(401);
    res = await request(app).post('/api/internal/digest').set('X-Job-Secret', 'job-secret');
    expect(res.body).toMatchObject({ sent: false, reason: 'digest disabled in settings' });
    expect(sends).toBe(0);

    await request(app).put('/api/settings/digest').set('Authorization', auth).send({ enabled: true, recipients: ['david@xavadigital.com'] });
    res = await request(app).post('/api/internal/digest').set('X-Job-Secret', 'job-secret');
    expect(res.body.sent).toBe(true);
    expect(sends).toBe(1);
  });
});

describe('backup', () => {
  it('downloads a full JSON dump', async () => {
    const res = await request(app).get('/api/backup/download').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/bm-hr-backup-\d{4}-\d{2}-\d{2}\.json/);
    const dump = JSON.parse(res.text);
    expect(dump.service).toBe('bm-hr');
    expect(dump.counts.team_members).toBe(1);
    expect(Object.keys(dump.tables)).toContain('pay_run_lines');
  });

  it('nightly upload writes to the bucket via the GCS JSON API', async () => {
    let res = await request(app).post('/api/internal/backup').set('X-Job-Secret', 'job-secret');
    expect(res.body).toMatchObject({ uploaded: false, reason: 'BACKUP_BUCKET not set' });

    process.env.BACKUP_BUCKET = 'bm-hr-backups';
    process.env.GOOGLE_ACCESS_TOKEN = 'tok';
    const calls: { url: string; init: RequestInit }[] = [];
    setBackupFetchForTests(((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(jsonResponse(200, { name: 'ok' }));
    }) as unknown as typeof fetch);
    res = await request(app).post('/api/internal/backup').set('X-Job-Secret', 'job-secret');
    expect(res.status).toBe(200);
    expect(res.body.uploaded).toBe(true);
    expect(res.body.object).toMatch(/^bm-hr\/\d{4}-\d{2}-\d{2}\/hr-.*\.json$/);
    expect(calls[0]!.url).toMatch(/^https:\/\/storage\.googleapis\.com\/upload\/storage\/v1\/b\/bm-hr-backups\/o\?uploadType=media&name=bm-hr%2F/);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0]!.init.body as string).counts.team_members).toBe(1);

    res = await request(app).post('/api/backup/upload').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });
});
