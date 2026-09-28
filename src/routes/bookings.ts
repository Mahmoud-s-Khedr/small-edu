import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { bookingRequests, modules } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { pagination, paginationQuery } from '../lib/pagination';
import { bookingIdParam } from '../lib/validation';
import { putPrivateObject } from '../lib/storage';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

const createBooking = z.object({ moduleId: z.string().uuid(), receiptKey: z.string().min(1).max(500) });
const receiptKeyInput = z.object({ receiptKey: z.string().min(1).max(500) });
const statusBody = z.object({ status: z.enum(['ACCEPTED', 'REJECTED']) });
const RECEIPT_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1_000;

/** Removes abandoned uploads while retaining receipts referenced by any booking. */
export async function cleanupExpiredUnsubmittedReceipts(env: Env): Promise<void> {
  const database = db(env.DB);
  const linkedKeys = new Set((await database.select({ receiptKey: bookingRequests.receiptKey }).from(bookingRequests))
    .map((booking) => booking.receiptKey));
  const cutoff = Date.now() - RECEIPT_UPLOAD_GRACE_MS;
  let cursor: string | undefined;
  do {
    const listed = await env.STORAGE.list({ prefix: 'payment-receipts/', cursor, limit: 1_000 });
    const staleKeys = listed.objects
      .filter((object) => object.uploaded.getTime() < cutoff && !linkedKeys.has(object.key))
      .map((object) => object.key);
    if (staleKeys.length) await env.STORAGE.delete(staleKeys);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

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

bookingRoutes.delete('/receipt', async (c) => {
  const { receiptKey } = receiptKeyInput.parse(await c.req.json());
  const user = c.get('user');
  if (!receiptKey.startsWith(`payment-receipts/${user.id}/`)) throw conflict('Receipt does not belong to the authenticated user');
  const database = db(c.env.DB);
  if (await database.query.bookingRequests.findFirst({ where: eq(bookingRequests.receiptKey, receiptKey) })) {
    throw conflict('A submitted receipt cannot be deleted');
  }
  await c.env.STORAGE.delete(receiptKey);
  return c.body(null, 204);
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
  // Changing the payment decision and granting access are one business
  // operation. D1 batch() is an atomic transaction, so a failed access insert
  // cannot leave an accepted booking without its entitlement.
  const [decision] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE booking_requests SET status = ?, updated_at = ? WHERE id = ? AND status = \'PENDING\'')
      .bind(status, updatedAt.getTime(), bookingId),
    c.env.DB.prepare(`INSERT INTO module_access (user_id, module_id, granted_at)
      SELECT user_id, module_id, ? FROM booking_requests
      WHERE id = ? AND status = 'ACCEPTED' AND ? = 'ACCEPTED'
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
