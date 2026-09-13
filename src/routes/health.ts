import { Hono } from 'hono';
import type { AppBindings } from '../types';

export const healthRoutes = new Hono<AppBindings>().get('/', (c) => c.json({ data: { status: 'ok' } }));
