import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
let ada: string;
let bob: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
  process.env.IDENTITY_API_URL = 'https://identity.test';
  process.env.IDENTITY_API_SECRET = 's';
  const { createApp } = await import('../../app.js');
  const { signSession } = await import('../../auth/session.js');
  app = createApp();
  auth = `Bearer ${signSession({ userId: 'u1', email: 'david@xavadigital.com', name: 'David', role: 'admin' })}`;
  getUser.mockResolvedValue({ id: 'u1', email: 'david@xavadigital.com', name: 'David', disabled: false, grants: { hr: { role: 'admin', via: 'grant' } } });

  let r = await request(app).post('/api/members').set('Authorization', auth).send({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', startDate: '2024-03-04', dateOfBirth: '1990-09-20' });
  ada = r.body.member.id;
  r = await request(app).post('/api/members').set('Authorization', auth).send({ firstName: 'Bob', lastName: 'Builder', email: 'bob@example.com', startDate: '2026-09-01', status: 'onboarding' });
  bob = r.body.member.id;
  await request(app).post(`/api/members/${ada}/compensation`).set('Authorization', auth).send({ amount: 200, period: 'weekly', effectiveFrom: '2024-03-04', reason: 'initial' });
  await request(app).put(`/api/members/${ada}/pay-schedule`).set('Authorization', auth).send({ frequency: 'weekly', payoutMethod: 'wise', wiseRecipientKind: 'gcash', wiseRecipientId: 'x', wiseRecipientName: 'Ada', thirteenthMonth: true });
  const s = await request(app).put('/api/settings/leave').set('Authorization', auth).send({ annualEntitlementDays: 12, accrual: 'monthly', carryOverMaxDays: 5, payRiseDueMonths: 12 });
  expect(s.status).toBe(200);
});

afterAll(async () => {
  const { closeDb } = await import('../../db/index.js');
  await closeDb();
});

beforeEach(() => {
  getUser.mockResolvedValue({ id: 'u1', email: 'david@xavadigital.com', name: 'David', disabled: false, grants: { hr: { role: 'admin', via: 'grant' } } });
});

