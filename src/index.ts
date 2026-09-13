import { cors } from 'hono/cors';
import { Hono } from 'hono';
import { adminBookingRoutes, bookingRoutes } from './routes/bookings';
import { flashcardRoutes } from './routes/flashcards';
import { healthRoutes } from './routes/health';
import { lectureRoutes } from './routes/lectures';
import { mcqRoutes } from './routes/mcqs';
import { meRoutes } from './routes/me';
import { moduleRoutes } from './routes/modules';
import { errorHandler } from './middleware/error';
import type { AppBindings } from './types';

const app = new Hono<AppBindings>();
app.use('*', async (c, next) => {
  const origins = c.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
  return cors({ origin: (origin) => origins.includes(origin) ? origin : '', credentials: true })(c, next);
});
app.onError(errorHandler);
app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

const api = new Hono<AppBindings>();
api.route('/health', healthRoutes);
api.route('/me', meRoutes);
api.route('/modules', moduleRoutes);
api.route('/lectures', lectureRoutes);
api.route('/', flashcardRoutes);
api.route('/', mcqRoutes);
api.route('/bookings', bookingRoutes);
api.route('/admin/bookings', adminBookingRoutes);
app.route('/api/v1', api);

export default app;
