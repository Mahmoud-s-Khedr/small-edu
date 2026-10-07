import type { FirebaseIdentity } from '../middleware/auth';
import { ApiError, unauthorized } from './errors';
import { deleteFirebaseUser, requireFirebaseDeletionConfig } from './firebase-admin';

const RECENT_SIGN_IN_SECONDS = 300;
const TOMBSTONE_MS = 65 * 60 * 1_000;
const LEASE_MS = 5 * 60 * 1_000;

type DeletionJob = {
  firebase_uid: string;
  user_id: string;
  requested_at: number;
  firebase_deleted_at: number | null;
  completed_at: number | null;
  attempts: number;
  next_attempt_at: number;
};

export async function requestAccountDeletion(env: Env, identity: FirebaseIdentity): Promise<DeletionJob> {
  const existing = await env.DB.prepare('SELECT * FROM account_deletion_jobs WHERE firebase_uid = ?')
    .bind(identity.subject).first<DeletionJob>();
  // Retries only acknowledge the same UID's already accepted request.
  if (existing) return existing;
  if (Math.floor(Date.now() / 1_000) - identity.authTime > RECENT_SIGN_IN_SECONDS) {
    throw new ApiError(401, 'REAUTHENTICATION_REQUIRED', 'Sign in again before deleting your account');
  }
  requireFirebaseDeletionConfig(env);
  const now = Date.now();
  // Atomic acceptance: no marked account without a durable retry record.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO account_deletion_jobs (firebase_uid, user_id, requested_at, next_attempt_at)
      SELECT external_subject, id, ?, ? FROM users WHERE external_subject = ?
      ON CONFLICT(firebase_uid) DO NOTHING`).bind(now, now, identity.subject),
    env.DB.prepare(`UPDATE users SET deletion_requested_at = COALESCE(deletion_requested_at, ?), updated_at = ?
      WHERE external_subject = ? AND EXISTS (SELECT 1 FROM account_deletion_jobs WHERE firebase_uid = ?)`)
      .bind(now, now, identity.subject, identity.subject),
  ]);
  const job = await env.DB.prepare('SELECT * FROM account_deletion_jobs WHERE firebase_uid = ?')
    .bind(identity.subject).first<DeletionJob>();
  if (!job) throw unauthorized('No local account is linked to this Firebase identity');
  return job;
}

export async function processAccountDeletion(env: Env, uid: string): Promise<void> {
  const now = Date.now();
  // A short durable lease prevents concurrent fetch/cron retries doing the same work.
  const job = await env.DB.prepare(`UPDATE account_deletion_jobs
    SET attempts = attempts + 1, next_attempt_at = ?
    WHERE firebase_uid = ? AND completed_at IS NULL AND next_attempt_at <= ? RETURNING *`)
    .bind(now + LEASE_MS, uid, now).first<DeletionJob>();
  if (!job) return;
  let stage = 'FIREBASE_DELETE_FAILED';
  try {
    if (!job.firebase_deleted_at) {
      await deleteFirebaseUser(env, uid);
      await env.DB.prepare('UPDATE account_deletion_jobs SET firebase_deleted_at = ? WHERE firebase_uid = ?')
        .bind(Date.now(), uid).run();
    }
    stage = 'LOCAL_DELETE_FAILED';
    // R2 is intentionally untouched. Bookings survive with user_id = NULL;
    // module_access and user_flashcard_state cascade. Shared content survives.
    const [, completed] = await env.DB.batch([
      env.DB.prepare('DELETE FROM users WHERE id = ? AND external_subject = ? AND deletion_requested_at IS NOT NULL')
        .bind(job.user_id, uid),
      env.DB.prepare(`UPDATE account_deletion_jobs SET completed_at = ?, last_error = NULL
        WHERE firebase_uid = ? AND NOT EXISTS (SELECT 1 FROM users WHERE id = ?)`)
        .bind(Date.now(), uid, job.user_id),
    ]);
    if (!completed?.meta.changes) throw new Error('LOCAL_DELETE_FAILED');
  } catch {
    const backoff = Math.min(6 * 60 * 60 * 1_000, LEASE_MS * 2 ** Math.min(job.attempts - 1, 7));
    await env.DB.prepare(`UPDATE account_deletion_jobs SET last_error = ?, next_attempt_at = ?
      WHERE firebase_uid = ? AND completed_at IS NULL`).bind(stage, Date.now() + backoff, uid).run();
  }
}

export async function retryAccountDeletions(env: Env): Promise<void> {
  const now = Date.now();
  const jobs = await env.DB.prepare(`SELECT firebase_uid FROM account_deletion_jobs
    WHERE completed_at IS NULL AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 10`)
    .bind(now).all<{ firebase_uid: string }>();
  const results = await Promise.allSettled(jobs.results.map((job) => processAccountDeletion(env, job.firebase_uid)));
  // Retain the old UID until every pre-deletion Firebase ID token has expired.
  // New registrations have a different UID and are never blocked by email.
  await env.DB.prepare('DELETE FROM account_deletion_jobs WHERE completed_at IS NOT NULL AND completed_at < ?')
    .bind(now - TOMBSTONE_MS).run();
  if (results.some((result) => result.status === 'rejected')) throw new Error('Account deletion retry storage failure');
}
