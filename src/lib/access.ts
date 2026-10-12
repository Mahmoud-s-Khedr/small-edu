import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { bookingRequests, moduleAccess, modules } from '../db/schema';
import { forbidden } from './errors';
import type { AppBindings, AuthUser } from '../types';

export type ModuleAccessStatus = 'default' | 'full_access' | 'pending' | 'approved';

/** Add the current user's access status without issuing a query per module. */
export async function withModuleAccessStatus<T extends { id: string; priceCents: number }>(
  env: Env,
  user: AuthUser,
  items: T[],
): Promise<Array<T & { access_status: ModuleAccessStatus }>> {
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
    return items.map((module) => ({ ...module, access_status: 'full_access' }));
  }

  const paidModuleIds = [...new Set(items.filter((module) => module.priceCents > 0).map((module) => module.id))];
  const database = db(env.DB);
  const [access, pending] = paidModuleIds.length ? await Promise.all([
    database.select({ moduleId: moduleAccess.moduleId }).from(moduleAccess)
      .where(and(eq(moduleAccess.userId, user.id), inArray(moduleAccess.moduleId, paidModuleIds))),
    database.select({ moduleId: bookingRequests.moduleId }).from(bookingRequests)
      .where(and(eq(bookingRequests.userId, user.id), eq(bookingRequests.status, 'PENDING'),
        inArray(bookingRequests.moduleId, paidModuleIds))),
  ]) : [[], []];
  const approvedIds = new Set(access.map((row) => row.moduleId));
  const pendingIds = new Set(pending.map((row) => row.moduleId));
  return items.map((module) => ({
    ...module,
    access_status: module.priceCents === 0 || approvedIds.has(module.id) ? 'approved'
      : pendingIds.has(module.id) ? 'pending' : 'default',
  }));
}

export async function requireModuleVideoAccess(env: Env, user: AuthUser, moduleId: string): Promise<void> {
  if (await hasModuleVideoAccess(env, user, moduleId)) return;
  throw forbidden('This module video requires accepted module access');
}

export async function hasModuleVideoAccess(env: Env, user: AuthUser, moduleId: string): Promise<boolean> {
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return true;
  const database = db(env.DB);
  const [module, access] = await Promise.all([
    database.query.modules.findFirst({
      columns: { priceCents: true },
      where: eq(modules.id, moduleId),
    }),
    database.query.moduleAccess.findFirst({
      where: and(eq(moduleAccess.userId, user.id), eq(moduleAccess.moduleId, moduleId)),
    }),
  ]);
  // A zero-priced module is freely available to every authenticated user; a
  // paid module still requires an accepted booking (or an administrator).
  return module?.priceCents === 0 || !!access;
}

export type AppContext = { Bindings: AppBindings['Bindings']; Variables: AppBindings['Variables'] };
