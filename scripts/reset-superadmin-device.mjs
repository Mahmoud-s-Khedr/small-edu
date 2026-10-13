import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const userId = args[args.indexOf('--user-id') + 1];
const target = args.includes('--remote') ? '--remote' : '--local';
if (!args.includes('--user-id') || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId ?? '') ||
    args.includes('--remote') === args.includes('--local')) {
  console.error('Usage: npm run recover:superadmin -- --user-id <UUID> --local|--remote');
  process.exit(1);
}
const now = Date.now();
const sql = `UPDATE users SET device = NULL, device_released_at = MAX(COALESCE(device_released_at, 0), ${now}), updated_at = ${now}
WHERE id = '${userId}' AND role = 'SUPER_ADMIN' AND deletion_requested_at IS NULL RETURNING id`;
const result = spawnSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', 'medly-db', target, '--command', sql], { stdio: 'inherit' });
console.info(JSON.stringify({ action: 'superadmin_device_recovery', userId, target, at: new Date(now).toISOString(), exitCode: result.status }));
process.exit(result.status ?? 1);
