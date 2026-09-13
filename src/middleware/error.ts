import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';
import { ApiError } from '../lib/errors';
import type { AppBindings } from '../types';

export const errorHandler: ErrorHandler<AppBindings> = (error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status as 400 | 401 | 403 | 404 | 409);
  }
  if (error instanceof ZodError) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.flatten() } }, 422);
  }
  console.error('Unhandled API error', error);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }, 500);
};
