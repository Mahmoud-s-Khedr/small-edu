import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const defaultApiBase = 'https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1';
const defaultFirebaseApiKey = 'AIzaSyDiJ-vWOiOVh_KMiId5Ipe-8DSuFpaDRp4';
const command = process.argv[2];
const args = process.argv.slice(3);
const option = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
const flag = (name) => args.includes(name);
const isoId = () => new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const password = () => `${randomBytes(24).toString('base64url')}Aa1!`;
const ensureDir = (path) => mkdirSync(path, { recursive: true });
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const artifactDirectory = (runId) => resolve(root, 'artifacts', 'api-e2e', runId);

class Logger {
  constructor(directory) { this.directory = directory; ensureDir(directory); this.path = resolve(directory, 'events.jsonl'); this.startedAt = new Date().toISOString(); this.passed = 0; this.failed = 0; }
  event(type, fields = {}) { appendFileSync(this.path, `${JSON.stringify({ at: new Date().toISOString(), type, ...fields })}\n`); }
  pass(name, details = {}) { this.passed += 1; this.event('assertion', { name, result: 'pass', ...details }); console.log(`PASS ${name}`); }
  fail(name, details = {}) { this.failed += 1; this.event('assertion', { name, result: 'fail', ...details }); console.error(`FAIL ${name}`); }
  finish(extra = {}) {
    const result = { startedAt: this.startedAt, finishedAt: new Date().toISOString(), passed: this.passed, failed: this.failed, events: this.path, ...extra };
    writeFileSync(resolve(this.directory, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
}

async function firebaseRequest(apiKey, endpoint, body) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Firebase ${endpoint} failed (${response.status}): ${data.error?.message ?? JSON.stringify(data)}`);
  return data;
}

function usage() {
  console.error(`Usage:
  MEDLY_E2E_STUDENT_EMAIL=... MEDLY_E2E_ADMIN_EMAIL=... MEDLY_E2E_SUPERADMIN_EMAIL=... npm run e2e:prepare
  npm run e2e:run -- --state artifacts/api-e2e/<run>/state.private.json --bootstrap-superadmin

Optional environment variables: MEDLY_E2E_API_BASE, FIREBASE_API_KEY.
The prepare command stores generated passwords only in a mode-600 state file.`);
}

function writeState(directory, state) {
  const path = resolve(directory, 'state.private.json');
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

async function prepare() {
  const emails = { student: process.env.MEDLY_E2E_STUDENT_EMAIL?.trim(), admin: process.env.MEDLY_E2E_ADMIN_EMAIL?.trim(), superadmin: process.env.MEDLY_E2E_SUPERADMIN_EMAIL?.trim() };
  if (Object.values(emails).some((email) => !email || !/^\S+@\S+\.\S+$/.test(email)) || new Set(Object.values(emails)).size !== 3) {
    usage();
    throw new Error('Provide three distinct MEDLY_E2E_*_EMAIL addresses that you can verify.');
  }
  const runId = option('--run-id') ?? `e2e-${isoId()}-${randomUUID().slice(0, 8)}`;
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error('--run-id may contain only letters, numbers, and hyphens.');
  const directory = artifactDirectory(runId);
  if (existsSync(directory)) throw new Error(`Artifact directory already exists: ${directory}`);
  ensureDir(directory);
  const logger = new Logger(directory);
  const apiKey = process.env.FIREBASE_API_KEY ?? defaultFirebaseApiKey;
  const users = {};
  for (const [role, email] of Object.entries(emails)) {
    const accountPassword = password();
    const signup = await firebaseRequest(apiKey, 'accounts:signUp', { email, password: accountPassword, returnSecureToken: true, displayName: `Medly E2E ${role} ${runId}` });
    await firebaseRequest(apiKey, 'accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: signup.idToken });
    users[role] = { email, password: accountPassword, localId: signup.localId };
    logger.pass(`Firebase account created and verification email sent: ${role}`, { email });
  }
  const state = { version: 1, runId, apiBase: (process.env.MEDLY_E2E_API_BASE ?? defaultApiBase).replace(/\/+$/, ''), firebaseApiKey: apiKey, createdAt: new Date().toISOString(), users };
  const statePath = writeState(directory, state);
  logger.finish({ phase: 'prepare', statePath, verificationRequired: Object.values(emails) });
  console.log(`\nVerification required: approve the Firebase verification link for all three addresses.`);
  console.log(`After that, run:\n  npm run e2e:run -- --state ${statePath} --bootstrap-superadmin`);
}

async function signInVerified(state, role) {
  const account = state.users[role];
  const signedIn = await firebaseRequest(state.firebaseApiKey, 'accounts:signInWithPassword', { email: account.email, password: account.password, returnSecureToken: true });
  const lookup = await firebaseRequest(state.firebaseApiKey, 'accounts:lookup', { idToken: signedIn.idToken });
  if (!lookup.users?.[0]?.emailVerified) throw new Error(`${role} email is not verified: ${account.email}`);
  return { ...account, idToken: signedIn.idToken };
}

function fixtures(directory, runId) {
  const fixtureDir = resolve(directory, 'fixtures');
  ensureDir(fixtureDir);
  const note = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\nMedly E2E lecture notes ${runId}\n`);
  const receipt = Buffer.from(`%PDF-1.4\n% Medly E2E payment receipt ${runId}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const result = { note: { filename: 'medly-e2e-notes.pdf', type: 'application/pdf', bytes: note }, receipt: { filename: 'medly-e2e-receipt.pdf', type: 'application/pdf', bytes: receipt }, image: { filename: 'medly-e2e-card.png', type: 'image/png', bytes: image } };
  for (const fixture of Object.values(result)) writeFileSync(resolve(fixtureDir, fixture.filename), fixture.bytes);
  return result;
}

async function run() {
  const statePath = option('--state');
  if (!statePath) { usage(); throw new Error('--state is required.'); }
  const absoluteStatePath = resolve(process.cwd(), statePath);
  const state = json(absoluteStatePath);
  const directory = dirname(absoluteStatePath);
  const logger = new Logger(directory);
  logger.event('run-start', { runId: state.runId, apiBase: state.apiBase });
  let actors;
  try { actors = Object.fromEntries(await Promise.all(['student', 'admin', 'superadmin'].map(async (role) => [role, await signInVerified(state, role)]))); }
  catch (error) {
    logger.event('verification-pending', { message: error instanceof Error ? error.message : String(error) });
    logger.finish({ phase: 'run', status: 'verification-required' });
    throw error;
  }
  async function request(name, actor, method, path, options = {}) {
    const headers = new Headers(options.headers);
    if (actor) headers.set('Authorization', `Bearer ${actor.idToken}`);
    let body;
    if (options.json !== undefined) { headers.set('content-type', 'application/json'); body = JSON.stringify(options.json); }
    const response = await fetch(`${state.apiBase}${path}`, { method, headers, body });
    const raw = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('json') && raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
    const loggedResponse = payload
      ? JSON.parse(JSON.stringify(payload, (key, value) => ['uploadUrl', 'frontImageUrl', 'backImageUrl'].includes(key) ? '[redacted presigned URL]' : value))
      : payload;
    logger.event('request', {
      name, method, path, status: response.status, contentType, responseBytes: raw.length,
      request: options.file
        ? { kind: 'binary', filename: options.file.filename, contentType: options.file.type, sizeBytes: options.file.bytes.length, sha256: sha256(options.file.bytes) }
        : options.json !== undefined ? { kind: 'json', body: options.json } : { kind: 'empty' },
      response: loggedResponse,
    });
    return { status: response.status, headers: response.headers, payload, raw };
  }
  function expect(name, response, status) {
    const expected = Array.isArray(status) ? status : [status];
    if (!expected.includes(response.status)) { logger.fail(name, { expected, actual: response.status, response: response.payload }); throw new Error(`${name}: expected ${expected.join(' or ')}, got ${response.status}`); }
    logger.pass(name, { status: response.status });
    return response.payload?.data;
  }
  async function directUpload(name, actor, purpose, file, lectureId) {
    const details = { filename: file.filename, contentType: file.type, sizeBytes: file.bytes.length };
    const input = { purpose, ...details, ...(lectureId ? { lectureId } : {}) };
    const plan = expect(`${name}: request direct-upload URL`, await request(`${name}-upload-url`, actor, 'POST', '/uploads', { json: input }), 201);
    const directResponse = await fetch(plan.uploadUrl, { method: 'PUT', headers: plan.requiredHeaders, body: file.bytes });
    const directRaw = Buffer.from(await directResponse.arrayBuffer());
    logger.event('direct-r2-put', { name, status: directResponse.status, contentType: directResponse.headers.get('content-type') ?? '', responseBytes: directRaw.length, request: { filename: file.filename, contentType: file.type, sizeBytes: file.bytes.length, sha256: sha256(file.bytes) } });
    if (!directResponse.ok) {
      logger.fail(`${name}: R2 direct PUT`, { status: directResponse.status, response: directRaw.toString('utf8') });
      throw new Error(`${name}: R2 direct PUT failed (${directResponse.status})`);
    }
    logger.pass(`${name}: R2 direct PUT`, { status: directResponse.status });
    return expect(`${name}: complete direct upload`, await request(`${name}-complete`, actor, 'POST', '/uploads/complete', { json: { objectKey: plan.objectKey, ...input } }), 201);
  }
  function check(name, condition, details = {}) { if (!condition) { logger.fail(name, details); throw new Error(name); } logger.pass(name, details); }

  const assets = fixtures(directory, state.runId);
  const ids = {};
  let cleanupNeeded = false;
  try {
    expect('health is public', await request('health', null, 'GET', '/health'), 200);
    expect('OpenAPI document is public', await request('openapi', null, 'GET', '/openapi'), 200);
    expect('Swagger UI is public', await request('swagger', null, 'GET', '/docs'), 200);
    expect('anonymous protected request is rejected', await request('anonymous-modules', null, 'GET', '/modules'), 401);
    for (const role of ['student', 'admin', 'superadmin']) {
      expect(`session provisioning is idempotent: ${role}`, await request(`session-${role}`, actors[role], 'POST', '/auth/session'), 200);
      const me = expect(`current identity: ${role}`, await request(`me-${role}`, actors[role], 'GET', '/me'), 200);
      ids[role] = me.id;
    }
    if (flag('--bootstrap-superadmin')) {
      logger.event('bootstrap-superadmin', { email: actors.superadmin.email });
      const seeded = spawnSync('node', ['scripts/seed-superadmin.mjs', '--email', actors.superadmin.email, '--remote'], { cwd: root, stdio: 'inherit' });
      if (seeded.status !== 0) throw new Error('Super-admin bootstrap failed. Ensure Wrangler is authenticated for the target Cloudflare account.');
      const me = expect('super-admin bootstrap takes effect', await request('me-superadmin-after-bootstrap', actors.superadmin, 'GET', '/me'), 200);
      check('super-admin role is available', me.role === 'SUPER_ADMIN', { role: me.role });
    } else {
      const me = expect('super-admin identity check', await request('me-superadmin-role', actors.superadmin, 'GET', '/me'), 200);
      if (me.role !== 'SUPER_ADMIN') throw new Error('The super-admin account has not been bootstrapped. Re-run with --bootstrap-superadmin.');
    }
    expect('student cannot list users', await request('student-list-users', actors.student, 'GET', '/admin/users'), 403);
    expect('admin cannot list users', await request('admin-list-users', actors.admin, 'GET', '/admin/users'), 403);
    expect('super-admin lists users', await request('superadmin-list-users', actors.superadmin, 'GET', '/admin/users'), 200);
    const promoted = expect('super-admin promotes admin test user', await request('promote-admin', actors.superadmin, 'PATCH', `/admin/users/${ids.admin}/role`, { json: { role: 'ADMIN' } }), 200);
    check('admin role promotion persisted', promoted.role === 'ADMIN', { role: promoted.role });
    expect('student cannot create a module', await request('student-create-module', actors.student, 'POST', '/modules', { json: { title: 'Denied', number: 'DENIED', academicYear: '2026', semester: 'E2E', priceCents: 0 } }), 403);
    const mainModule = expect('admin creates primary module', await request('create-main-module', actors.admin, 'POST', '/modules', { json: { title: `Medly E2E ${state.runId}`, number: `E2E-${state.runId.slice(-8)}`, academicYear: '2026', semester: 'E2E', priceCents: 1250 } }), 201);
    ids.mainModule = mainModule.id; cleanupNeeded = true;
    expect('list modules with filters', await request('list-modules-filtered', actors.student, 'GET', `/modules?page=1&pageSize=1&number=${encodeURIComponent(mainModule.number)}&academicYear=2026&semester=E2E`), 200);
    expect('get module', await request('get-main-module', actors.student, 'GET', `/modules/${ids.mainModule}`), 200);
    expect('update module', await request('patch-main-module', actors.admin, 'PATCH', `/modules/${ids.mainModule}`, { json: { title: `${mainModule.title} updated` } }), 200);
    const lecture = expect('admin creates primary lecture', await request('create-main-lecture', actors.admin, 'POST', `/modules/${ids.mainModule}/lectures`, { json: { title: `E2E lecture ${state.runId}`, description: 'Automated end-to-end test lecture.', subject: 'E2E', lectureDate: '2026-09-29T12:00:00.000Z', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }), 201);
    ids.lecture = lecture.id;
    expect('list module lectures with filters', await request('list-module-lectures', actors.student, 'GET', `/modules/${ids.mainModule}/lectures?page=1&pageSize=10&subject=E2E&from=2026-01-01T00%3A00%3A00.000Z&to=2026-12-31T23%3A59%3A59.000Z`), 200);
    expect('list lectures with filters', await request('list-lectures', actors.student, 'GET', `/lectures?page=1&pageSize=10&moduleId=${ids.mainModule}&subject=E2E&academicYear=2026&semester=E2E`), 200);
    const lockedLecture = expect('student gets locked lecture detail', await request('student-get-locked-lecture', actors.student, 'GET', `/lectures/${ids.lecture}`), 200);
    check('student video URL is hidden before acceptance', lockedLecture.videoUrl === null && lockedLecture.videoLocked === true);
    expect('student cannot retrieve locked video', await request('student-locked-video', actors.student, 'GET', `/lectures/${ids.lecture}/video`), 403);
    expect('admin updates lecture', await request('patch-main-lecture', actors.admin, 'PATCH', `/lectures/${ids.lecture}`, { json: { description: 'Updated by the automated E2E suite.' } }), 200);
    const material = await directUpload('admin uploads a real PDF material', actors.admin, 'lecture-material', assets.note, ids.lecture);
    ids.material = material.id;
    expect('student lists materials', await request('list-materials', actors.student, 'GET', `/lectures/${ids.lecture}/materials`), 200);
    const downloadedMaterial = await request('download-material', actors.student, 'GET', `/lectures/${ids.lecture}/materials/${ids.material}/download`);
    expect('student downloads material', downloadedMaterial, 200);
    check('material download bytes match uploaded PDF', sha256(downloadedMaterial.raw) === sha256(assets.note.bytes));
    expect('admin renames material', await request('rename-material', actors.admin, 'PATCH', `/lectures/${ids.lecture}/materials/${ids.material}`, { json: { originalFilename: 'renamed-e2e-notes.pdf' } }), 200);
    expect('admin deletes material', await request('delete-material', actors.admin, 'DELETE', `/lectures/${ids.lecture}/materials/${ids.material}`), 204);
    const front = await directUpload('admin uploads real flashcard front image', actors.admin, 'flashcard-image', assets.image, ids.lecture);
    const back = await directUpload('admin uploads real flashcard back image', actors.admin, 'flashcard-image', assets.image, ids.lecture);
    const card = expect('admin creates flashcard', await request('create-flashcard', actors.admin, 'POST', `/lectures/${ids.lecture}/flashcards`, { json: { frontImageKey: front.objectKey, backImageKey: back.objectKey, ordering: 3 } }), 201);
    ids.card = card.id;
    const studentCards = expect('student lists flashcards', await request('student-list-flashcards', actors.student, 'GET', `/lectures/${ids.lecture}/flashcards`), 200);
    check('flashcard response does not leak object keys', !JSON.stringify(studentCards).includes(front.objectKey));
    const listedCard = studentCards.find((item) => item.id === ids.card);
    check('flashcard list includes the new card', Boolean(listedCard));
    const singleCard = expect('student gets full flashcard', await request('student-get-flashcard', actors.student, 'GET', `/flashcards/${ids.card}`), 200);
    for (const [side, imageUrl] of Object.entries({ front: listedCard.frontImageUrl, back: listedCard.backImageUrl })) {
      check(`${side} image URL is a presigned R2 download URL`, typeof imageUrl === 'string' && imageUrl.includes('X-Amz-Signature'));
      const image = await fetch(imageUrl);
      const imageBytes = Buffer.from(await image.arrayBuffer());
      logger.event('direct-r2-get', { name: `download-flashcard-${side}`, status: image.status, contentType: image.headers.get('content-type') ?? '', responseBytes: imageBytes.length, url: '[redacted presigned URL]' });
      check(`student downloads ${side} flashcard image`, image.ok, { status: image.status });
      check(`${side} flashcard image bytes match`, sha256(imageBytes) === sha256(assets.image.bytes));
    }
    check('single-card response includes image download URLs', Boolean(singleCard.frontImageUrl) && Boolean(singleCard.backImageUrl));
    expect('admin updates flashcard', await request('patch-flashcard', actors.admin, 'PATCH', `/flashcards/${ids.card}`, { json: { frontText: 'Updated image-backed front' } }), 200);
    expect('student saves flashcard state', await request('set-flashcard-state', actors.student, 'PUT', `/flashcards/${ids.card}/state`, { json: { knowledge: 'KNOWN', hidden: true, viewed: true } }), 200);
    const progress = expect('student reads flashcard progress', await request('flashcard-progress', actors.student, 'GET', `/lectures/${ids.lecture}/flashcards/progress`), 200);
    check('flashcard progress reflects learner state', progress.total === 1 && progress.known === 1 && progress.hidden === 1, progress);
    const hiddenCards = expect('hidden flashcard is absent for student', await request('student-list-hidden-flashcards', actors.student, 'GET', `/lectures/${ids.lecture}/flashcards`), 200);
    check('student cannot see hidden flashcard', hiddenCards.length === 0);
    expect('admin deletes flashcard', await request('delete-flashcard', actors.admin, 'DELETE', `/flashcards/${ids.card}`), 204);
    const question = expect('admin creates MCQ', await request('create-mcq', actors.admin, 'POST', `/lectures/${ids.lecture}/mcqs`, { json: { questionText: 'Which option is correct?', ordering: 1, choices: [{ text: 'A', isCorrect: false }, { text: 'B', isCorrect: true }, { text: 'C', isCorrect: false }, { text: 'D', isCorrect: false }] } }), 201);
    ids.question = question.id;
    const questions = expect('student lists MCQs', await request('list-mcqs', actors.student, 'GET', `/lectures/${ids.lecture}/mcqs`), 200);
    check('MCQ listing includes answer keys', questions[0]?.choices?.some((choice) => choice.isCorrect === true));
    expect('student checks incorrect MCQ answer', await request('check-wrong-mcq', actors.student, 'POST', `/mcqs/${ids.question}/check-answer`, { json: { choiceId: question.choices[0].id } }), 200);
    expect('student checks correct MCQ answer', await request('check-correct-mcq', actors.student, 'POST', `/mcqs/${ids.question}/check-answer`, { json: { choiceId: question.choices[1].id } }), 200);
    const patchedQuestion = expect('admin updates MCQ choices', await request('patch-mcq', actors.admin, 'PATCH', `/mcqs/${ids.question}`, { json: { questionText: 'Updated MCQ question', choices: [{ text: 'One', isCorrect: true }, { text: 'Two', isCorrect: false }, { text: 'Three', isCorrect: false }, { text: 'Four', isCorrect: false }] } }), 200);
    check('updated MCQ includes answer keys', patchedQuestion.choices.some((choice) => choice.isCorrect === true));
    expect('admin deletes MCQ', await request('delete-mcq', actors.admin, 'DELETE', `/mcqs/${ids.question}`), 204);
    const disposable = await directUpload('student uploads disposable real receipt', actors.student, 'payment-receipt', assets.receipt);
    expect('student deletes unsubmitted receipt', await request('delete-disposable-receipt', actors.student, 'DELETE', '/bookings/receipt', { json: { receiptKey: disposable.objectKey } }), 204);
    const receipt = await directUpload('student uploads booking receipt', actors.student, 'payment-receipt', assets.receipt);
    const booking = expect('student creates booking', await request('create-booking', actors.student, 'POST', '/bookings', { json: { moduleId: ids.mainModule, receiptKey: receipt.objectKey } }), 201);
    ids.booking = booking.id;
    expect('student lists personal bookings', await request('list-student-bookings', actors.student, 'GET', '/bookings'), 200);
    expect('student cannot list admin bookings', await request('student-admin-bookings', actors.student, 'GET', '/admin/bookings'), 403);
    expect('admin lists pending bookings', await request('list-pending-bookings', actors.admin, 'GET', '/admin/bookings?page=1&pageSize=10&status=PENDING'), 200);
    const downloadedReceipt = await request('download-booking-receipt', actors.admin, 'GET', `/admin/bookings/${ids.booking}/receipt`);
    expect('admin downloads booking receipt', downloadedReceipt, 200);
    check('booking receipt bytes match uploaded PDF', sha256(downloadedReceipt.raw) === sha256(assets.receipt.bytes));
    const accepted = expect('admin accepts booking', await request('accept-booking', actors.admin, 'PATCH', `/admin/bookings/${ids.booking}`, { json: { status: 'ACCEPTED' } }), 200);
    check('booking is accepted', accepted.status === 'ACCEPTED', accepted);
    expect('student retrieves unlocked video', await request('student-unlocked-video', actors.student, 'GET', `/lectures/${ids.lecture}/video`), 200);
    const rejectedModule = expect('admin creates rejection module', await request('create-rejected-module', actors.admin, 'POST', '/modules', { json: { title: `Rejected E2E ${state.runId}`, number: `REJ-${state.runId.slice(-8)}`, academicYear: '2026', semester: 'E2E', priceCents: 500 } }), 201);
    ids.rejectedModule = rejectedModule.id;
    const rejectedReceipt = await directUpload('student uploads rejection receipt', actors.student, 'payment-receipt', assets.receipt);
    const rejectedBooking = expect('student creates rejection booking', await request('create-rejection-booking', actors.student, 'POST', '/bookings', { json: { moduleId: ids.rejectedModule, receiptKey: rejectedReceipt.objectKey } }), 201);
    expect('admin rejects booking', await request('reject-booking', actors.admin, 'PATCH', `/admin/bookings/${rejectedBooking.id}`, { json: { status: 'REJECTED' } }), 200);
    expect('booking cannot be decided twice', await request('repeat-booking-decision', actors.admin, 'PATCH', `/admin/bookings/${rejectedBooking.id}`, { json: { status: 'ACCEPTED' } }), 409);
    const cleanupLecture = expect('admin creates cleanup lecture', await request('create-cleanup-lecture', actors.admin, 'POST', `/modules/${ids.mainModule}/lectures`, { json: { title: `Cleanup lecture ${state.runId}`, subject: 'E2E', lectureDate: '2026-09-29T12:00:00.000Z', videoUrl: 'https://www.youtube.com/watch?v=3JZ_D3ELwOQ' } }), 201);
    const cleanupMaterial = await directUpload('admin uploads cleanup material', actors.admin, 'lecture-material', assets.note, cleanupLecture.id);
    check('cleanup material was created', Boolean(cleanupMaterial.id));
    expect('admin deletes lecture and associated private assets', await request('delete-cleanup-lecture', actors.admin, 'DELETE', `/lectures/${cleanupLecture.id}`), 204);
    expect('deleted lecture is unavailable', await request('get-deleted-lecture', actors.student, 'GET', `/lectures/${cleanupLecture.id}`), 404);
    expect('admin deletes rejection module', await request('delete-rejection-module', actors.admin, 'DELETE', `/modules/${ids.rejectedModule}`), 204);
    ids.rejectedModule = undefined;
    expect('admin deletes primary module and cascades records', await request('delete-main-module', actors.admin, 'DELETE', `/modules/${ids.mainModule}`), 204);
    ids.mainModule = undefined;
    expect('deleted module is unavailable', await request('get-deleted-main-module', actors.student, 'GET', `/modules/${mainModule.id}`), 404);
    cleanupNeeded = false;
  } finally {
    if (cleanupNeeded) for (const moduleId of [ids.rejectedModule, ids.mainModule].filter(Boolean)) {
      try { const response = await request('failure-cleanup-module', actors.admin, 'DELETE', `/modules/${moduleId}`); logger.event('cleanup', { moduleId, status: response.status }); }
      catch (error) { logger.event('cleanup-error', { moduleId, message: error instanceof Error ? error.message : String(error) }); }
    }
  }
  const summary = logger.finish({ phase: 'run', runId: state.runId, status: logger.failed ? 'failed' : 'passed' });
  console.log(`\nLogs: ${directory}\nSummary: ${JSON.stringify(summary)}`);
  if (logger.failed) process.exitCode = 1;
}

try { if (command === 'prepare') await prepare(); else if (command === 'run') await run(); else usage(); }
catch (error) { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; }
