export const DEVICE_RESTRICTION_ENABLED = 'DEVICE_RESTRICTION_ENABLED';

export async function deviceRestrictionEnabled(env: Env): Promise<boolean> {
  const setting = await env.DB.prepare('SELECT enabled FROM app_settings WHERE key = ?')
    .bind(DEVICE_RESTRICTION_ENABLED).first<{ enabled: number }>();
  return setting?.enabled === 1;
}
