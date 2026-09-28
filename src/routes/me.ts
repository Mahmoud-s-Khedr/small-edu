import { ApiRouter } from '../openapi';
import { requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

export const meRoutes = new ApiRouter<AppBindings>('/me');
meRoutes.use('*', requireAuth);
meRoutes.get('/', (c) => c.json({ data: c.get('user') }));
