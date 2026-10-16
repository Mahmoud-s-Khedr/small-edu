import { z } from 'zod';
import { ApiRouter } from '../openapi';
import { DEVICE_RESTRICTION_ENABLED, deviceRestrictionEnabled } from '../lib/settings';
import { requireAuth, requireAdmin } from '../middleware/auth';
import type { AppBindings } from '../types';

export const adminSettingsRoutes = new ApiRouter<AppBindings>('/admin/settings');
adminSettingsRoutes.use('*', requireAuth, requireAdmin);

adminSettingsRoutes.get('/device-restriction', async (c) =>
  c.json({ data: { DEVICE_RESTRICTION_ENABLED: await deviceRestrictionEnabled(c.env) } }));

adminSettingsRoutes.patch('/device-restriction', async (c) => {
  const { DEVICE_RESTRICTION_ENABLED: enabled } = z.object({ DEVICE_RESTRICTION_ENABLED: z.boolean() }).strict().parse(await c.req.json());
  await c.env.DB.prepare(`INSERT INTO app_settings (key, enabled, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`)
    .bind(DEVICE_RESTRICTION_ENABLED, enabled ? 1 : 0, Date.now()).run();
  console.info(JSON.stringify({ action: 'device_restriction_updated', actorId: c.get('user').id, enabled }));
  return c.json({ data: { DEVICE_RESTRICTION_ENABLED: enabled } });
});
