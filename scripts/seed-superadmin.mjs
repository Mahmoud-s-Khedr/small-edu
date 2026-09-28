import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const emailIndex = args.indexOf('--email');
const email = emailIndex >= 0 ? args[emailIndex + 1]?.trim() : undefined;
const target = args.includes('--remote') ? '--remote' : args.includes('--local') ? '--local' : undefined;

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !target || args.includes('--remote') === args.includes('--local')) {
  console.error('Usage: npm run seed:superadmin -- --email owner@example.com --local|--remote');
  process.exit(1);
}

const now = Date.now();
const quotedEmail = email.replaceAll("'", "''");
const sql = `INSERT INTO users (id, email, name, role, created_at, updated_at)
VALUES ('${randomUUID()}', '${quotedEmail}', 'Super Admin', 'SUPER_ADMIN', ${now}, ${now})
ON CONFLICT(email) DO UPDATE SET role = 'SUPER_ADMIN', updated_at = ${now}`;
const result = spawnSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', 'medly-db', target, '--command', sql], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
