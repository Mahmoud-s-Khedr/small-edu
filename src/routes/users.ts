import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { users } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';
import type { AppBindings } from '../types';

const userIdParam = z.object({ userId: z.string().uuid() });
// Super-admin creation stays a deployment-time operation. This endpoint can
// only grant or revoke the operational ADMIN role.
const roleInput = z.object({ role: z.enum(['USER', 'ADMIN']) });

export const adminUserRoutes = new Hono<AppBindings>();
adminUserRoutes.use('*', requireAuth, requireSuperAdmin);

adminUserRoutes.get('/', async (c) => {
  const items = await db(c.env.DB).select({
    id: users.id,
    email: users.email,
    name: users.name,
    role: users.role,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
  }).from(users).orderBy(desc(users.createdAt));
  return c.json({ data: items });
});

adminUserRoutes.patch('/:userId/role', async (c) => {
  const { userId } = userIdParam.parse(c.req.param());
  const { role } = roleInput.parse(await c.req.json());
  const database = db(c.env.DB);
  const user = await database.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw notFound('User not found');
  if (user.role === 'SUPER_ADMIN') throw conflict('The super-admin role is managed by the seeder');

  const updatedAt = new Date();
  await database.update(users).set({ role, updatedAt }).where(eq(users.id, userId));
  return c.json({ data: { ...user, role, updatedAt } });
});
