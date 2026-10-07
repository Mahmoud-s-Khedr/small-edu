import { and, eq, isNull } from 'drizzle-orm';
import { ApiRouter } from '../openapi';
import { db } from '../db/client';
import { users } from '../db/schema';
import { profileUpdateInput } from '../lib/validation';
import { requestAccountDeletion, processAccountDeletion } from '../lib/account-deletion';
import { unauthorized } from '../lib/errors';
import { verifyFirebaseIdToken, requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

export const meRoutes = new ApiRouter<AppBindings>('/me');
// DELETE verifies Firebase directly so an accepted/completed request can be retried
// after the local account is blocked or removed.
meRoutes.use('*', (c, next) => c.req.method === 'DELETE' ? next() : requireAuth(c, next));
meRoutes.delete('/', async (c) => {
  const value = c.req.header('Authorization');
  if (!value?.startsWith('Bearer ')) throw unauthorized();
  const identity = await verifyFirebaseIdToken(value.slice(7), c.env);
  if (!identity) throw unauthorized('Invalid or expired Firebase ID token');
  const job = await requestAccountDeletion(c.env, identity);
  if (!job.completed_at) c.executionCtx.waitUntil(processAccountDeletion(c.env, identity.subject));
  return c.json({ data: { status: job.completed_at ? 'completed' as const : 'pending' as const } }, 202);
});
meRoutes.get('/', (c) => c.json({ data: c.get('user') }));
meRoutes.patch('/', async (c) => {
  const { name } = profileUpdateInput.parse(await c.req.json());
  const currentUser = c.get('user');
  const updated = await db(c.env.DB).update(users)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(users.id, currentUser.id), isNull(users.deletionRequestedAt))).returning({ id: users.id });
  if (!updated.length) throw unauthorized('This account is being deleted');
  return c.json({ data: { ...currentUser, name } });
});
