import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { moduleAccess } from '../db/schema';
import { forbidden } from './errors';
import type { AppBindings, AuthUser } from '../types';

export async function requireModuleVideoAccess(env: Env, user: AuthUser, moduleId: string): Promise<void> {
  if (await hasModuleVideoAccess(env, user, moduleId)) return;
  throw forbidden('This module video requires accepted module access');
}

export async function hasModuleVideoAccess(env: Env, user: AuthUser, moduleId: string): Promise<boolean> {
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return true;
  const access = await db(env.DB).query.moduleAccess.findFirst({
    where: and(eq(moduleAccess.userId, user.id), eq(moduleAccess.moduleId, moduleId)),
  });
  return !!access;
}

export type AppContext = { Bindings: AppBindings['Bindings']; Variables: AppBindings['Variables'] };
