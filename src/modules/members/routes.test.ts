import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('../../db/index.js', async () => {
  const { createTestDb } = await import('../../db/test-helpers.js');
  const t = await createTestDb();
  return {
    db: t.db,
    dbReady: async () => 'connected',
    closeDb: async () => t.client.close(),
  };
});

const getUser = vi.fn();
vi.mock('../../identity/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../identity/client.js')>();
  return { ...orig, identityGetUser: (id: string) => getUser(id) };
});

let app: Express;
let auth: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
  process.env.IDENTITY_API_URL = 'https://identity.test';
  process.env.IDENTITY_API_SECRET = 's';
  const { createApp } = await import('../../app.js');
  const { signSession } = await import('../../auth/session.js');
  app = createApp();
  auth = `Bearer ${signSession({ userId: 'u1', email: 'david@xavadigital.com', name: 'David', role: 'admin' })}`;
});

afterAll(async () => {
  const { closeDb } = await import('../../db/index.js');
  await closeDb();
});

beforeEach(() => {
  getUser.mockResolvedValue({
    id: 'u1',
    email: 'david@xavadigital.com',
    name: 'David',
    disabled: false,
    grants: { hr: { role: 'admin', via: 'grant' } },
  });
});

describe('members API', () => {
  let id: string;

  it('rejects unauthenticated calls', async () => {
    expect((await request(app).get('/api/members')).status).toBe(401);
  });

  it('creates a member', async () => {
    const res = await request(app)
      .post('/api/members')
      .set('Authorization', auth)
      .send({ firstName: 'Jay-ar', lastName: 'Gargaran', email: 'jayar@example.com', country: 'PH', startDate: '2023-05-01' });
    expect(res.status).toBe(201);
    id = res.body.member.id;
    expect(res.body.member.status).toBe('active');
  });

  it('refuses a duplicate email (case-insensitive)', async () => {
    const res = await request(app)
      .post('/api/members')
      .set('Authorization', auth)
      .send({ firstName: 'Dup', lastName: 'Licate', email: 'JAYAR@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_EMAIL');
  });

  it('validates input', async () => {
    const res = await request(app).post('/api/members').set('Authorization', auth).send({ firstName: '' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
  });

  it('adds compensation and derives current pay + last pay rise', async () => {
    let res = await request(app)
      .post(`/api/members/${id}/compensation`)
      .set('Authorization', auth)
      .send({ amount: 180, period: 'weekly', effectiveFrom: '2023-05-01', reason: 'initial' });
    expect(res.status).toBe(201);
    res = await request(app)
      .post(`/api/members/${id}/compensation`)
      .set('Authorization', auth)
      .send({ amount: 208.8, period: 'weekly', effectiveFrom: '2025-01-01', reason: 'pay_rise' });
    expect(res.status).toBe(201);
    res = await request(app)
      .post(`/api/members/${id}/compensation`)
      .set('Authorization', auth)
      .send({ amount: 250, period: 'weekly', effectiveFrom: '2099-01-01', reason: 'pay_rise' });
    expect(res.status).toBe(201);

    res = await request(app).get(`/api/members/${id}`).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.currentPay).toMatchObject({ amount: 208.8, currency: 'USD', period: 'weekly' });
    expect(res.body.lastPayRise.effectiveFrom).toBe('2025-01-01');
    expect(res.body.upcomingPay).toHaveLength(1);
    expect(res.body.compensation).toHaveLength(3);
    expect(typeof res.body.tenureMonths).toBe('number');
    expect(res.body.nextAnniversary).toMatch(/-05-01$/);
  });

  it('upserts the pay schedule', async () => {
    let res = await request(app)
      .put(`/api/members/${id}/pay-schedule`)
      .set('Authorization', auth)
      .send({
        frequency: 'weekly',
        payDay: 5,
        payoutMethod: 'wise',
        wiseRecipientId: '1e76cf2e-b850-476a-4af9-19e3fe8fa22b',
        wiseRecipientName: 'Jay-ar Gargaran',
        wiseRecipientKind: 'gcash',
        wiseRecipientDetail: 'GCash · 639173980560',
        targetCurrency: 'php',
        invoicePrefix: 'INV-',
        nextInvoiceNumber: 177,
        thirteenthMonth: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.schedule.targetCurrency).toBe('PHP');
    res = await request(app).put(`/api/members/${id}/pay-schedule`).set('Authorization', auth).send({
      frequency: 'weekly',
      payoutMethod: 'wise',
      nextInvoiceNumber: 178,
    });
    expect(res.status).toBe(200);
    expect(res.body.schedule.nextInvoiceNumber).toBe(178);
  });

  it('lists with derived fields and filters by status', async () => {
    let res = await request(app).get('/api/members').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].schedule.wiseRecipientKind).toBe('gcash');
    res = await request(app).get('/api/members?status=offboarded').set('Authorization', auth);
    expect(res.body.members).toHaveLength(0);
  });

  it('patches and soft-deletes', async () => {
    let res = await request(app).patch(`/api/members/${id}`).set('Authorization', auth).send({ jobTitle: 'Designer', endDate: '' });
    expect(res.status).toBe(200);
    expect(res.body.member.jobTitle).toBe('Designer');
    res = await request(app).delete(`/api/members/${id}`).set('Authorization', auth);
    expect(res.status).toBe(204);
    res = await request(app).get(`/api/members/${id}`).set('Authorization', auth);
    expect(res.status).toBe(404);
  });

  it('serves the import template', async () => {
    const res = await request(app).get('/api/members/import/template').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.text.split('\r\n')[0]).toMatch(/^first_name,last_name,/);
  });

  it('imports via dry run then apply, and is idempotent', async () => {
    const csv = [
      'first_name,last_name,email,country,start_date,pay_amount,pay_period,frequency,pay_day,wise_recipient_id,wise_recipient_kind,thirteenth_month',
      'Edgardine,Lobigas,edgardine@example.com,PH,2024-01-08,200,weekly,weekly,5,48c85533-4130-476e-519d-29cce4560097,gcash,yes',
      'Nikko,Saldivar,nikko@example.com,PH,2024-02-05,165.57,weekly,weekly,5,742d557e-5d5b-4322-5068-6123549e9a0a,wise_account,',
      'Broken,,broken@example.com,PH,,abc,weekly,,,,,',
    ].join('\n');
    let res = await request(app).post('/api/members/import').set('Authorization', auth).send({ csv, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ create: 2, update: 0, skip: 0, error: 1 });
    let list = await request(app).get('/api/members').set('Authorization', auth);
    expect(list.body.members).toHaveLength(0);

    res = await request(app).post('/api/members/import').set('Authorization', auth).send({ csv, dryRun: false });
    expect(res.body.counts.create).toBe(2);
    list = await request(app).get('/api/members').set('Authorization', auth);
    expect(list.body.members).toHaveLength(2);
    const nikko = list.body.members.find((m: { member: { firstName: string } }) => m.member.firstName === 'Nikko');
    expect(nikko.currentPay.amount).toBe(165.57);
    expect(nikko.schedule.wiseRecipientKind).toBe('wise_account');

    res = await request(app).post('/api/members/import').set('Authorization', auth).send({ csv, dryRun: true });
    expect(res.body.counts).toEqual({ create: 0, update: 0, skip: 2, error: 1 });

    const csv2 = 'first_name,last_name,email,job_title\nNikko,Saldivar,NIKKO@example.com,Developer\n';
    res = await request(app).post('/api/members/import').set('Authorization', auth).send({ csv: csv2, dryRun: false });
    expect(res.body.counts.update).toBe(1);
    expect(res.body.rows[0].changes).toEqual(['member.jobTitle']);
  });
});
