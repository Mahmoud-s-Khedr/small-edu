import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ApiRouter } from '../openapi';
import { db } from '../db/client';
import { lectureMaterials, lectures } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { createPresignedUpload, uploadDetails, verifyDirectUpload } from '../lib/presigned-uploads';
import { safeFilename } from '../lib/storage';
import { requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

const uploadRequest = z.discriminatedUnion('purpose', [
  uploadDetails.extend({ purpose: z.literal('lecture-material'), lectureId: z.string().uuid() }),
  uploadDetails.extend({ purpose: z.literal('flashcard-image'), lectureId: z.string().uuid() }),
  uploadDetails.extend({ purpose: z.literal('payment-receipt') }),
]);
const uploadCompletion = z.discriminatedUnion('purpose', [
  uploadDetails.extend({ purpose: z.literal('lecture-material'), lectureId: z.string().uuid(), objectKey: z.string().min(1).max(500) }),
  uploadDetails.extend({ purpose: z.literal('flashcard-image'), lectureId: z.string().uuid(), objectKey: z.string().min(1).max(500) }),
  uploadDetails.extend({ purpose: z.literal('payment-receipt'), objectKey: z.string().min(1).max(500) }),
]);

function isAdmin(c: { get: (key: 'user') => { role: string } }): boolean {
  return ['ADMIN', 'SUPER_ADMIN'].includes(c.get('user').role);
}

async function requireLecture(env: Env, lectureId: string): Promise<void> {
  if (!await db(env.DB).query.lectures.findFirst({ where: eq(lectures.id, lectureId) })) throw notFound('Lecture not found');
}

/**
 * The one entry point for all private file uploads. The browser still makes a
 * direct PUT to R2 between these two calls, so file bytes never traverse the
 * Worker.
 */
export const uploadRoutes = new ApiRouter<AppBindings>('/uploads');
uploadRoutes.use('*', requireAuth);

uploadRoutes.post('/', async (c) => {
  const input = uploadRequest.parse(await c.req.json());
  if (input.purpose === 'payment-receipt') {
    return c.json({ data: await createPresignedUpload(c.env, input.purpose, c.get('user').id, input) }, 201);
  }
  if (!isAdmin(c)) throw forbidden();
  await requireLecture(c.env, input.lectureId);
  return c.json({ data: await createPresignedUpload(c.env, input.purpose, input.lectureId, input) }, 201);
});

uploadRoutes.post('/complete', async (c) => {
  const input = uploadCompletion.parse(await c.req.json());
  const { purpose, objectKey, filename, contentType, sizeBytes } = input;
  const details = { filename, contentType, sizeBytes };

  if (purpose === 'payment-receipt') {
    const userId = c.get('user').id;
    if (!objectKey.startsWith(`payment-receipts/${userId}/`)) throw conflict('Receipt does not belong to the authenticated user');
    await verifyDirectUpload(c.env.STORAGE, objectKey, details);
    return c.json({ data: { objectKey, filename: safeFilename(filename), contentType, sizeBytes } }, 201);
  }

  if (!isAdmin(c)) throw forbidden();
  await requireLecture(c.env, input.lectureId);
  if (purpose === 'flashcard-image') {
    if (!objectKey.startsWith(`flashcards/${input.lectureId}/`)) throw badRequest('Flashcard images must be uploaded for this lecture');
    await verifyDirectUpload(c.env.STORAGE, objectKey, details);
    return c.json({ data: { objectKey, filename: safeFilename(filename), contentType, sizeBytes } }, 201);
  }

  if (!objectKey.startsWith(`lecture-materials/${input.lectureId}/`)) throw notFound('Upload not found');
  await verifyDirectUpload(c.env.STORAGE, objectKey, details);
  const now = new Date();
  const item = {
    id: crypto.randomUUID(), lectureId: input.lectureId, objectKey,
    originalFilename: safeFilename(filename), contentType, sizeBytes, createdAt: now, updatedAt: now,
  };
  await db(c.env.DB).insert(lectureMaterials).values(item);
  const { objectKey: _objectKey, ...response } = item;
  return c.json({ data: response }, 201);
});
