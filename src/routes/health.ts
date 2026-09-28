import { ApiRouter } from '../openapi';
import type { AppBindings } from '../types';

export const healthRoutes = new ApiRouter<AppBindings>('/health').get('/', (c) => c.json({ data: { status: 'ok' } }));
