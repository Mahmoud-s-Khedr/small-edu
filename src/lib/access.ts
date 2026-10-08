import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { moduleAccess, modules } from '../db/schema';
import { forbidden } from './errors';
import type { AppBindings, AuthUser } from '../types';

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
