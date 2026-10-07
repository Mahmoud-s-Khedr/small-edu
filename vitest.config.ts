import { generateKeyPairSync } from 'node:crypto';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Ephemeral test-only key: no Firebase credentials are committed or used in CI.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      bindings: {
        FIREBASE_PROJECT_ID: 'medly-test',
        FIREBASE_CLIENT_EMAIL: 'deletion-test@medly-test.iam.gserviceaccount.com',
        FIREBASE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        CORS_ORIGINS: '*', R2_ACCOUNT_ID: 'test-account',
        R2_S3_ACCESS_KEY_ID: 'test-access-key', R2_S3_SECRET_ACCESS_KEY: 'test-secret-key', R2_BUCKET_NAME: 'medly-storage',
      },
    },
  })],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
