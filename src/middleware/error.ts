import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';
import { routePath } from 'hono/route';
import { ApiError } from '../lib/errors';
import type { AppBindings } from '../types';

const errorNames = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'DrizzleQueryError']);
const safeErrorName = (error: Error): string => errorNames.has(error.name) ? error.name : 'Error';

function errorLocations(error: Error): string[] {
  // Keep source locations only: messages, function names and full paths can
  // contain request data or SQL parameters, including tokens and device IDs.
  return (error.stack ?? '').split('\n').slice(1).flatMap((line) => {
    if (!/^\s+at\s/.test(line)) return [];
    const location = line.match(/\b([A-Za-z_$][\w$.-]*\.(?:[cm]?js|tsx?)):(\d+):(\d+)\)?$/);
    return location ? [`${location[1]}:${location[2]}:${location[3]}`] : [];
  }).slice(0, 10);
}

export const errorHandler: ErrorHandler<AppBindings> = (error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status as 400 | 401 | 403 | 404 | 409 | 422 | 503);
  }
  if (error instanceof ZodError) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.flatten() } }, 422);
  }
  console.error(JSON.stringify({
    event: 'unhandled_api_error', method: c.req.method, route: routePath(c),
    errorType: safeErrorName(error), locations: errorLocations(error),
    ...(error.cause instanceof Error ? { causeType: safeErrorName(error.cause), causeLocations: errorLocations(error.cause) } : {}),
  }));
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }, 500);
};
