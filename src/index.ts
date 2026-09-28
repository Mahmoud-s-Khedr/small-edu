import { cors } from 'hono/cors';
import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { adminBookingRoutes, bookingRoutes, cleanupExpiredUnsubmittedReceipts } from './routes/bookings';
import { authRoutes } from './routes/auth';
import { flashcardRoutes } from './routes/flashcards';
import { healthRoutes } from './routes/health';
import { lectureRoutes } from './routes/lectures';
import { mcqRoutes } from './routes/mcqs';
import { meRoutes } from './routes/me';
import { moduleRoutes } from './routes/modules';
import { adminUserRoutes } from './routes/users';
import { errorHandler } from './middleware/error';
import type { AppBindings } from './types';

const app = new OpenAPIHono<AppBindings>();
app.use('*', async (c, next) => {
  const origins = c.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
  return cors({ origin: (origin) => origins.includes('*') || origins.includes(origin) ? origin : '', credentials: true })(c, next);
});
app.onError(errorHandler);
app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

const api = new OpenAPIHono<AppBindings>();
api.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http', scheme: 'bearer', bearerFormat: 'Firebase ID token',
});
api.doc31('/openapi', {
  openapi: '3.1.0',
  info: { title: 'Medly API', version: '1.0.0', description: 'Medly’s authenticated education API.' },
  servers: [{ url: '/api/v1', description: 'Current deployment' }],
});
app.get('/api/v1/docs', swaggerUI({ url: '/api/v1/openapi' }));
api.route('/health', healthRoutes);
api.route('/auth', authRoutes);
api.route('/me', meRoutes);
api.route('/modules', moduleRoutes);
api.route('/lectures', lectureRoutes);
api.route('/', flashcardRoutes);
api.route('/', mcqRoutes);
api.route('/bookings', bookingRoutes);
api.route('/admin/bookings', adminBookingRoutes);
api.route('/admin/users', adminUserRoutes);
app.route('/api/v1', api);

export default {
  fetch: app.fetch,
  scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanupExpiredUnsubmittedReceipts(env));
  },
} satisfies ExportedHandler<Env>;
