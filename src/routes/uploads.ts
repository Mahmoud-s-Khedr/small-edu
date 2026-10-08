import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ApiRouter } from '../openapi';
import { db } from '../db/client';
import { lectures, uploads } from '../db/schema';
import { conflict, forbidden, notFound } from '../lib/errors';
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
  const user = c.get('user');
  const plan = input.purpose === 'payment-receipt'
    ? await createPresignedUpload(c.env, input.purpose, user.id, input)
    : await (async () => {
      if (!isAdmin(c)) throw forbidden();
      await requireLecture(c.env, input.lectureId);
      return createPresignedUpload(c.env, input.purpose, input.lectureId, input);
    })();
  await db(c.env.DB).insert(uploads).values({
    objectKey: plan.objectKey,
    purpose: input.purpose,
    uploaderId: user.id,
    lectureId: 'lectureId' in input ? input.lectureId : null,
    filename: plan.filename,
    contentType: plan.contentType,
    sizeBytes: plan.sizeBytes,
    createdAt: new Date(),
  });
  return c.json({ data: plan }, 201);
});

uploadRoutes.post('/complete', async (c) => {
  const input = uploadCompletion.parse(await c.req.json());
  const { purpose, objectKey, filename, contentType, sizeBytes } = input;
  const upload = await db(c.env.DB).query.uploads.findFirst({ where: eq(uploads.objectKey, objectKey) });
  if (!upload || upload.purpose !== purpose || upload.filename !== safeFilename(filename)
    || upload.contentType !== contentType || upload.sizeBytes !== sizeBytes
    || (('lectureId' in input ? input.lectureId : null) !== upload.lectureId)) throw notFound('Upload not found');
  if (upload.uploaderId !== c.get('user').id) throw conflict('Upload does not belong to the authenticated user');
  if (purpose !== 'payment-receipt' && !isAdmin(c)) throw forbidden();
  await verifyDirectUpload(c.env.STORAGE, objectKey, { filename, contentType, sizeBytes });
  if (!upload.completedAt) await db(c.env.DB).update(uploads).set({ completedAt: new Date() }).where(eq(uploads.objectKey, objectKey));
  return c.json({ data: { objectKey, filename: upload.filename, contentType, sizeBytes } }, 201);
});
