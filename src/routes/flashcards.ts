import { and, asc, count, eq, or, sql } from 'drizzle-orm';
import { ApiRouter } from '../openapi';
import { db } from '../db/client';
import { flashcards, lectures, userFlashcardState } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { flashcardIdParam, flashcardInput, flashcardPatch, lectureIdParam } from '../lib/validation';
import { deletePrivateObjects } from '../lib/storage';
import { createPresignedDownload } from '../lib/presigned-uploads';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';
import { z } from 'zod';

const stateInput = z.object({
  knowledge: z.enum(['KNOWN', 'UNKNOWN']).nullable().optional(),
  hidden: z.boolean().optional(),
  viewed: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one state field is required');

const cardResponse = async (
  env: Env,
  card: typeof flashcards.$inferSelect,
  state?: typeof userFlashcardState.$inferSelect,
) => {
  const [frontImageUrl, backImageUrl] = await Promise.all([
    card.frontImageKey ? createPresignedDownload(env, card.frontImageKey) : null,
    card.backImageKey ? createPresignedDownload(env, card.backImageKey) : null,
  ]);
  return {
  ...card,
  frontImageKey: undefined,
  backImageKey: undefined,
  frontImageUrl,
  backImageUrl,
  state: state ? { knowledge: state.knowledge, hidden: state.hidden, viewedAt: state.viewedAt, updatedAt: state.updatedAt } : null,
  };
};

function validateCardContent(card: Pick<typeof flashcards.$inferInsert, 'frontText' | 'frontImageKey' | 'backText' | 'backImageKey'>): void {
  if (!card.frontText && !card.frontImageKey) throw badRequest('A front text or image is required');
  if (!card.backText && !card.backImageKey) throw badRequest('A back text or image is required');
}

function validateImageKeys(lectureId: string, keys: Array<string | null | undefined>): void {
  for (const imageKey of keys) {
    if (imageKey && !imageKey.startsWith(`flashcards/${lectureId}/`)) {
      throw badRequest('Flashcard images must be uploaded for this lecture');
    }
  }
}

async function deleteUnreferencedImages(database: ReturnType<typeof db>, bucket: R2Bucket, keys: Array<string | null | undefined>): Promise<void> {
  const candidates = [...new Set(keys.filter((key): key is string => !!key))];
  if (!candidates.length) return;
  const references = await database.select({ frontImageKey: flashcards.frontImageKey, backImageKey: flashcards.backImageKey })
    .from(flashcards).where(or(...candidates.flatMap((key) => [eq(flashcards.frontImageKey, key), eq(flashcards.backImageKey, key)])));
  const referenced = new Set(references.flatMap((card) => [card.frontImageKey, card.backImageKey]));
  await deletePrivateObjects(bucket, candidates.filter((key) => !referenced.has(key)));
}

export const flashcardRoutes = new ApiRouter<AppBindings>('');
flashcardRoutes.use('*', requireAuth);

flashcardRoutes.get('/lectures/:lectureId/flashcards', async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const user = c.get('user');
  const database = db(c.env.DB);
  if (!await database.query.lectures.findFirst({ where: eq(lectures.id, lectureId) })) throw notFound('Lecture not found');
  const rows = await database.select({ card: flashcards, state: userFlashcardState }).from(flashcards)
    .leftJoin(userFlashcardState, and(eq(userFlashcardState.flashcardId, flashcards.id), eq(userFlashcardState.userId, user.id)))
    .where(eq(flashcards.lectureId, lectureId)).orderBy(asc(flashcards.ordering));
  const visibleRows = rows.filter((row) => user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || !row.state?.hidden);
  return c.json({ data: await Promise.all(visibleRows.map((row) => cardResponse(c.env, row.card, row.state ?? undefined))) });
});

flashcardRoutes.post('/lectures/:lectureId/flashcards', requireAdmin, async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const input = flashcardInput.parse(await c.req.json());
  const database = db(c.env.DB);
  if (!await database.query.lectures.findFirst({ where: eq(lectures.id, lectureId) })) throw notFound('Lecture not found');
  validateImageKeys(lectureId, [input.frontImageKey, input.backImageKey]);
  const now = new Date();
  const item = { id: crypto.randomUUID(), lectureId, frontText: input.frontText ?? null, frontImageKey: input.frontImageKey ?? null, backText: input.backText ?? null, backImageKey: input.backImageKey ?? null, ordering: input.ordering, createdAt: now, updatedAt: now };
  await database.insert(flashcards).values(item);
  return c.json({ data: await cardResponse(c.env, item) }, 201);
});

