import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      bindings: { DEV_AUTH_ENABLED: 'true' },
    },
  })],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