describe('leave', () => {
  it('uses settings defaults until a policy is set', async () => {
    const res = await request(app).get(`/api/members/${ada}/leave?asOf=2026-09-12`).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.policy).toMatchObject({ isDefault: true, annualEntitlementDays: 12, accrual: 'monthly', carryOverMaxDays: 5 });
    // 2024: 12 * (303/366) = 9.93 → capped 5; 2025: 5 + 12 = 17 → capped 5; 2026: accrued 8
    expect(res.body.balance).toMatchObject({ carryIn: 5, accruedToDate: 8, available: 13 });
  });

  it('records leave with working days by default and updates the balance', async () => {
    let res = await request(app).post('/api/leave/requests').set('Authorization', auth).send({ memberId: ada, startDate: '2026-08-03', endDate: '2026-08-07', notes: 'beach' });
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({ days: 5, status: 'approved', paid: true, type: 'annual', memberName: 'Ada Lovelace' });
    res = await request(app).post('/api/leave/requests').set('Authorization', auth).send({ memberId: ada, startDate: '2026-10-05', endDate: '2026-10-06', days: 1.5 });
    expect(res.body.request.days).toBe(1.5);
    res = await request(app).post('/api/leave/requests').set('Authorization', auth).send({ memberId: ada, startDate: '2026-11-02', endDate: '2026-11-02', status: 'requested' });
    res = await request(app).post('/api/leave/requests').set('Authorization', auth).send({ memberId: ada, type: 'sick', startDate: '2026-02-10', endDate: '2026-02-10' });
    res = await request(app).post('/api/leave/requests').set('Authorization', auth).send({ memberId: ada, type: 'unpaid', startDate: '2026-05-11', endDate: '2026-05-11' });
    expect(res.body.request.paid).toBe(false);

    res = await request(app).get(`/api/members/${ada}/leave?asOf=2026-09-12`).set('Authorization', auth);
    expect(res.body.balance).toMatchObject({ taken: 5, booked: 1.5, pending: 1, available: 6.5, sickTaken: 1, unpaidTaken: 1 });
    expect(res.body.requests).toHaveLength(5);
  });

  it('rejects an end before start and unknown members', async () => {
    let res = await request(app).post('/api/leave/requests').set('Authorization', auth).send({ memberId: ada, startDate: '2026-10-05', endDate: '2026-10-01' });
    expect(res.status).toBe(400);
    res = await request(app).post('/api/leave/requests').set('Authorization', auth).send({ memberId: '00000000-0000-0000-0000-000000000000', startDate: '2026-10-05', endDate: '2026-10-05' });
    expect(res.status).toBe(404);
  });

  it('approves a pending request, cancels one, and recomputes days when dates change', async () => {
    const all = await request(app).get(`/api/leave/requests?memberId=${ada}`).set('Authorization', auth);
    const pending = all.body.requests.find((r: { status: string }) => r.status === 'requested');
    let res = await request(app).patch(`/api/leave/requests/${pending.id}`).set('Authorization', auth).send({ status: 'approved' });
    expect(res.body.request.status).toBe('approved');
    const beach = all.body.requests.find((r: { notes: string }) => r.notes === 'beach');
    res = await request(app).patch(`/api/leave/requests/${beach.id}`).set('Authorization', auth).send({ endDate: '2026-08-05' });
    expect(res.body.request.days).toBe(3);
    res = await request(app).patch(`/api/leave/requests/${beach.id}`).set('Authorization', auth).send({ status: 'cancelled' });
    res = await request(app).get(`/api/members/${ada}/leave?asOf=2026-09-12`).set('Authorization', auth);
    expect(res.body.balance).toMatchObject({ taken: 0, booked: 2.5, pending: 0, available: 10.5 });
  });

  it('policy override and adjustments', async () => {
    let res = await request(app).put(`/api/members/${ada}/leave-policy`).set('Authorization', auth).send({ annualEntitlementDays: 15, accrual: 'front_loaded', carryOverMaxDays: 0, leaveYearStart: '01-01' });
    expect(res.status).toBe(200);
    expect(res.body.policy.isDefault).toBe(false);
    res = await request(app).post(`/api/members/${ada}/leave-adjustments`).set('Authorization', auth).send({ date: '2026-01-15', days: 2, reason: 'opening balance from spreadsheet' });
    expect(res.status).toBe(201);
    res = await request(app).get(`/api/members/${ada}/leave?asOf=2026-09-12`).set('Authorization', auth);
    // carry 0 (cap 0) + 15 front-loaded + 2 − 2.5 booked
    expect(res.body.balance).toMatchObject({ carryIn: 0, accruedToDate: 15, adjustments: 2, available: 14.5 });
    res = await request(app).delete(`/api/members/${ada}/leave-adjustments/${res.body.adjustments[0].id}`).set('Authorization', auth);
    expect(res.status).toBe(204);
  });

  it('lists requests by date window with names, and the team list carries balances', async () => {
    let res = await request(app).get('/api/leave/requests?from=2026-10-01&to=2026-10-31').set('Authorization', auth);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0].memberName).toBe('Ada Lovelace');
    res = await request(app).get('/api/members').set('Authorization', auth);
    const a = res.body.members.find((m: { member: { id: string } }) => m.member.id === ada);
    expect(a.leave).toMatchObject({ booked: 2.5, pending: 0 });
    res = await request(app).get('/api/leave/working-days?start=2026-09-07&end=2026-09-18').set('Authorization', auth);
    expect(res.body.days).toBe(10);
  });

  it('dashboard aggregates upcoming leave, dates, pay rises, 13th month, onboarding, pay runs', async () => {
    const res = await request(app).get('/api/dashboard?asOf=2026-09-12').set('Authorization', auth);
    expect(res.status).toBe(200);
    const d = res.body;
    expect(d.counts).toMatchObject({ active: 1, onboarding: 1 });
    expect(d.upcomingLeave.map((r: { startDate: string }) => r.startDate)).toEqual(['2026-10-05']);
    expect(d.birthdays[0]).toMatchObject({ name: 'Ada Lovelace', date: '2026-09-20', daysAway: 8 });
    expect(d.anniversaries).toHaveLength(0); // Ada's is in March
    expect(d.payRiseDue[0]).toMatchObject({ name: 'Ada Lovelace', since: '2024-03-04', thresholdMonths: 12 });
    expect(d.onboarding[0]).toMatchObject({ name: 'Bob Builder', startDate: '2026-09-01' });
    expect(d.thirteenthMonth).toHaveLength(0); // September: December is not this or next month
    expect(d.payRuns).toMatchObject({ drafts: [], last: null, suggestedNextPayDate: '2026-09-18', hasRunForSuggested: false });

    const nov = await request(app).get('/api/dashboard?asOf=2026-11-15').set('Authorization', auth);
    expect(nov.body.thirteenthMonth[0]).toMatchObject({ name: 'Ada Lovelace', payMonth: 12, estimate: 866.67, paidThisYear: false });
  });
});
