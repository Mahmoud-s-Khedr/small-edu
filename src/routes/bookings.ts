import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { bookingRequests, moduleAccess, modules } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { pagination, paginationQuery } from '../lib/pagination';
import { bookingIdParam } from '../lib/validation';
import { putPrivateObject } from '../lib/storage';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

const createBooking = z.object({ moduleId: z.string().uuid(), receiptKey: z.string().min(1).max(500) });
const statusBody = z.object({ status: z.enum(['ACCEPTED', 'REJECTED']) });

export const bookingRoutes = new Hono<AppBindings>();
bookingRoutes.use('*', requireAuth);

bookingRoutes.post('/receipt', async (c) => {
  const upload = await putPrivateObject(c.env.STORAGE, c.req.raw, 'payment-receipt', c.get('user').id);
  return c.json({ data: upload }, 201);
});

bookingRoutes.post('/', async (c) => {
  const { moduleId, receiptKey } = createBooking.parse(await c.req.json());
  const user = c.get('user');
  const database = db(c.env.DB);
  if (!await database.query.modules.findFirst({ where: eq(modules.id, moduleId) })) throw notFound('Module not found');
  if (!receiptKey.startsWith(`payment-receipts/${user.id}/`)) throw conflict('Receipt does not belong to the authenticated user');
  const receipt = await c.env.STORAGE.head(receiptKey);
  if (!receipt) throw notFound('Receipt upload not found');
  const now = new Date();
  const item = {
    id: crypto.randomUUID(), userId: user.id, moduleId, receiptKey,
    receiptFilename: receiptKey.split('/').at(-1)?.replace(/^[^-]+-/, '') ?? 'receipt',
    receiptContentType: receipt.httpMetadata?.contentType ?? 'application/octet-stream',
    receiptSizeBytes: receipt.size, status: 'PENDING' as const, createdAt: now, updatedAt: now,
  };
  try {
    await database.insert(bookingRequests).values(item);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) throw conflict('An active booking already exists for this module');
    throw error;
  }
  const { receiptKey: _receiptKey, ...response } = item;
  return c.json({ data: response }, 201);
});

bookingRoutes.get('/', async (c) => {
  const user = c.get('user');
  const items = await db(c.env.DB).select().from(bookingRequests).where(eq(bookingRequests.userId, user.id)).orderBy(desc(bookingRequests.createdAt));
  return c.json({ data: items.map(({ receiptKey: _receiptKey, ...item }) => item) });
});

export const adminBookingRoutes = new Hono<AppBindings>();
adminBookingRoutes.use('*', requireAuth, requireAdmin);
adminBookingRoutes.get('/', async (c) => {
  const query = paginationQuery.extend({ status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional() }).parse(c.req.query());
  const p = pagination(query);
  const items = await db(c.env.DB).select().from(bookingRequests)
    .where(query.status ? eq(bookingRequests.status, query.status) : undefined)
    .orderBy(desc(bookingRequests.createdAt)).limit(p.limit).offset(p.offset);
  return c.json({ data: items.map(({ receiptKey: _receiptKey, ...item }) => item), meta: p });
});

adminBookingRoutes.get('/:bookingId/receipt', async (c) => {
  const { bookingId } = bookingIdParam.parse(c.req.param());
  const booking = await db(c.env.DB).query.bookingRequests.findFirst({ where: eq(bookingRequests.id, bookingId) });
  if (!booking) throw notFound('Booking request not found');
  const object = await c.env.STORAGE.get(booking.receiptKey);
  if (!object || !('body' in object)) throw notFound('Stored receipt not found');
  const headers = new Headers({
    'Content-Type': booking.receiptContentType,
    'Content-Disposition': `attachment; filename="${booking.receiptFilename.replaceAll('"', '')}"`,
  });
  object.writeHttpMetadata(headers);
  return new Response(object.body, { headers });
});

adminBookingRoutes.patch('/:bookingId', async (c) => {
  const { bookingId } = bookingIdParam.parse(c.req.param());
  const { status } = statusBody.parse(await c.req.json());
  const database = db(c.env.DB);
  const updatedAt = new Date();
  const [booking] = await database.update(bookingRequests).set({ status, updatedAt })
    .where(and(eq(bookingRequests.id, bookingId), eq(bookingRequests.status, 'PENDING')))
    .returning();
  if (!booking) {
    const existing = await database.query.bookingRequests.findFirst({ where: eq(bookingRequests.id, bookingId) });
    if (!existing) throw notFound('Booking request not found');
    throw conflict('Only pending booking requests can be decided');
  }
  if (status === 'ACCEPTED') {
    await database.insert(moduleAccess).values({ userId: booking.userId, moduleId: booking.moduleId, grantedAt: updatedAt }).onConflictDoNothing();
  }
  const { receiptKey: _receiptKey, ...response } = booking;
  return c.json({ data: response });
});
