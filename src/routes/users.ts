import { count, desc, eq } from 'drizzle-orm';
import { ApiRouter } from '../openapi';
import { z } from 'zod';
import { db } from '../db/client';
import { users } from '../db/schema';
import { conflict, forbidden, notFound } from '../lib/errors';
import { pagination, paginationQuery } from '../lib/pagination';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth';
import type { AppBindings } from '../types';

const userIdParam = z.object({ userId: z.string().uuid() });
// Super-admin creation stays a deployment-time operation. This endpoint can
// only grant or revoke the operational ADMIN role.
const roleInput = z.object({ role: z.enum(['USER', 'ADMIN']) });

export const adminUserRoutes = new ApiRouter<AppBindings>('/admin/users');
adminUserRoutes.use('*', requireAuth, requireAdmin);

adminUserRoutes.get('/', requireSuperAdmin, async (c) => {
  const p = pagination(paginationQuery.parse(c.req.query()));
  const database = db(c.env.DB);
  const [items, totalRow] = await Promise.all([
    database.select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    }).from(users).orderBy(desc(users.createdAt), desc(users.id)).limit(p.limit).offset(p.offset),
    database.select({ total: count() }).from(users).get(),
  ]);
  return c.json({ data: items, meta: { ...p, total: totalRow?.total ?? 0 } });
});

adminUserRoutes.patch('/:userId/role', requireSuperAdmin, async (c) => {
  const { userId } = userIdParam.parse(c.req.param());
  const { role } = roleInput.parse(await c.req.json());
  const database = db(c.env.DB);
  const user = await database.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw notFound('User not found');
  if (user.role === 'SUPER_ADMIN') throw conflict('The super-admin role is managed by the seeder');

  const updatedAt = new Date();
  await database.update(users).set({ role, updatedAt, ...(role !== user.role ? { device: null, deviceReleasedAt: updatedAt } : {}) }).where(eq(users.id, userId));
  return c.json({ data: { id: user.id, email: user.email, name: user.name, role, createdAt: user.createdAt, updatedAt } });
});

adminUserRoutes.post('/:userId/reset-device', async (c) => {
  const { userId } = userIdParam.parse(c.req.param());
  const actor = c.get('user');
  const updated = await c.env.DB.prepare(`UPDATE users SET device = NULL,
    device_released_at = MAX(COALESCE(device_released_at, 0), ?), updated_at = ?
    WHERE id = ? AND deletion_requested_at IS NULL AND role = 'USER'
    RETURNING id`).bind(Date.now(), Date.now(), userId).first();
  if (!updated) {
    const target = await db(c.env.DB).query.users.findFirst({ where: eq(users.id, userId) });
    if (!target) throw notFound('User not found');
    if (target.deletionRequestedAt) throw conflict('This account is being deleted');
    throw forbidden('Only USER accounts have a device restriction');
  }
  console.info(JSON.stringify({ action: 'device_reset', actorId: actor.id, userId }));
  return c.body(null, 204);
});
