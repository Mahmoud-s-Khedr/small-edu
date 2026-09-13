import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

export const meRoutes = new Hono<AppBindings>();
meRoutes.use('*', requireAuth);
meRoutes.get('/', (c) => c.json({ data: c.get('user') }));
