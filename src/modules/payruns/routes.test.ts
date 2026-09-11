import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { parseCsv } from '../members/csv.js';

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
const ids: Record<string, string> = {};

async function seedMember(
  key: string,
  member: Record<string, unknown>,
  pay: { amount: number; period: string; effectiveFrom: string } | null,
  schedule: Record<string, unknown> | null,
) {
  const r = await request(app).post('/api/members').set('Authorization', auth).send(member);
  expect(r.status).toBe(201);
  ids[key] = r.body.member.id;
  if (pay) expect((await request(app).post(`/api/members/${ids[key]}/compensation`).set('Authorization', auth).send({ ...pay, reason: 'initial' })).status).toBe(201);
  if (schedule) expect((await request(app).put(`/api/members/${ids[key]}/pay-schedule`).set('Authorization', auth).send(schedule)).status).toBe(200);
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
  process.env.IDENTITY_API_URL = 'https://identity.test';
  process.env.IDENTITY_API_SECRET = 's';
  const { createApp } = await import('../../app.js');
  const { signSession } = await import('../../auth/session.js');
  app = createApp();
  auth = `Bearer ${signSession({ userId: 'u1', email: 'david@xavadigital.com', name: 'David', role: 'admin' })}`;
  getUser.mockResolvedValue({ id: 'u1', email: 'david@xavadigital.com', name: 'David', disabled: false, grants: { hr: { role: 'admin', via: 'grant' } } });

  await seedMember(
    'edg',
    { firstName: 'Edgardine', lastName: 'Lobigas', email: 'edg@example.com', country: 'PH', startDate: '2024-01-08' },
    { amount: 200, period: 'weekly', effectiveFrom: '2024-01-08' },
    {
      frequency: 'weekly',
      payDay: 5,
      payoutMethod: 'wise',
      wiseRecipientId: '48c85533-4130-476e-519d-29cce4560097',
      wiseRecipientName: 'Edgardine Angeli B. Lobigas',
      wiseRecipientEmail: 'edg@example.com',
      wiseRecipientKind: 'gcash',
      wiseRecipientDetail: 'GCash · 639279560278',
      targetCurrency: 'PHP',
      invoicePrefix: 'INV ',
      nextInvoiceNumber: 104,
      invoicePad: 0,
      thirteenthMonth: true,
    },
  );
  await seedMember(
    'ferd',
    { firstName: 'Ferdinand', lastName: 'Bangalisan', email: 'ferd@example.com', country: 'PH', startDate: '2023-06-01' },
    { amount: 1100.67, period: 'monthly', effectiveFrom: '2023-06-01' }, // 254.00/week
    {
      frequency: 'weekly',
      payoutMethod: 'wise',
      wiseRecipientId: '765bd141-d138-40f9-2f38-54ffe8d8b1e1',
      wiseRecipientName: 'Ferdinand Allen Bangalisan',
      wiseRecipientKind: 'wise_account',
      wiseRecipientDetail: 'Wise account',
      targetCurrency: 'USD',
      invoicePrefix: 'INV',
      nextInvoiceNumber: 22,
      invoicePad: 3,
      thirteenthMonth: false,
    },
  );
  // Paid through Xero: never in a Wise run.
  await seedMember('nz', { firstName: 'Kiwi', lastName: 'Person', email: 'kiwi@example.com', country: 'NZ' }, { amount: 5000, period: 'monthly', effectiveFrom: '2024-01-01' }, {
    frequency: 'monthly',
    payoutMethod: 'xero_bank',
  });
  // Wise but not set up yet: blocks export until excluded.
  await seedMember('new', { firstName: 'New', lastName: 'Starter', email: 'new@example.com', country: 'PH', startDate: '2026-09-01' }, { amount: 180, period: 'weekly', effectiveFrom: '2026-09-01' }, {
    frequency: 'weekly',
    payoutMethod: 'wise',
    wiseRecipientKind: 'gcash',
  });
  // Starts after the pay date: not eligible yet.
  await seedMember('future', { firstName: 'Future', lastName: 'Hire', email: 'future@example.com', startDate: '2026-10-01' }, { amount: 180, period: 'weekly', effectiveFrom: '2026-10-01' }, {
    frequency: 'weekly',
    payoutMethod: 'wise',
    wiseRecipientKind: 'gcash',
    wiseRecipientId: 'x',
    wiseRecipientName: 'Future Hire',
  });

  const s = await request(app)
    .put('/api/settings/wise')
    .set('Authorization', auth)
    .send({ sourceCurrency: 'USD', kinds: { gcash: { amountMode: 'source', feeFixed: 1.2, feePct: 0.0065 }, wise_account: { amountMode: 'target', feeFixed: 0, feePct: 0 } } });
  expect(s.status).toBe(200);
  expect(s.body.wise.headers[0]).toBe('recipientId');
});