flashcardRoutes.get('/flashcards/:flashcardId', async (c) => {
  const { flashcardId } = flashcardIdParam.parse(c.req.param());
  const user = c.get('user');
  const database = db(c.env.DB);
  const card = await database.query.flashcards.findFirst({ where: eq(flashcards.id, flashcardId) });
  if (!card) throw notFound('Flashcard not found');
  const state = await database.query.userFlashcardState.findFirst({
    where: and(eq(userFlashcardState.flashcardId, card.id), eq(userFlashcardState.userId, user.id)),
  });
  if (state?.hidden && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') throw notFound('Flashcard not found');
  return c.json({ data: await cardResponse(c.env, card, state) });
});

flashcardRoutes.patch('/flashcards/:flashcardId', requireAdmin, async (c) => {
  const { flashcardId } = flashcardIdParam.parse(c.req.param());
  const input = flashcardPatch.parse(await c.req.json());
  const database = db(c.env.DB);
  const card = await database.query.flashcards.findFirst({ where: eq(flashcards.id, flashcardId) });
  if (!card) throw notFound('Flashcard not found');
  const nextCard = { ...card, ...input };
  validateCardContent(nextCard);
  validateImageKeys(card.lectureId, [nextCard.frontImageKey, nextCard.backImageKey]);
  const updatedAt = new Date();
  await database.update(flashcards).set({ ...input, updatedAt }).where(eq(flashcards.id, flashcardId));
  await deleteUnreferencedImages(database, c.env.STORAGE, [
    card.frontImageKey !== nextCard.frontImageKey ? card.frontImageKey : null,
    card.backImageKey !== nextCard.backImageKey ? card.backImageKey : null,
  ]);
  return c.json({ data: await cardResponse(c.env, { ...nextCard, updatedAt }) });
});

flashcardRoutes.delete('/flashcards/:flashcardId', requireAdmin, async (c) => {
  const { flashcardId } = flashcardIdParam.parse(c.req.param());
  const database = db(c.env.DB);
  const card = await database.query.flashcards.findFirst({ where: eq(flashcards.id, flashcardId) });
  if (!card) throw notFound('Flashcard not found');
  await database.delete(flashcards).where(eq(flashcards.id, flashcardId));
  await deleteUnreferencedImages(database, c.env.STORAGE, [card.frontImageKey, card.backImageKey]);
  return c.body(null, 204);
});

flashcardRoutes.put('/flashcards/:flashcardId/state', async (c) => {
  const { flashcardId } = flashcardIdParam.parse(c.req.param());
  const input = stateInput.parse(await c.req.json());
  const database = db(c.env.DB);
  if (!await database.query.flashcards.findFirst({ where: eq(flashcards.id, flashcardId) })) throw notFound('Flashcard not found');
  const now = new Date();
  const values = { userId: c.get('user').id, flashcardId, knowledge: input.knowledge ?? null, hidden: input.hidden ?? false, viewedAt: input.viewed ? now : null, updatedAt: now };
  await database.insert(userFlashcardState).values(values).onConflictDoUpdate({
    target: [userFlashcardState.userId, userFlashcardState.flashcardId],
    set: {
      ...(input.knowledge !== undefined ? { knowledge: input.knowledge } : {}),
      ...(input.hidden !== undefined ? { hidden: input.hidden } : {}),
      ...(input.viewed ? { viewedAt: now } : {}),
      updatedAt: now,
    },
  });
  return c.json({ data: { ...values, ...input, updatedAt: now } });
});

flashcardRoutes.get('/lectures/:lectureId/flashcards/progress', async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const userId = c.get('user').id;
  const database = db(c.env.DB);
  const total = await database.select({ count: count() }).from(flashcards).where(eq(flashcards.lectureId, lectureId)).get();
  const states = await database.select({ known: sql<number>`sum(case when ${userFlashcardState.knowledge} = 'KNOWN' then 1 else 0 end)`, hidden: sql<number>`sum(case when ${userFlashcardState.hidden} then 1 else 0 end)` })
    .from(userFlashcardState).innerJoin(flashcards, eq(flashcards.id, userFlashcardState.flashcardId))
    .where(and(eq(flashcards.lectureId, lectureId), eq(userFlashcardState.userId, userId))).get();
  return c.json({ data: { total: total?.count ?? 0, known: states?.known ?? 0, hidden: states?.hidden ?? 0 } });
});
