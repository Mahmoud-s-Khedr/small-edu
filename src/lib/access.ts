import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { moduleAccess } from '../db/schema';
import { forbidden } from './errors';
import type { AppBindings, AuthUser } from '../types';

export async function requireModuleVideoAccess(env: Env, user: AuthUser, moduleId: string): Promise<void> {
  if (user.role === 'ADMIN') return;
  const access = await db(env.DB).query.moduleAccess.findFirst({
    where: and(eq(moduleAccess.userId, user.id), eq(moduleAccess.moduleId, moduleId)),
  });
  if (!access) throw forbidden('This module video requires accepted module access');
}

export type AppContext = { Bindings: AppBindings['Bindings']; Variables: AppBindings['Variables'] };
