import { ApiError, conflict, unauthorized } from './errors';

export function deviceId(value: string | undefined): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'X-Device-ID must contain a UUID v4');
  }
  return value.toLowerCase();
}

export function checkDevice(stored: string | null, presented: string): void {
  if (!stored) throw new ApiError(401, 'DEVICE_NOT_REGISTERED', 'Register this device through /auth/session');
  if (stored !== presented) throw new ApiError(401, 'DEVICE_MISMATCH', 'Another device is registered to this account');
}

export async function registerDevice(env: Env, userId: string, presented: string, authTime: number): Promise<void> {
  // The release predicate is checked in the same statement that claims the device.
  const accepted = await env.DB.prepare(`UPDATE users SET device = ?, updated_at = ?
    WHERE id = ? AND deletion_requested_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs WHERE firebase_uid = users.external_subject)
      AND (device = ? OR (device IS NULL AND (device_released_at IS NULL OR ? > device_released_at)))
    RETURNING id`).bind(presented, Date.now(), userId, presented, authTime * 1000).first();
  if (accepted) return;
  const user = await env.DB.prepare('SELECT device, device_released_at, deletion_requested_at FROM users WHERE id = ?')
    .bind(userId).first<{ device: string | null; device_released_at: number | null; deletion_requested_at: number | null }>();
  if (!user || user.deletion_requested_at !== null) throw conflict('This account is being deleted');
  if (user.device) checkDevice(user.device, presented);
  if (user.device_released_at !== null && authTime * 1000 <= user.device_released_at) {
    throw new ApiError(401, 'REAUTHENTICATION_REQUIRED', 'Sign in again before registering a device');
  }
  throw unauthorized('Device registration changed; try again');
}

export async function hashDevice(presented: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(presented));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The matching predicate also protects a logout delayed after authentication. */
export async function releaseDevice(env: Env, userId: string, presented: string): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(`UPDATE users SET device = NULL,
    device_released_at = MAX(COALESCE(device_released_at, 0), ?), updated_at = ?
    WHERE id = ? AND device = ? AND deletion_requested_at IS NULL`)
    .bind(now, now, userId, presented).run();
}
