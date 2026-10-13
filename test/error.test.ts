import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/error';
import type { AppBindings } from '../src/types';

describe('unexpected error diagnostics', () => {
  it('retains source locations and request context without logging sensitive error or request data', async () => {
    const device = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const token = 'private-bearer-token';
    const cause = new TypeError(`Database parameters: ${device}, ${token}`);
    cause.stack = `TypeError: ${cause.message}\n    at database (/private/db.ts:12:4)`;
    const error = new Error(`Failed query: ${device}, ${token}`, { cause });
    error.name = 'DrizzleQueryError';
    error.stack = `DrizzleQueryError: ${error.message}\n    at ${token} (/private/users.ts:23:8)`;
    const app = new Hono<AppBindings>();
    app.onError(errorHandler);
    app.get('/users/:userId', () => { throw error; });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await app.request(`/users/${device}?token=${token}`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Device-ID': device },
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
      expect(log).toHaveBeenCalledOnce();
      const logged = String(log.mock.calls[0]?.[0]);
      expect(JSON.parse(logged)).toMatchObject({
        event: 'unhandled_api_error', method: 'GET', route: '/users/:userId',
        errorType: 'DrizzleQueryError', locations: ['users.ts:23:8'],
        causeType: 'TypeError', causeLocations: ['db.ts:12:4'],
      });
      for (const sensitive of [device, token, '/private/', 'Failed query', 'Database parameters']) {
        expect(logged).not.toContain(sensitive);
      }
    } finally {
      log.mockRestore();
    }
  });
});
