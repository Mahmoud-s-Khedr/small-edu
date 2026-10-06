import { eq } from 'drizzle-orm';
import { ApiRouter } from '../openapi';
import { db } from '../db/client';
import { users } from '../db/schema';
import { profileUpdateInput } from '../lib/validation';
import { requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

export const meRoutes = new ApiRouter<AppBindings>('/me');
meRoutes.use('*', requireAuth);
meRoutes.get('/', (c) => c.json({ data: c.get('user') }));
meRoutes.patch('/', async (c) => {
  const { name } = profileUpdateInput.parse(await c.req.json());
  const currentUser = c.get('user');
  await db(c.env.DB).update(users)
    .set({ name, updatedAt: new Date() })
    .where(eq(users.id, currentUser.id));
  return c.json({ data: { ...currentUser, name } });
});
