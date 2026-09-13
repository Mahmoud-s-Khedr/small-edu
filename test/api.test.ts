import migration from '../drizzle/0000_initial.sql?raw';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const userId = '11111111-1111-4111-8111-111111111111';
const secondUserId = '22222222-2222-4222-8222-222222222222';
const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const moduleId = '33333333-3333-4333-8333-333333333333';
const lectureId = '44444444-4444-4444-8444-444444444444';

const auth = (id: string) => ({ Authorization: `Bearer dev:${id}` });
const request = (path: string, init: RequestInit = {}) => SELF.fetch(`https://medly.test${path}`, init);
const json = (path: string, method: string, body: unknown, user = adminId) => request(path, {
  method, headers: { ...auth(user), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

async function seed(): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(userId, 'student@example.test', 'Student', 'USER', now, now),
    env.DB.prepare('INSERT INTO users (id, email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(secondUserId, 'other@example.test', 'Other Student', 'USER', now, now),
    env.DB.prepare('INSERT INTO users (id, email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(adminId, 'admin@example.test', 'Admin', 'ADMIN', now, now),
  ]);
}

beforeAll(async () => {
  await env.DB.batch(migration.split('--> statement-breakpoint').map((statement) => env.DB.prepare(statement)));
});

beforeEach(async () => {
  await env.DB.batch([
    'user_flashcard_state', 'mcq_choices', 'mcqs', 'flashcards', 'lecture_materials', 'module_access', 'booking_requests', 'lectures', 'modules', 'users',
  ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  await seed();
});

describe('Medly API', () => {
  it('serves health without authentication', async () => {
    const response = await request('/api/v1/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: 'ok' } });
  });

  it('rejects invalid module input and anonymous access', async () => {
    expect((await request('/api/v1/modules')).status).toBe(401);
    const response = await json('/api/v1/modules', 'POST', { title: '' });
    expect(response.status).toBe(422);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('performs admin module CRUD and restricts regular users', async () => {
    const payload = { title: 'Cardiology', number: '101', academicYear: '2026', semester: 'Fall', priceCents: 4900 };
    expect((await json('/api/v1/modules', 'POST', payload, userId)).status).toBe(403);
    const created = await json('/api/v1/modules', 'POST', payload);
    expect(created.status).toBe(201);
    const module = (await created.json() as { data: { id: string } }).data;
    expect((await request(`/api/v1/modules/${module.id}`, { headers: auth(userId) })).status).toBe(200);
    expect((await json(`/api/v1/modules/${module.id}`, 'PATCH', { title: 'Advanced Cardiology' })).status).toBe(200);
    expect((await request(`/api/v1/modules/${module.id}`, { method: 'DELETE', headers: auth(adminId) })).status).toBe(204);
  });

  it('enforces the module-to-lecture relationship and cascade deletion', async () => {
    const now = Date.now();
    await env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(moduleId, 'Anatomy', '1', '2026', 'Spring', 100, now, now).run();
    const lecture = await json(`/api/v1/modules/${moduleId}/lectures`, 'POST', {
      title: 'Bones', description: '', subject: 'Anatomy', lectureDate: new Date(now).toISOString(), videoUrl: 'https://youtube.com/watch?v=test',
    });
    expect(lecture.status).toBe(201);
    expect((await request(`/api/v1/modules/${moduleId}/lectures`, { headers: auth(userId) })).status).toBe(200);
    await request(`/api/v1/modules/${moduleId}`, { method: 'DELETE', headers: auth(adminId) });
    expect((await env.DB.prepare('SELECT count(*) AS count FROM lectures WHERE module_id = ?').bind(moduleId).first<{ count: number }>())?.count).toBe(0);
  });

  it('creates a booking and grants video access only when accepted', async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(moduleId, 'Physiology', '2', '2026', 'Fall', 100, now, now),
      env.DB.prepare('INSERT INTO lectures (id, module_id, title, description, subject, lecture_date, video_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(lectureId, moduleId, 'Heart', '', 'Physiology', now, 'https://youtube.com/watch?v=heart', now, now),
    ]);
    const key = `payment-receipts/${userId}/receipt.pdf`;
    await env.STORAGE.put(key, 'receipt', { httpMetadata: { contentType: 'application/pdf' } });
    const created = await json('/api/v1/bookings', 'POST', { moduleId, receiptKey: key }, userId);
    expect(created.status).toBe(201);
    const bookingId = (await created.json() as { data: { id: string } }).data.id;
    expect((await request(`/api/v1/lectures/${lectureId}/video`, { headers: auth(userId) })).status).toBe(403);
    expect((await json(`/api/v1/admin/bookings/${bookingId}`, 'PATCH', { status: 'ACCEPTED' })).status).toBe(200);
    expect((await request(`/api/v1/lectures/${lectureId}/video`, { headers: auth(userId) })).status).toBe(200);
    expect((await json(`/api/v1/admin/bookings/${bookingId}`, 'PATCH', { status: 'REJECTED' })).status).toBe(409);
  });

  it('isolates flashcard progress and hiding never deletes the global card', async () => {
    const now = Date.now();
    const cardId = '55555555-5555-4555-8555-555555555555';
    await env.DB.batch([
      env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(moduleId, 'Neuro', '3', '2026', 'Fall', 0, now, now),
      env.DB.prepare('INSERT INTO lectures (id, module_id, title, description, subject, lecture_date, video_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(lectureId, moduleId, 'Brain', '', 'Neuro', now, 'https://youtube.com/watch?v=brain', now, now),
      env.DB.prepare('INSERT INTO flashcards (id, lecture_id, front_text, back_text, ordering, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(cardId, lectureId, 'Q', 'A', 0, now, now),
    ]);
    expect((await json(`/api/v1/flashcards/${cardId}/state`, 'PUT', { knowledge: 'KNOWN', hidden: true }, userId)).status).toBe(200);
    expect((await request(`/api/v1/lectures/${lectureId}/flashcards`, { headers: auth(userId) })).status).toBe(200);
    const other = await request(`/api/v1/lectures/${lectureId}/flashcards`, { headers: auth(secondUserId) });
    expect((await other.json() as { data: unknown[] }).data).toHaveLength(1);
    expect((await env.DB.prepare('SELECT id FROM flashcards WHERE id = ?').bind(cardId).first())?.id).toBe(cardId);
  });

  it('hides MCQ answers until an explicit answer check', async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(moduleId, 'Pharmacology', '4', '2026', 'Fall', 0, now, now),
      env.DB.prepare('INSERT INTO lectures (id, module_id, title, description, subject, lecture_date, video_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(lectureId, moduleId, 'Drugs', '', 'Pharm', now, 'https://youtube.com/watch?v=drugs', now, now),
    ]);
    const created = await json(`/api/v1/lectures/${lectureId}/mcqs`, 'POST', { questionText: 'Best?', ordering: 0, choices: [
      { text: 'A', isCorrect: false }, { text: 'B', isCorrect: true }, { text: 'C', isCorrect: false }, { text: 'D', isCorrect: false },
    ] });
    const question = (await created.json() as { data: { id: string; choices: Array<{ id: string }> } }).data;
    const listed = await request(`/api/v1/lectures/${lectureId}/mcqs`, { headers: auth(userId) });
    expect(JSON.stringify(await listed.json())).not.toContain('isCorrect');
    const checked = await json(`/api/v1/mcqs/${question.id}/check-answer`, 'POST', { choiceId: question.choices[1]!.id }, userId);
    expect((await checked.json() as { data: { correct: boolean } }).data.correct).toBe(true);
  });
});