afterAll(async () => {
  const { closeDb } = await import('../../db/index.js');
  await closeDb();
});

beforeEach(() => {
  getUser.mockResolvedValue({ id: 'u1', email: 'david@xavadigital.com', name: 'David', disabled: false, grants: { hr: { role: 'admin', via: 'grant' } } });
});

describe('pay runs', () => {
  let runId: string;
  const line = (body: { lines: { memberId: string }[] }, key: string) => body.lines.find((l) => l.memberId === ids[key]) as Record<string, unknown> & { id: string };

  it('creates a weekly draft pre-filled from eligible members', async () => {
    const res = await request(app).post('/api/pay-runs').set('Authorization', auth).send({ payDate: '2026-09-11', frequency: 'weekly' });
    expect(res.status).toBe(201);
    runId = res.body.run.id;
    expect(res.body.run).toMatchObject({ status: 'draft', periodStart: '2026-09-05', periodEnd: '2026-09-11', sourceCurrency: 'USD' });
    expect(res.body.lines.map((l: { memberName: string }) => l.memberName).sort()).toEqual(['Edgardine Lobigas', 'Ferdinand Bangalisan', 'New Starter']);

    const edg = line(res.body, 'edg');
    expect(edg).toMatchObject({ baseAmount: 200, netAmount: 200, amountMode: 'source', exportAmount: 202.52, grossUpAmount: 2.52, exportCurrency: 'USD', paymentReference: 'INV 104', thirteenthMonthAmount: 0 });
    const ferd = line(res.body, 'ferd');
    expect(ferd).toMatchObject({ baseAmount: 254, amountMode: 'target', exportAmount: 254, exportCurrency: 'USD', paymentReference: 'INV022' });
    expect(res.body.totals).toMatchObject({ lines: 3, included: 3 });
    expect(res.body.issues.some((i: { level: string; memberName: string }) => i.level === 'error' && i.memberName === 'New Starter')).toBe(true);
  });

  it('adjusts a line and recomputes net + gross-up', async () => {
    const view = await request(app).get(`/api/pay-runs/${runId}`).set('Authorization', auth);
    const edg = line(view.body, 'edg');
    const res = await request(app)
      .patch(`/api/pay-runs/${runId}/lines/${edg.id}`)
      .set('Authorization', auth)
      .send({ adjustmentsAmount: -40, adjustmentsNote: '1 day unpaid leave' });
    expect(res.status).toBe(200);
    expect(line(res.body, 'edg')).toMatchObject({ netAmount: 160, exportAmount: 162.26, grossUpAmount: 2.26 });
  });

  it('blocks export while an included line has errors, then exports once excluded', async () => {
    let res = await request(app).post(`/api/pay-runs/${runId}/export`).set('Authorization', auth);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RUN_INVALID');
    expect(res.body.details[0].memberName).toBe('New Starter');

    const view = await request(app).get(`/api/pay-runs/${runId}`).set('Authorization', auth);
    res = await request(app).patch(`/api/pay-runs/${runId}/lines/${line(view.body, 'new').id}`).set('Authorization', auth).send({ included: false });
    expect(res.status).toBe(200);

    res = await request(app).post(`/api/pay-runs/${runId}/export`).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.run.status).toBe('exported');
    expect(res.body.totals).toMatchObject({ included: 2, netAmount: 414, exportAmount: 416.26 });

    // invoice sequence advanced
    const m = await request(app).get(`/api/members/${ids['edg']}`).set('Authorization', auth);
    expect(m.body.schedule.nextInvoiceNumber).toBe(105);
  });

  it('produces the Wise CSV in the template column order', async () => {
    const res = await request(app).get(`/api/pay-runs/${runId}/csv`).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('wise-batch-2026-09-11.csv');
    const rows = parseCsv(res.text);
    expect(rows[0]).toEqual(['recipientId', 'name', 'recipientEmail', 'recipientDetail', 'sourceCurrency', 'targetCurrency', 'amountCurrency', 'amount', 'paymentReference', 'referenceNumber', 'receiverType']);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(['48c85533-4130-476e-519d-29cce4560097', 'Edgardine Angeli B. Lobigas', 'edg@example.com', 'GCash · 639279560278', 'USD', 'PHP', 'source', '162.26', 'INV 104', '', 'PERSON']);
    expect(rows[2]).toEqual(['765bd141-d138-40f9-2f38-54ffe8d8b1e1', 'Ferdinand Allen Bangalisan', '', 'Wise account', 'USD', 'USD', 'target', '254.00', 'INV022', '', 'PERSON']);
  });

  it('refuses edits once exported, allows reopen, then mark paid', async () => {
    const view = await request(app).get(`/api/pay-runs/${runId}`).set('Authorization', auth);
    let res = await request(app).patch(`/api/pay-runs/${runId}/lines/${line(view.body, 'edg').id}`).set('Authorization', auth).send({ adjustmentsAmount: 0 });
    expect(res.status).toBe(409);
    res = await request(app).delete(`/api/pay-runs/${runId}`).set('Authorization', auth);
    expect(res.status).toBe(409);

    res = await request(app).post(`/api/pay-runs/${runId}/reopen`).set('Authorization', auth);
    expect(res.body.run.status).toBe('draft');
    res = await request(app).post(`/api/pay-runs/${runId}/export`).set('Authorization', auth);
    expect(res.body.run.status).toBe('exported');
    // references were already assigned; re-export must not burn another number
    expect(line(res.body, 'edg').paymentReference).toBe('INV 104');
    const m = await request(app).get(`/api/members/${ids['edg']}`).set('Authorization', auth);
    expect(m.body.schedule.nextInvoiceNumber).toBe(105);

    res = await request(app).post(`/api/pay-runs/${runId}/mark-paid`).set('Authorization', auth);
    expect(res.body.run.status).toBe('paid');
    expect(res.body.run.paidAt).toBeTruthy();
  });

  it('shows pay history per member', async () => {
    const res = await request(app).get(`/api/members/${ids['edg']}/pay-history`).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0]).toMatchObject({ payDate: '2026-09-11', status: 'paid', netAmount: 160, exportAmount: 162.26, adjustmentsNote: '1 day unpaid leave' });
    const none = await request(app).get(`/api/members/${ids['new']}/pay-history`).set('Authorization', auth);
    expect(none.body.history).toHaveLength(0);
  });

  it('adds 13th-month pay once in the configured month', async () => {
    let res = await request(app).post('/api/pay-runs').set('Authorization', auth).send({ payDate: '2026-12-04' });
    expect(res.status).toBe(201);
    const dec1 = res.body.run.id;
    expect(line(res.body, 'edg')).toMatchObject({ thirteenthMonthAmount: 866.67, netAmount: 1066.67 });
    expect(line(res.body, 'ferd').thirteenthMonthAmount).toBe(0);

    res = await request(app).post('/api/pay-runs').set('Authorization', auth).send({ payDate: '2026-12-11' });
    expect(line(res.body, 'edg').thirteenthMonthAmount).toBe(0);
    const dec2 = res.body.run.id;

    // drafts can be deleted; the list reflects it
    expect((await request(app).delete(`/api/pay-runs/${dec2}`).set('Authorization', auth)).status).toBe(204);
    const list = await request(app).get('/api/pay-runs').set('Authorization', auth);
    expect(list.body.payRuns.map((r: { run: { id: string } }) => r.run.id)).toEqual([dec1, runId]);
  });

  it('refresh re-pulls pay and adds newly eligible members', async () => {
    const list = await request(app).get('/api/pay-runs').set('Authorization', auth);
    const dec1 = list.body.payRuns[0].run.id;
    // pay rise for Ferdinand effective before the December run
    await request(app).post(`/api/members/${ids['ferd']}/compensation`).set('Authorization', auth).send({ amount: 300, period: 'weekly', effectiveFrom: '2026-11-01', reason: 'pay_rise' });
    const res = await request(app).post(`/api/pay-runs/${dec1}/refresh`).set('Authorization', auth);
    expect(res.status).toBe(200);
    // current pay is evaluated as of today (Sept 2026), so a Nov rise is still upcoming and the base stays 254
    expect(line(res.body, 'ferd').baseAmount).toBe(254);
    expect(line(res.body, 'edg').thirteenthMonthAmount).toBe(866.67);
  });

  it('accepts a manual payment reference and keeps it on export', async () => {
    const list = await request(app).get('/api/pay-runs').set('Authorization', auth);
    const dec1 = list.body.payRuns[0].run.id;
    let view = await request(app).get(`/api/pay-runs/${dec1}`).set('Authorization', auth);
    // Future Hire is eligible by date but has no current pay yet: a zero line that blocks export
    expect(view.body.issues.some((i: { memberName: string; message: string }) => i.memberName === 'Future Hire' && i.message === 'Amount is zero')).toBe(true);
    for (const key of ['new', 'future']) {
      await request(app).patch(`/api/pay-runs/${dec1}/lines/${line(view.body, key).id}`).set('Authorization', auth).send({ included: false });
    }
    const ferd = line(view.body, 'ferd');
    await request(app).patch(`/api/pay-runs/${dec1}/lines/${ferd.id}`).set('Authorization', auth).send({ paymentReference: 'BONUS-DEC' });
    view = await request(app).post(`/api/pay-runs/${dec1}/export`).set('Authorization', auth);
    expect(view.status).toBe(200);
    expect(line(view.body, 'ferd').paymentReference).toBe('BONUS-DEC');
    expect(line(view.body, 'edg').paymentReference).toBe('INV 105');
    const m = await request(app).get(`/api/members/${ids['edg']}`).set('Authorization', auth);
    expect(m.body.schedule.nextInvoiceNumber).toBe(106);
  });
});
