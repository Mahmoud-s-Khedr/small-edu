import migration from '../drizzle/0000_initial.sql?raw';
import identityMigration from '../drizzle/0001_ordinary_morbius.sql?raw';
import deletionMigration from '../drizzle/0002_account_deletion.sql?raw';
import { processAccountDeletion, retryAccountDeletions, requestAccountDeletion } from '../src/lib/account-deletion';
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { verifyFirebaseIdToken } from '../src/middleware/auth';

const userId = '11111111-1111-4111-8111-111111111111';
const secondUserId = '22222222-2222-4222-8222-222222222222';
const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const superAdminId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const moduleId = '33333333-3333-4333-8333-333333333333';
const lectureId = '44444444-4444-4444-8444-444444444444';

const seedSubjects = new Map([
  [userId, 'seed-student'],
  [secondUserId, 'seed-second-student'],
  [adminId, 'seed-admin'],
  [superAdminId, 'seed-super-admin'],
]);
let deletionMode: 'success' | 'missing' | 'fail' | 'oauth-fail' = 'fail';
let deletedUids: string[] = [];
let oauthAssertions: string[] = [];
let authTokens = new Map<string, string>();

const auth = (id: string) => {
  const token = authTokens.get(id);
  if (!token) throw new Error(`Missing Firebase test token for user ${id}`);
  return { Authorization: `Bearer ${token}` };
};
const request = (path: string, init: RequestInit = {}) => SELF.fetch(`https://medly.test${path}`, init);
const json = (path: string, method: string, body: unknown, user = adminId) => request(path, {
  method, headers: { ...auth(user), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const firebaseProject = 'medly-test';
let firebasePrivateKey: CryptoKey;
let firebaseKid: string;

async function firebaseToken(
  overrides: Record<string, unknown> = {},
  header: Record<string, string> = {},
  options: { subject?: string; issuedAt?: number; expiresAt?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    auth_time: now,
    email: 'firebase.student@example.test',
    email_verified: true,
    name: 'Firebase Student',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: firebaseKid, ...header })
    .setIssuer(`https://securetoken.google.com/${firebaseProject}`)
    .setAudience(firebaseProject)
    .setSubject(options.subject ?? 'firebase-user-1')
    .setIssuedAt(options.issuedAt ?? now)
    .setExpirationTime(options.expiresAt ?? now + 3600)
    .sign(firebasePrivateKey);
}

async function seed(): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, external_subject, email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(userId, seedSubjects.get(userId), 'student@example.test', 'Student', 'USER', now, now),
    env.DB.prepare('INSERT INTO users (id, external_subject, email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(secondUserId, seedSubjects.get(secondUserId), 'other@example.test', 'Other Student', 'USER', now, now),
    env.DB.prepare('INSERT INTO users (id, external_subject, email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(adminId, seedSubjects.get(adminId), 'admin@example.test', 'Admin', 'ADMIN', now, now),
    env.DB.prepare('INSERT INTO users (id, external_subject, email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(superAdminId, seedSubjects.get(superAdminId), 'super-admin@example.test', 'Super Admin', 'SUPER_ADMIN', now, now),
  ]);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  firebasePrivateKey = pair.privateKey;
  firebaseKid = 'firebase-test-key';
  const publicJwk = await exportJWK(pair.publicKey);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') {
      return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: firebaseKid, use: 'sig', alg: 'RS256' }] }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
      });
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      oauthAssertions.push(new URLSearchParams(String(init?.body)).get('assertion')!);
      return Response.json(deletionMode === 'oauth-fail' ? { error: 'invalid_grant' } : { access_token: 'test-access-token' },
        { status: deletionMode === 'oauth-fail' ? 400 : 200 });
    }
    if (url === 'https://identitytoolkit.googleapis.com/v1/projects/medly-test/accounts:delete') {
      deletedUids.push(JSON.parse(String(init?.body)).localId);
      return Response.json(deletionMode === 'success' ? {} : { error: { message: deletionMode === 'missing' ? 'USER_NOT_FOUND' : 'PERMISSION_DENIED' } },
        { status: deletionMode === 'success' ? 200 : deletionMode === 'missing' ? 400 : 403 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  await env.DB.batch(migration.split('--> statement-breakpoint').map((statement) => env.DB.prepare(statement)));
  await env.DB.batch(identityMigration.split('--> statement-breakpoint').map((statement) => env.DB.prepare(statement)));
  // Exercise the new migration against populated tables, not only an empty DB.
  await seed();
  const migrationTime = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(moduleId, 'Migration course', '1', '2026', 'Spring', migrationTime, migrationTime),
    env.DB.prepare('INSERT INTO booking_requests (id, user_id, module_id, receipt_key, receipt_filename, receipt_content_type, receipt_size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('migration-booking', userId, moduleId, 'payment-receipts/migration.pdf', 'migration.pdf', 'application/pdf', 1, migrationTime, migrationTime),
    env.DB.prepare('INSERT INTO module_access (user_id, module_id, granted_at) VALUES (?, ?, ?)').bind(userId, moduleId, migrationTime),
  ]);
  await env.DB.batch(deletionMigration.split('--> statement-breakpoint').map((statement) => env.DB.prepare(statement)));
  expect(await env.DB.prepare('SELECT user_id, receipt_key FROM booking_requests WHERE id = ?').bind('migration-booking').first())
    .toEqual({ user_id: userId, receipt_key: 'payment-receipts/migration.pdf' });
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  expect(await env.DB.prepare('SELECT user_id, receipt_key FROM booking_requests WHERE id = ?').bind('migration-booking').first())
    .toEqual({ user_id: null, receipt_key: 'payment-receipts/migration.pdf' });
  expect(await env.DB.prepare('SELECT * FROM module_access WHERE user_id = ?').bind(userId).first()).toBeNull();
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(async () => {
  deletionMode = 'fail';
  deletedUids = [];
  oauthAssertions = [];
  await env.DB.batch([
    'account_deletion_jobs', 'user_flashcard_state', 'mcq_choices', 'mcqs', 'flashcards', 'lecture_materials', 'module_access', 'booking_requests', 'lectures', 'modules', 'users',
  ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  await seed();
  authTokens = new Map(await Promise.all([...seedSubjects.entries()].map(async ([id, subject]) => [
    id,
    await firebaseToken({ email: `${subject}@example.test` }, {}, { subject }),
  ] as const)));
});

describe('Medly API', () => {
  it('serves generated Swagger documentation without authentication', async () => {
    const [ui, spec] = await Promise.all([
      request('/api/v1/docs'),
      request('/api/v1/openapi'),
    ]);
    expect(ui.status).toBe(200);
    expect(spec.status).toBe(200);
    const document = await spec.json() as { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
    expect(document.paths).toHaveProperty('/modules');
    expect(document.paths).toHaveProperty('/academic-years');
    expect(document.paths).toHaveProperty('/semesters');
    expect(document.paths).toHaveProperty('/subjects');
    expect(document.paths['/me']).toHaveProperty('delete.responses.202');
    expect(document.paths).toHaveProperty('/lectures/{lectureId}/mcqs');
    expect(document.components.schemas).toHaveProperty('Module');
  });

  it('serves health without authentication', async () => {
    const response = await request('/api/v1/health', { headers: { Origin: 'https://local-client.example.test' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: 'ok' } });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://local-client.example.test');
  });

  it('rejects invalid module input and anonymous access', async () => {
    expect((await request('/api/v1/modules')).status).toBe(401);
    const response = await json('/api/v1/modules', 'POST', { title: '' });
    expect(response.status).toBe(422);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('lets an authenticated user update only their display name', async () => {
    const update = await json('/api/v1/me', 'PATCH', { name: '  Updated Student  ' }, userId);
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ data: { id: userId, name: 'Updated Student', email: 'student@example.test', role: 'USER' } });

    const current = await request('/api/v1/me', { headers: auth(userId) });
    expect(await current.json()).toMatchObject({ data: { name: 'Updated Student' } });

    const invalid = await json('/api/v1/me', 'PATCH', { name: '   ' }, userId);
    expect(invalid.status).toBe(422);
    const otherUser = await request('/api/v1/me', { headers: auth(secondUserId) });
    expect((await otherUser.json() as { data: { name: string } }).data.name).toBe('Other Student');
  });

  it('rejects anonymous and stale account deletion without changing the account', async () => {
    expect((await request('/api/v1/me', { method: 'DELETE' })).status).toBe(401);
    const stale = await firebaseToken({ auth_time: Math.floor(Date.now() / 1000) - 301 }, {}, { subject: 'seed-student' });
    const response = await request('/api/v1/me', { method: 'DELETE', headers: { Authorization: `Bearer ${stale}` } });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'REAUTHENTICATION_REQUIRED' } });
    expect(await env.DB.prepare('SELECT * FROM account_deletion_jobs').all()).toMatchObject({ results: [] });
    expect((await request('/api/v1/me', { headers: auth(userId) })).status).toBe(200);
  });

  it('accepts only the caller’s deletion, blocks access, and retries failures durably', async () => {
    const response = await json('/api/v1/me', 'DELETE', { userId: secondUserId }, userId);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: { status: 'pending' } });
    await vi.waitFor(async () => {
      expect(await env.DB.prepare('SELECT last_error FROM account_deletion_jobs WHERE firebase_uid = ?')
        .bind('seed-student').first()).toEqual({ last_error: 'FIREBASE_DELETE_FAILED' });
    });
    expect(deletedUids).toEqual(['seed-student']);
    expect((await request('/api/v1/me', { headers: auth(userId) })).status).toBe(401);
    expect((await request('/api/v1/me', { headers: auth(secondUserId) })).status).toBe(200);
    expect((await request('/api/v1/auth/session', { method: 'POST', headers: auth(userId) })).status).toBe(409);
    expect((await request('/api/v1/me', { method: 'DELETE', headers: auth(userId) })).status).toBe(202);
    expect((await env.DB.prepare('SELECT count(*) AS total FROM account_deletion_jobs').first())).toEqual({ total: 1 });
    await retryAccountDeletions(env); // Backoff prevents immediate provider hammering.
    expect(deletedUids).toHaveLength(1);
    deletionMode = 'missing'; // Firebase already deleted the identity on an earlier attempt.
    await env.DB.prepare('UPDATE account_deletion_jobs SET next_attempt_at = 0').run();
    await retryAccountDeletions(env);
    expect(await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()).toBeNull();
    expect(await env.DB.prepare('SELECT completed_at, last_error FROM account_deletion_jobs').first())
      .toEqual({ completed_at: expect.any(Number), last_error: null });
    const completed = await request('/api/v1/me', { method: 'DELETE', headers: auth(userId) });
    expect(completed.status).toBe(202);
    expect(await completed.json()).toEqual({ data: { status: 'completed' } });
    expect((await request('/api/v1/auth/session', { method: 'POST', headers: auth(userId) })).status).toBe(409);
  });

  it('preserves receipts and bookings, removes personal progress, and permits fresh signup with the same email', async () => {
    const now = Date.now();
    const cardId = '55555555-5555-4555-8555-555555555555';
    const bookingId = '66666666-6666-4666-8666-666666666666';
    const key = `payment-receipts/${userId}/retained.pdf`;
    const abandonedKey = `payment-receipts/${userId}/unsubmitted.pdf`;
    await env.STORAGE.put(key, 'retained receipt');
    await env.STORAGE.put(abandonedKey, 'unsubmitted receipt');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(moduleId, 'Anatomy', '1', '2026', 'Spring', now, now),
      env.DB.prepare('INSERT INTO lectures (id, module_id, title, subject, lecture_date, video_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(lectureId, moduleId, 'Bones', 'Anatomy', now, 'https://example.test/video', now, now),
      env.DB.prepare('INSERT INTO flashcards (id, lecture_id, front_text, back_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(cardId, lectureId, 'Front', 'Back', now, now),
      env.DB.prepare('INSERT INTO user_flashcard_state (user_id, flashcard_id, knowledge, updated_at) VALUES (?, ?, ?, ?)')
        .bind(userId, cardId, 'KNOWN', now),
      env.DB.prepare('INSERT INTO module_access (user_id, module_id, granted_at) VALUES (?, ?, ?)').bind(userId, moduleId, now),
      env.DB.prepare('INSERT INTO booking_requests (id, user_id, module_id, receipt_key, receipt_filename, receipt_content_type, receipt_size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(bookingId, userId, moduleId, key, 'retained.pdf', 'application/pdf', 16, now, now),
    ]);
    deletionMode = 'success';
    expect((await request('/api/v1/me', { method: 'DELETE', headers: auth(userId) })).status).toBe(202);
    await vi.waitFor(async () => {
      expect(await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()).toBeNull();
    });
    expect(await env.DB.prepare('SELECT * FROM module_access WHERE user_id = ?').bind(userId).first()).toBeNull();
    expect(await env.DB.prepare('SELECT * FROM user_flashcard_state WHERE user_id = ?').bind(userId).first()).toBeNull();
    expect(await env.DB.prepare('SELECT user_id, receipt_key, status FROM booking_requests WHERE id = ?').bind(bookingId).first())
      .toEqual({ user_id: null, receipt_key: key, status: 'PENDING' });
    expect(await env.STORAGE.head(key)).not.toBeNull();
    expect(await env.STORAGE.head(abandonedKey)).not.toBeNull();
    expect((await request(`/api/v1/admin/bookings/${bookingId}/receipt`, { headers: auth(adminId) })).status).toBe(200);
    const decision = await json(`/api/v1/admin/bookings/${bookingId}`, 'PATCH', { status: 'ACCEPTED' });
    expect(decision.status).toBe(200);
    expect(await decision.json()).toMatchObject({ data: { userId: null, status: 'ACCEPTED' } });
    expect(await env.DB.prepare('SELECT * FROM module_access').all()).toMatchObject({ results: [] });
    expect(await env.DB.prepare('SELECT id FROM flashcards WHERE id = ?').bind(cardId).first()).not.toBeNull();
    const freshToken = await firebaseToken({ email: 'student@example.test' }, {}, { subject: 'new-firebase-uid' });
    const fresh = await request('/api/v1/auth/session', { method: 'POST', headers: { Authorization: `Bearer ${freshToken}` } });
    expect(fresh.status).toBe(200);
    const payload = await fresh.json() as { data: { created: boolean; user: { id: string; role: string } } };
    expect(payload.data.created).toBe(true);
    expect(payload.data.user.id).not.toBe(userId);
    expect(payload.data.user.role).toBe('USER');
    expect(await (await request('/api/v1/bookings', { headers: { Authorization: `Bearer ${freshToken}` } })).json()).toEqual({ data: [] });
    expect(await env.DB.prepare('SELECT user_id FROM booking_requests WHERE id = ?').bind(bookingId).first()).toEqual({ user_id: null });
  });

  it('retains unsubmitted receipts and disables the former receipt deletion endpoint', async () => {
    const key = `payment-receipts/${userId}/cannot-delete.pdf`;
    await env.STORAGE.put(key, 'receipt');
    expect((await json('/api/v1/bookings/receipt', 'DELETE', { receiptKey: key }, userId)).status).toBe(409);
    await retryAccountDeletions(env);
    expect(await env.STORAGE.head(key)).not.toBeNull();
  });

  it('does not mark accounts when Firebase deletion credentials are missing', async () => {
    await expect(requestAccountDeletion({ ...env, FIREBASE_PRIVATE_KEY: undefined },
      { subject: 'seed-student', email: 'student@example.test', emailVerified: true, authTime: Math.floor(Date.now() / 1000) }))
      .rejects.toMatchObject({ status: 503 });
    expect(await env.DB.prepare('SELECT deletion_requested_at FROM users WHERE id = ?').bind(userId).first())
      .toEqual({ deletion_requested_at: null });
  });

  it('retries a failed D1 cleanup without repeating successful Firebase deletion', async () => {
    const identity = { subject: 'seed-student', email: 'student@example.test', emailVerified: true, authTime: Math.floor(Date.now() / 1000) };
    await requestAccountDeletion(env, identity);
    deletionMode = 'success';
    await env.DB.prepare("CREATE TRIGGER prevent_account_delete BEFORE DELETE ON users BEGIN SELECT RAISE(FAIL, 'test storage failure'); END").run();
    try {
      await processAccountDeletion(env, identity.subject);
      expect(await env.DB.prepare('SELECT firebase_deleted_at, completed_at, last_error FROM account_deletion_jobs').first())
        .toEqual({ firebase_deleted_at: expect.any(Number), completed_at: null, last_error: 'LOCAL_DELETE_FAILED' });
      expect(await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()).not.toBeNull();
    } finally {
      await env.DB.prepare('DROP TRIGGER prevent_account_delete').run();
    }
    await env.DB.prepare('UPDATE account_deletion_jobs SET next_attempt_at = 0').run();
    await retryAccountDeletions(env);
    expect(deletedUids).toEqual(['seed-student']);
    expect(await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()).toBeNull();
  });

  it('leases concurrent jobs, sanitizes OAuth errors, and removes only expired completed tombstones', async () => {
    const identity = { subject: 'seed-student', email: 'student@example.test', emailVerified: true, authTime: Math.floor(Date.now() / 1000) };
    await Promise.all([requestAccountDeletion(env, identity), requestAccountDeletion(env, identity)]);
    deletionMode = 'oauth-fail';
    await Promise.all([processAccountDeletion(env, identity.subject), processAccountDeletion(env, identity.subject)]);
    expect(oauthAssertions).toHaveLength(1);
    expect(decodeJwt(oauthAssertions[0]!)).toMatchObject({
      iss: 'deletion-test@medly-test.iam.gserviceaccount.com', aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/identitytoolkit', iat: expect.any(Number), exp: expect.any(Number),
    });
    expect(deletedUids).toHaveLength(0);
    expect(await env.DB.prepare('SELECT attempts, last_error FROM account_deletion_jobs').first())
      .toEqual({ attempts: 1, last_error: 'FIREBASE_DELETE_FAILED' });
    deletionMode = 'success';
    await env.DB.prepare('UPDATE account_deletion_jobs SET next_attempt_at = 0').run();
    await retryAccountDeletions(env);
    await retryAccountDeletions(env);
    expect(await env.DB.prepare('SELECT firebase_uid FROM account_deletion_jobs').first()).not.toBeNull();
    await env.DB.prepare('UPDATE account_deletion_jobs SET completed_at = ?').bind(Date.now() - 66 * 60 * 1000).run();
    await retryAccountDeletions(env);
    expect(await env.DB.prepare('SELECT firebase_uid FROM account_deletion_jobs').first()).toBeNull();
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

  it('lists distinct academic years, semesters, and subjects for catalogue filters', async () => {
    const now = Date.now();
    const otherModuleId = '88888888-8888-4888-8888-888888888888';
    const otherLectureId = '99999999-9999-4999-8999-999999999999';
    await env.DB.batch([
      env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(moduleId, 'Human Anatomy', '101', '2026', 'Spring', 0, now, now),
      env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(otherModuleId, 'Physiology', '201', '2025', 'Fall', 0, now, now),
      env.DB.prepare('INSERT INTO lectures (id, module_id, title, description, subject, lecture_date, video_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(lectureId, moduleId, 'Bones', '', 'Anatomy', now, 'https://video.example.test/bones', now, now),
      env.DB.prepare('INSERT INTO lectures (id, module_id, title, description, subject, lecture_date, video_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(otherLectureId, moduleId, 'Muscles', '', 'Anatomy', now, 'https://video.example.test/muscles', now, now),
      env.DB.prepare('INSERT INTO lectures (id, module_id, title, description, subject, lecture_date, video_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind('aaaaaaaa-1111-4111-8111-111111111111', otherModuleId, 'Heart', '', 'Physiology', now, 'https://video.example.test/heart', now, now),
    ]);

    expect((await request('/api/v1/academic-years')).status).toBe(401);
    expect(await (await request('/api/v1/academic-years', { headers: auth(userId) })).json())
      .toEqual({ data: ['2026', '2025'] });
    expect(await (await request('/api/v1/semesters?academicYear=2026', { headers: auth(userId) })).json())
      .toEqual({ data: ['Spring'] });
    expect(await (await request(`/api/v1/subjects?moduleId=${moduleId}`, { headers: auth(userId) })).json())
      .toEqual({ data: ['Anatomy'] });
    expect(await (await request('/api/v1/subjects?academicYear=2025&semester=Fall', { headers: auth(userId) })).json())
      .toEqual({ data: ['Physiology'] });
  });

  it('lets only a super admin manage operational admin roles', async () => {
    expect((await request('/api/v1/admin/users', { headers: auth(adminId) })).status).toBe(403);

    const listed = await request('/api/v1/admin/users', { headers: auth(superAdminId) });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ data: expect.arrayContaining([
      expect.objectContaining({ id: userId, role: 'USER' }),
    ]) });

    const promoted = await json(`/api/v1/admin/users/${userId}/role`, 'PATCH', { role: 'ADMIN' }, superAdminId);
    expect(promoted.status).toBe(200);
    expect(await promoted.json()).toMatchObject({ data: { id: userId, role: 'ADMIN' } });
    expect((await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role: string }>())?.role).toBe('ADMIN');

    expect((await json(`/api/v1/admin/users/${secondUserId}/role`, 'PATCH', { role: 'SUPER_ADMIN' }, superAdminId)).status).toBe(422);
    expect((await json(`/api/v1/admin/users/${superAdminId}/role`, 'PATCH', { role: 'USER' }, superAdminId)).status).toBe(409);

    const module = { title: 'Super-admin course', number: '901', academicYear: '2026', semester: 'Fall', priceCents: 0 };
    expect((await json('/api/v1/modules', 'POST', module, superAdminId)).status).toBe(201);
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

  it('removes R2 material and flashcard assets when a lecture is deleted', async () => {
    const now = Date.now();
    const materialKey = `lecture-materials/${lectureId}/material.pdf`;
    const imageKey = `flashcards/${lectureId}/card.png`;
    const cardId = '55555555-5555-4555-8555-555555555555';
    await env.DB.batch([
      env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(moduleId, 'Assets', '11', '2026', 'Fall', 0, now, now),
      env.DB.prepare('INSERT INTO lectures (id, module_id, title, description, subject, lecture_date, video_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(lectureId, moduleId, 'Cleanup', '', 'Assets', now, 'https://video.example.test/cleanup', now, now),
      env.DB.prepare('INSERT INTO lecture_materials (id, lecture_id, object_key, original_filename, content_type, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('66666666-6666-4666-8666-666666666666', lectureId, materialKey, 'material.pdf', 'application/pdf', 1, now, now),
      env.DB.prepare('INSERT INTO flashcards (id, lecture_id, front_text, back_text, front_image_key, ordering, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(cardId, lectureId, 'Q', 'A', imageKey, 0, now, now),
    ]);
    await Promise.all([env.STORAGE.put(materialKey, 'm'), env.STORAGE.put(imageKey, 'i')]);

    expect((await request(`/api/v1/lectures/${lectureId}`, { method: 'DELETE', headers: auth(adminId) })).status).toBe(204);
    expect(await env.STORAGE.head(materialKey)).toBeNull();
    expect(await env.STORAGE.head(imageKey)).toBeNull();
  });

  it('does not disclose locked video URLs in either lecture list', async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(moduleId, 'Protected course', '2', '2026', 'Fall', 100, now, now),
      env.DB.prepare('INSERT INTO lectures (id, module_id, title, description, subject, lecture_date, video_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(lectureId, moduleId, 'Protected lecture', '', 'Subject', now, 'https://video.example.test/private', now, now),
    ]);

    const byModule = await request(`/api/v1/modules/${moduleId}/lectures`, { headers: auth(userId) });
    expect(await byModule.json()).toMatchObject({ data: [{
      id: lectureId, videoUrl: null, videoLocked: true,
      module: {
        id: moduleId, title: 'Protected course', number: '2', academicYear: '2026', semester: 'Fall', priceCents: 100,
        createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
      },
    }] });

    const acrossModules = await request('/api/v1/lectures', { headers: auth(userId) });
    expect(await acrossModules.json()).toMatchObject({ data: [{ id: lectureId, videoUrl: null, videoLocked: true }] });

    await env.DB.prepare('INSERT INTO module_access (user_id, module_id, granted_at) VALUES (?, ?, ?)').bind(userId, moduleId, now).run();
    const unlocked = await request('/api/v1/lectures', { headers: auth(userId) });
    expect(await unlocked.json()).toMatchObject({ data: [{ id: lectureId, videoUrl: 'https://video.example.test/private', videoLocked: false }] });
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
    expect((await request(`/api/v1/admin/bookings/${bookingId}/receipt`, { headers: auth(userId) })).status).toBe(403);
    const receipt = await request(`/api/v1/admin/bookings/${bookingId}/receipt`, { headers: auth(adminId) });
    expect(receipt.status).toBe(200);
    expect(receipt.headers.get('Content-Type')).toBe('application/pdf');
    expect(new TextDecoder().decode(await receipt.arrayBuffer())).toBe('receipt');
    expect((await json(`/api/v1/admin/bookings/${bookingId}`, 'PATCH', { status: 'ACCEPTED' })).status).toBe(200);
    expect((await request(`/api/v1/lectures/${lectureId}/video`, { headers: auth(userId) })).status).toBe(200);
    expect((await json(`/api/v1/admin/bookings/${bookingId}`, 'PATCH', { status: 'REJECTED' })).status).toBe(409);
  });

  it('does not grant access when a conditional booking decision loses the race', async () => {
    const now = Date.now();
    const bookingId = '66666666-6666-4666-8666-666666666666';
    await env.DB.batch([
      env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(moduleId, 'Race course', '22', '2026', 'Fall', 100, now, now),
      env.DB.prepare('INSERT INTO booking_requests (id, user_id, module_id, receipt_key, receipt_filename, receipt_content_type, receipt_size_bytes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(bookingId, userId, moduleId, `payment-receipts/${userId}/race.pdf`, 'race.pdf', 'application/pdf', 1, 'REJECTED', now, now),
    ]);
    expect((await json(`/api/v1/admin/bookings/${bookingId}`, 'PATCH', { status: 'ACCEPTED' })).status).toBe(409);
    expect(await env.DB.prepare('SELECT * FROM module_access WHERE user_id = ? AND module_id = ?').bind(userId, moduleId).first()).toBeNull();
  });

  it('uses only presigned upload endpoints and validates upload metadata before signing', async () => {
    expect((await request('/api/v1/bookings/receipt', {
      method: 'POST', headers: { ...auth(userId), 'Content-Type': 'application/pdf' }, body: 'receipt',
    })).status).toBe(404);
    expect((await json('/api/v1/uploads', 'POST', {
      purpose: 'payment-receipt', filename: 'receipt.pdf', contentType: 'application/pdf', sizeBytes: 100 * 1024 * 1024 + 1,
    }, userId)).status).toBe(422);
    expect((await json('/api/v1/uploads', 'POST', {
      purpose: 'payment-receipt', filename: 'receipt.gif', contentType: 'image/gif', sizeBytes: 1,
    }, userId)).status).toBe(400);
  });

  it('authorizes a direct R2 upload and verifies it before attaching it', async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(moduleId, 'Direct files', '23', '2026', 'Fall', 0, now, now),
      env.DB.prepare('INSERT INTO lectures (id, module_id, title, description, subject, lecture_date, video_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(lectureId, moduleId, 'Direct upload', '', 'Files', now, 'https://video.example.test/files', now, now),
    ]);
    const details = { filename: 'notes.pdf', contentType: 'application/pdf', sizeBytes: 5 };
    const initiated = await json('/api/v1/uploads', 'POST', { purpose: 'lecture-material', lectureId, ...details });
    expect(initiated.status).toBe(201);
    const plan = (await initiated.json() as { data: { objectKey: string; uploadUrl: string; requiredHeaders: { 'Content-Type': string } } }).data;
    expect(plan.objectKey).toMatch(new RegExp(`^lecture-materials/${lectureId}/`));
    expect(plan.uploadUrl).toContain('X-Amz-Expires=600');
    expect(plan.requiredHeaders).toEqual({ 'Content-Type': 'application/pdf' });

    await env.STORAGE.put(plan.objectKey, 'notes', { httpMetadata: { contentType: 'application/pdf' } });
    const completed = await json('/api/v1/uploads/complete', 'POST', { purpose: 'lecture-material', lectureId, objectKey: plan.objectKey, ...details });
    expect(completed.status).toBe(201);
    expect(await completed.json()).toMatchObject({ data: { lectureId, originalFilename: 'notes.pdf', sizeBytes: 5 } });

    const wrongSize = await json('/api/v1/uploads/complete', 'POST', {
      purpose: 'payment-receipt', objectKey: `payment-receipts/${userId}/missing.pdf`, filename: 'missing.pdf', contentType: 'application/pdf', sizeBytes: 1,
    }, userId);
    expect(wrongSize.status).toBe(400);
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
    expect((await json(`/api/v1/flashcards/${cardId}/state`, 'PUT', { viewed: true }, userId)).status).toBe(200);
    expect(await env.DB.prepare('SELECT knowledge, hidden, viewed_at FROM user_flashcard_state WHERE user_id = ? AND flashcard_id = ?')
      .bind(userId, cardId).first()).toEqual({ knowledge: 'KNOWN', hidden: 1, viewed_at: expect.any(Number) });
    expect((await request(`/api/v1/lectures/${lectureId}/flashcards`, { headers: auth(userId) })).status).toBe(200);
    const other = await request(`/api/v1/lectures/${lectureId}/flashcards`, { headers: auth(secondUserId) });
    expect((await other.json() as { data: unknown[] }).data).toHaveLength(1);
    expect((await env.DB.prepare('SELECT id FROM flashcards WHERE id = ?').bind(cardId).first())?.id).toBe(cardId);
  });

  it('returns presigned R2 image URLs with list and single-card responses', async () => {
    const now = Date.now();
    const cardId = '56555555-5555-4555-8555-555555555555';
    await env.DB.batch([
      env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(moduleId, 'Image cards', '13', '2026', 'Fall', 0, now, now),
      env.DB.prepare('INSERT INTO lectures (id, module_id, title, description, subject, lecture_date, video_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(lectureId, moduleId, 'Images', '', 'Visual', now, 'https://video.example.test/images', now, now),
      env.DB.prepare('INSERT INTO flashcards (id, lecture_id, front_text, back_text, front_image_key, back_image_key, ordering, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(cardId, lectureId, 'Question', 'Answer', `flashcards/${lectureId}/front.png`, `flashcards/${lectureId}/back.png`, 0, now, now),
    ]);

    const response = await request(`/api/v1/lectures/${lectureId}/flashcards`, { headers: auth(userId) });
    expect(response.status).toBe(200);
    const list = await response.json() as { data: Array<{ frontImageUrl: string; backImageUrl: string }> };
    const listedCard = list.data[0];
    if (!listedCard) throw new Error('Expected the seeded flashcard');
    for (const imageUrl of [listedCard.frontImageUrl, listedCard.backImageUrl]) {
      const parsed = new URL(imageUrl);
      expect(parsed.origin).toBe('https://medly-storage.test-account.r2.cloudflarestorage.com');
      expect(parsed.searchParams.get('X-Amz-Expires')).toBe('600');
      expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy();
    }

    const single = await request(`/api/v1/flashcards/${cardId}`, { headers: auth(userId) });
    expect(single.status).toBe(200);
    const card = (await single.json() as { data: { frontImageUrl: string; backImageUrl: string } }).data;
    expect(new URL(card.frontImageUrl).pathname).toBe(`/flashcards/${lectureId}/front.png`);
    expect(new URL(card.backImageUrl).pathname).toBe(`/flashcards/${lectureId}/back.png`);
  });

  it('rejects flashcard patches that reference a private object outside the lecture', async () => {
    const now = Date.now();
    const cardId = '55555555-5555-4555-8555-555555555555';
    const receiptKey = `payment-receipts/${userId}/private.pdf`;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO modules (id, title, number, academic_year, semester, price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(moduleId, 'Secure cards', '12', '2026', 'Fall', 0, now, now),
      env.DB.prepare('INSERT INTO lectures (id, module_id, title, description, subject, lecture_date, video_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(lectureId, moduleId, 'Private keys', '', 'Secure cards', now, 'https://video.example.test/secure', now, now),
      env.DB.prepare('INSERT INTO flashcards (id, lecture_id, front_text, back_text, ordering, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(cardId, lectureId, 'Question', 'Answer', 0, now, now),
    ]);
    await env.STORAGE.put(receiptKey, 'private receipt');

    expect((await json(`/api/v1/flashcards/${cardId}`, 'PATCH', { frontImageKey: receiptKey })).status).toBe(400);
    expect((await json(`/api/v1/flashcards/${cardId}`, 'PATCH', { frontText: null })).status).toBe(400);
  });

  it('returns MCQ answers while retaining answer checks', async () => {
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
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ data: [{ choices: [{ isCorrect: false }, { isCorrect: true }, { isCorrect: false }, { isCorrect: false }] }] });
    const checked = await json(`/api/v1/mcqs/${question.id}/check-answer`, 'POST', { choiceId: question.choices[1]!.id }, userId);
    expect((await checked.json() as { data: { correct: boolean } }).data.correct).toBe(true);
  });

  it('verifies Firebase ID tokens and rejects invalid Firebase claims or signatures', async () => {
    const valid = await firebaseToken();
    expect(await verifyFirebaseIdToken(valid, env)).toMatchObject({
      subject: 'firebase-user-1', email: 'firebase.student@example.test', name: 'Firebase Student',
    });

    expect(await verifyFirebaseIdToken(await firebaseToken({}, {}, { expiresAt: Math.floor(Date.now() / 1000) - 1 }), env)).toBeNull();
    expect(await verifyFirebaseIdToken(await firebaseToken({}, { kid: 'unknown-key' }), env)).toBeNull();
    expect(await verifyFirebaseIdToken('not-a-jwt', env)).toBeNull();
    expect(await verifyFirebaseIdToken(await firebaseToken({ email_verified: false }), env)).toBeNull();
    expect(await verifyFirebaseIdToken(
      await firebaseToken({ email_verified: false }), env, undefined, { requireVerifiedEmail: false },
    )).toMatchObject({ emailVerified: false });
    expect(await verifyFirebaseIdToken(await firebaseToken({ auth_time: undefined }), env)).toBeNull();
    expect(await verifyFirebaseIdToken(await firebaseToken({ auth_time: Math.floor(Date.now() / 1000) + 3600 }), env)).toBeNull();

    const wrongProject = await new SignJWT({ email: 'firebase.student@example.test', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: firebaseKid })
      .setIssuer(`https://securetoken.google.com/${firebaseProject}`)
      .setAudience('another-project')
      .setSubject('firebase-user-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(firebasePrivateKey);
    expect(await verifyFirebaseIdToken(wrongProject, env)).toBeNull();

    const wrongIssuer = await new SignJWT({ email: 'firebase.student@example.test', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: firebaseKid })
      .setIssuer('https://issuer.example.test')
      .setAudience(firebaseProject)
      .setSubject('firebase-user-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(firebasePrivateKey);
    expect(await verifyFirebaseIdToken(wrongIssuer, env)).toBeNull();

    const unsigned = `${btoa(JSON.stringify({ alg: 'none' })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}.${btoa(JSON.stringify({
      aud: firebaseProject, iss: `https://securetoken.google.com/${firebaseProject}`, sub: 'firebase-user-1', exp: 9999999999, iat: 1,
    })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}.`;
    expect(await verifyFirebaseIdToken(unsigned, env)).toBeNull();

    const wrongAlgorithm = await new SignJWT({ email: 'firebase.student@example.test', email_verified: true })
      .setProtectedHeader({ alg: 'HS256', kid: firebaseKid })
      .setIssuer(`https://securetoken.google.com/${firebaseProject}`)
      .setAudience(firebaseProject)
      .setSubject('firebase-user-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('this-test-secret-is-at-least-32-bytes'));
    expect(await verifyFirebaseIdToken(wrongAlgorithm, env)).toBeNull();
  });

  it('provisions Firebase sessions, links legacy users, and makes repeat login idempotent', async () => {
    const token = await firebaseToken();
    expect((await request('/api/v1/modules', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    const created = await request('/api/v1/auth/session', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(created.status).toBe(200);
    const createdPayload = await created.json() as { data: { user: { id: string; role: string; name: string }; created: boolean; email_verified: boolean } };
    expect(createdPayload.data.created).toBe(true);
    expect(createdPayload.data.email_verified).toBe(true);
    expect(createdPayload.data.user.role).toBe('USER');
    expect(createdPayload.data.user.name).toBe('Firebase Student');

    const repeated = await request('/api/v1/auth/session', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(await repeated.json()).toMatchObject({ data: { created: false, email_verified: true, user: { id: createdPayload.data.user.id } } });

    const fallbackToken = await firebaseToken({ email: 'fallback-name@example.test', name: '' }, {}, { subject: 'fallback-name-user' });
    const fallback = await request('/api/v1/auth/session', { method: 'POST', headers: { Authorization: `Bearer ${fallbackToken}` } });
    expect(await fallback.json()).toMatchObject({ data: { created: true, user: { name: 'fallback-name' } } });

    const suppliedNameToken = await firebaseToken({ email: 'supplied-name@example.test' }, {}, { subject: 'supplied-name-user' });
    const suppliedName = await request('/api/v1/auth/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${suppliedNameToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  Ada Lovelace  ' }),
    });
    expect(await suppliedName.json()).toMatchObject({ data: { created: true, user: { name: 'Ada Lovelace' } } });

    const repeatWithNewName = await request('/api/v1/auth/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${suppliedNameToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Someone Else' }),
    });
    expect(await repeatWithNewName.json()).toMatchObject({ data: { created: false, user: { name: 'Ada Lovelace' } } });

    const invalidName = await request('/api/v1/auth/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${suppliedNameToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(invalidName.status).toBe(422);

    await env.DB.prepare('UPDATE users SET external_subject = NULL WHERE id = ?').bind(userId).run();
    const legacyToken = await firebaseToken({ email: 'student@example.test' }, {}, { subject: 'legacy-firebase-user' });
    const legacy = await request('/api/v1/auth/session', { method: 'POST', headers: { Authorization: `Bearer ${legacyToken}` } });
    expect(await legacy.json()).toMatchObject({ data: { created: false, user: { id: userId, role: 'USER', name: 'Student' } } });
    expect((await env.DB.prepare('SELECT external_subject AS subject FROM users WHERE id = ?').bind(userId).first<{ subject: string }>())?.subject).toBe('legacy-firebase-user');
  });

  it('reports a valid but unverified Firebase email without provisioning an account', async () => {
    const response = await request('/api/v1/auth/session', {
      method: 'POST', headers: { Authorization: `Bearer ${await firebaseToken({ email_verified: false })}` },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: {
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Verify your email address before creating a session',
      email_verified: false,
    } });
    expect(await env.DB.prepare('SELECT * FROM users WHERE external_subject = ?').bind('firebase-user-1').first()).toBeNull();
  });

  it('rejects conflicting Firebase email links and keeps Firebase roles in D1', async () => {
    const now = Date.now();
    await env.DB.prepare('INSERT INTO users (id, external_subject, email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('99999999-9999-4999-8999-999999999999', 'another-firebase-user', 'firebase.student@example.test', 'Linked', 'USER', now, now).run();
    const collision = await request('/api/v1/auth/session', {
      method: 'POST', headers: { Authorization: `Bearer ${await firebaseToken()}` },
    });
    expect(collision.status).toBe(409);

    const token = await firebaseToken({ email: 'promote@example.test' });
    await request('/api/v1/auth/session', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const payload = { title: 'Firebase role test', number: '9', academicYear: '2026', semester: 'Fall', priceCents: 0 };
    expect((await request('/api/v1/modules', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })).status).toBe(403);
    await env.DB.prepare('UPDATE users SET role = ? WHERE external_subject = ?').bind('ADMIN', 'firebase-user-1').run();
    expect((await request('/api/v1/modules', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })).status).toBe(201);
  });

});
