import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { db } from '../db/client';
import { users } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import type { AppBindings, AuthUser, Role } from '../types';

/**
 * Provider boundary. Replace this function with a provider SDK/JWKS verifier once
 * Auth0, Clerk, Firebase Auth, Supabase Auth, etc. is selected. The rest of the
 * API only consumes the normalized local Medly user.
 */
async function verifiedProviderSubject(_token: string, _env: Env): Promise<string | null> {
  return null;
}

async function resolveUser(token: string, env: Env): Promise<AuthUser | null> {
  const devAuthEnabled = env.DEV_AUTH_ENABLED;
  if (devAuthEnabled === 'true' && token.startsWith('dev:')) {
    const user = await db(env.DB).query.users.findFirst({ where: eq(users.id, token.slice(4)) });
    return user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null;
  }
  const subject = await verifiedProviderSubject(token, env);
  if (!subject) return null;
  const user = await db(env.DB).query.users.findFirst({ where: eq(users.externalSubject, subject) });
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

export const requireAdmin = requireRole('ADMIN');
