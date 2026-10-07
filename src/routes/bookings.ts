import { desc, eq } from 'drizzle-orm';
import { ApiRouter } from '../openapi';
import { z } from 'zod';
import { db } from '../db/client';
import { bookingRequests, modules } from '../db/schema';
import { conflict, notFound, unauthorized } from '../lib/errors';
import { pagination, paginationQuery } from '../lib/pagination';
import { bookingIdParam } from '../lib/validation';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

const createBooking = z.object({ moduleId: z.string().uuid(), receiptKey: z.string().min(1).max(500) });
const receiptKeyInput = z.object({ receiptKey: z.string().min(1).max(500) });
const statusBody = z.object({ status: z.enum(['ACCEPTED', 'REJECTED']) });
export const bookingRoutes = new ApiRouter<AppBindings>('/bookings');
bookingRoutes.use('*', requireAuth);

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
    const inserted = await c.env.DB.prepare(`INSERT INTO booking_requests
      (id, user_id, module_id, receipt_key, receipt_filename, receipt_content_type, receipt_size_bytes, status, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS
      (SELECT 1 FROM users WHERE id = ? AND deletion_requested_at IS NULL)`)
      .bind(item.id, user.id, moduleId, receiptKey, item.receiptFilename, item.receiptContentType,
        item.receiptSizeBytes, item.status, now.getTime(), now.getTime(), user.id).run();
    if (!inserted.meta.changes) throw unauthorized('This account is being deleted');
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) throw conflict('An active booking already exists for this module');
    throw error;
  }
  const { receiptKey: _receiptKey, ...response } = item;
  return c.json({ data: response }, 201);
});

bookingRoutes.delete('/receipt', async (c) => {
  const { receiptKey } = receiptKeyInput.parse(await c.req.json());
  const user = c.get('user');
  if (!receiptKey.startsWith(`payment-receipts/${user.id}/`)) throw conflict('Receipt does not belong to the authenticated user');
  throw conflict('Payment receipts are retained and cannot be deleted');
});

bookingRoutes.get('/', async (c) => {
  const user = c.get('user');
  const items = await db(c.env.DB).select().from(bookingRequests).where(eq(bookingRequests.userId, user.id)).orderBy(desc(bookingRequests.createdAt));
  return c.json({ data: items.map(({ receiptKey: _receiptKey, ...item }) => item) });
});

export const adminBookingRoutes = new ApiRouter<AppBindings>('/admin/bookings');
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
  // Changing the payment decision and granting access are one business
  // operation. D1 batch() is an atomic transaction, so a failed access insert
  // cannot leave an accepted booking without its entitlement.
  const [decision] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE booking_requests SET status = ?, updated_at = ? WHERE id = ? AND status = \'PENDING\'')
      .bind(status, updatedAt.getTime(), bookingId),
    c.env.DB.prepare(`INSERT INTO module_access (user_id, module_id, granted_at)
      SELECT user_id, module_id, ? FROM booking_requests
      WHERE id = ? AND status = 'ACCEPTED' AND ? = 'ACCEPTED'
        AND user_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM users WHERE users.id = booking_requests.user_id AND deletion_requested_at IS NULL)
      ON CONFLICT(user_id, module_id) DO NOTHING`)
      .bind(updatedAt.getTime(), bookingId, status),
  ]);
  if (!decision?.meta.changes) {
    const existing = await database.query.bookingRequests.findFirst({ where: eq(bookingRequests.id, bookingId) });
    if (!existing) throw notFound('Booking request not found');
    throw conflict('Only pending booking requests can be decided');
  }
  const booking = await database.query.bookingRequests.findFirst({ where: eq(bookingRequests.id, bookingId) });
  if (!booking) throw notFound('Booking request not found');
  const { receiptKey: _receiptKey, ...response } = booking;
  return c.json({ data: response });
});
