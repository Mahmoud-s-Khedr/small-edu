import { eq } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { MiddlewareHandler } from 'hono';
import { db } from '../db/client';
import { users } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import type { AppBindings, AuthUser, Role } from '../types';

const FIREBASE_JWKS_URL = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
);

// This is deliberately module-scoped: jose caches Firebase's cacheable signing
// keys, rather than making a key request for every API call.
const firebaseJwks = createRemoteJWKSet(FIREBASE_JWKS_URL);

export type FirebaseIdentity = {
  subject: string;
  email: string;
  name?: string;
};

/**
 * Verifies the Firebase ID token issued by the project's securetoken issuer.
 * OAuth/Google sign-in itself happens in the client Firebase SDK; a Worker
 * never needs a Firebase service-account credential or a client API key.
 */
export async function verifyFirebaseIdToken(
  token: string,
  env: Env,
  keyResolver: JWTVerifyGetKey = firebaseJwks,
): Promise<FirebaseIdentity | null> {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) return null;

  try {
    const { payload } = await jwtVerify(token, keyResolver, {
      algorithms: ['RS256'],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
      requiredClaims: ['aud', 'auth_time', 'exp', 'iat', 'iss', 'sub'],
    });

    const nowSeconds = Math.floor(Date.now() / 1000);
    // jose checks expiry; explicitly reject a malformed or implausibly future
    // issuance time as well. A small clock-skew allowance matches Firebase's
    // normal distributed-client behaviour.
    if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > nowSeconds + 300) return null;
    if (typeof payload.auth_time !== 'number' || !Number.isFinite(payload.auth_time) || payload.auth_time > nowSeconds) return null;
    if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) return null;
    if (typeof payload.email !== 'string' || payload.email.trim().length === 0 || payload.email_verified !== true) return null;

    return {
      subject: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : undefined,
    };
  } catch {
    // JWT parsing, algorithm, signature, key, issuer, audience, and time
    // failures all intentionally look the same to callers.
    return null;
  }
}

export async function resolveUser(token: string, env: Env): Promise<AuthUser | null> {
  const identity = await verifyFirebaseIdToken(token, env);
  if (!identity) return null;
  const user = await db(env.DB).query.users.findFirst({ where: eq(users.externalSubject, identity.subject) });
  return user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null;
}

export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const value = c.req.header('Authorization');
  if (!value?.startsWith('Bearer ')) throw unauthorized();
  const user = await resolveUser(value.slice(7), c.env);
  if (!user) throw unauthorized('Invalid or expired authentication token');
  c.set('user', user);
  await next();
};

export const requireRole = (...roles: Role[]): MiddlewareHandler<AppBindings> => async (c, next) => {
  const user = c.get('user');
  if (!roles.includes(user.role)) throw forbidden();
  await next();
};

export const requireAdmin = requireRole('ADMIN', 'SUPER_ADMIN');
export const requireSuperAdmin = requireRole('SUPER_ADMIN');
