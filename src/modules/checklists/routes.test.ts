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
  const r = await request(app).post('/api/members').set('Authorization', auth).send({ firstName: 'Bob', lastName: 'Builder', email: 'bob@example.com', startDate: '2026-09-01', status: 'onboarding' });
  bob = r.body.member.id;
});

afterAll(async () => {
  const { closeDb } = await import('../../db/index.js');
  await closeDb();
});

beforeEach(() => {
  getUser.mockResolvedValue({ id: 'u1', email: 'david@xavadigital.com', name: 'David', disabled: false, grants: { hr: { role: 'admin', via: 'grant' } } });
});

describe('checklists', () => {
  let onboardingTemplate: string;

  it('seeds default templates once', async () => {
    let res = await request(app).get('/api/checklists/templates').set('Authorization', auth);
    expect(res.body.templates).toHaveLength(0);
    res = await request(app).post('/api/checklists/templates/seed-defaults').set('Authorization', auth);
    expect(res.body.templates).toHaveLength(2);
    onboardingTemplate = res.body.templates.find((t: { kind: string }) => t.kind === 'onboarding').id;
    res = await request(app).post('/api/checklists/templates/seed-defaults').set('Authorization', auth);
    expect(res.body.templates).toHaveLength(2);
  });

  it('applies a template with due dates from the start date, idempotently', async () => {
    let res = await request(app).post(`/api/members/${bob}/checklist/apply`).set('Authorization', auth).send({ templateId: onboardingTemplate });
    expect(res.status).toBe(200);
    expect(res.body.onboarding.total).toBeGreaterThan(5);
    expect(res.body.onboarding.done).toBe(0);
    const checkIn = res.body.tasks.find((t: { title: string }) => t.title === '30-day check-in');
    expect(checkIn.dueDate).toBe('2026-10-01');
    const n = res.body.onboarding.total;
    res = await request(app).post(`/api/members/${bob}/checklist/apply`).set('Authorization', auth).send({ templateId: onboardingTemplate });
    expect(res.body.onboarding.total).toBe(n);
  });

  it('ticks tasks, adds a custom one, counts overdue, and feeds the dashboard', async () => {
    let res = await request(app).get(`/api/members/${bob}/checklist`).set('Authorization', auth);
    const first = res.body.tasks[0];
    res = await request(app).patch(`/api/members/${bob}/checklist/${first.id}`).set('Authorization', auth).send({ done: true });
    expect(res.body.onboarding.done).toBe(1);
    expect(res.body.tasks[0].doneByEmail).toBe('david@xavadigital.com');
    res = await request(app).post(`/api/members/${bob}/checklist`).set('Authorization', auth).send({ title: 'Order laptop', dueDate: '2026-09-02' });
    expect(res.status).toBe(201);
    expect(res.body.onboarding.overdue).toBeGreaterThanOrEqual(1);

    const d = await request(app).get('/api/dashboard?asOf=2026-09-12').set('Authorization', auth);
    expect(d.body.onboarding[0]).toMatchObject({ name: 'Bob Builder', progress: { done: 1 } });

    res = await request(app).patch(`/api/members/${bob}/checklist/${first.id}`).set('Authorization', auth).send({ done: false });
    expect(res.body.onboarding.done).toBe(0);
    const custom = res.body.tasks.find((t: { title: string }) => t.title === 'Order laptop');
    res = await request(app).delete(`/api/members/${bob}/checklist/${custom.id}`).set('Authorization', auth);
    expect(res.body.tasks.some((t: { title: string }) => t.title === 'Order laptop')).toBe(false);
  });

  it('creates, edits and deletes templates; only one default per kind', async () => {
    let res = await request(app).post('/api/checklists/templates').set('Authorization', auth).send({ name: 'Designer onboarding', kind: 'onboarding', isDefault: true, items: [{ title: 'Figma seat', dueDays: 0 }] });
    expect(res.status).toBe(201);
    const list = await request(app).get('/api/checklists/templates').set('Authorization', auth);
    const defaults = list.body.templates.filter((t: { kind: string; isDefault: boolean }) => t.kind === 'onboarding' && t.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe('Designer onboarding');
    res = await request(app).patch(`/api/checklists/templates/${res.body.template.id}`).set('Authorization', auth).send({ items: [] });
    expect(res.body.template.items).toEqual([]);
    res = await request(app).delete(`/api/checklists/templates/${res.body.template.id}`).set('Authorization', auth);
    expect(res.status).toBe(204);
  });
});

describe('member events', () => {
  it('notes timeline CRUD', async () => {
    let res = await request(app).post(`/api/members/${bob}/events`).set('Authorization', auth).send({ date: '2026-09-10', type: 'review', text: 'Great first week' });
    expect(res.status).toBe(201);
    const id = res.body.event.id;
    expect(res.body.event.createdByEmail).toBe('david@xavadigital.com');
    res = await request(app).post(`/api/members/${bob}/events`).set('Authorization', auth).send({ date: '2026-09-11', text: 'Asked about a laptop' });
    expect(res.body.event.type).toBe('note');
    res = await request(app).get(`/api/members/${bob}/events`).set('Authorization', auth);
    expect(res.body.events.map((e: { date: string }) => e.date)).toEqual(['2026-09-11', '2026-09-10']);
    res = await request(app).patch(`/api/members/${bob}/events/${id}`).set('Authorization', auth).send({ type: 'milestone' });
    expect(res.body.event.type).toBe('milestone');
    res = await request(app).delete(`/api/members/${bob}/events/${id}`).set('Authorization', auth);
    expect(res.status).toBe(204);
    res = await request(app).post(`/api/members/${bob}/events`).set('Authorization', auth).send({ date: '2026-09-10', text: '' });
    expect(res.status).toBe(400);
  });
});
