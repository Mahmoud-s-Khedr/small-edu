import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      bindings: {
        FIREBASE_PROJECT_ID: 'medly-test', CORS_ORIGINS: '*', R2_ACCOUNT_ID: 'test-account',
        R2_S3_ACCESS_KEY_ID: 'test-access-key', R2_S3_SECRET_ACCESS_KEY: 'test-secret-key', R2_BUCKET_NAME: 'medly-storage',
      },
    },
  })],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
