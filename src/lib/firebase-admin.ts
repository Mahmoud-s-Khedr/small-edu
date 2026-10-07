import { importPKCS8, SignJWT } from 'jose';
import { serviceUnavailable } from './errors';

export function requireFirebaseDeletionConfig(env: Env): void {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw serviceUnavailable('Firebase account deletion is not configured');
  }
}

/** REST works in Workers without bringing the Node Firebase Admin SDK. */
export async function deleteFirebaseUser(env: Env, uid: string): Promise<void> {
  requireFirebaseDeletionConfig(env);
  const key = await importPKCS8(env.FIREBASE_PRIVATE_KEY!.replaceAll('\\n', '\n'), 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/identitytoolkit' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(env.FIREBASE_CLIENT_EMAIL!)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt().setExpirationTime('5m').sign(key);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error('FIREBASE_TOKEN_FAILED');
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) throw new Error('FIREBASE_TOKEN_FAILED');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID!)}/accounts:delete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.ok) return;
  const error = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  // A retry after successful remote deletion must still complete local cleanup.
  if (error?.error?.message === 'USER_NOT_FOUND') return;
  // Never propagate provider responses, access tokens, or credentials into jobs/logs.
  throw new Error('FIREBASE_DELETE_FAILED');
}
