import { and, asc, count, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { flashcards, lectures, userFlashcardState } from '../db/schema';
import { notFound } from '../lib/errors';
import { flashcardIdParam, flashcardInput, flashcardPatch, lectureIdParam } from '../lib/validation';
import { putPrivateObject } from '../lib/storage';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';
import { z } from 'zod';

const stateInput = z.object({
  knowledge: z.enum(['KNOWN', 'UNKNOWN']).nullable().optional(),
  hidden: z.boolean().optional(),
  viewed: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one state field is required');

const cardResponse = (card: typeof flashcards.$inferSelect, state?: typeof userFlashcardState.$inferSelect) => ({
  ...card,
  frontImageKey: undefined,
  backImageKey: undefined,
  frontImageUrl: card.frontImageKey ? `/api/v1/flashcards/${card.id}/image/front` : null,
  backImageUrl: card.backImageKey ? `/api/v1/flashcards/${card.id}/image/back` : null,
  state: state ? { knowledge: state.knowledge, hidden: state.hidden, viewedAt: state.viewedAt, updatedAt: state.updatedAt } : null,
});

export const flashcardRoutes = new Hono<AppBindings>();
flashcardRoutes.use('*', requireAuth);

flashcardRoutes.get('/lectures/:lectureId/flashcards', async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const user = c.get('user');
  const database = db(c.env.DB);
  if (!await database.query.lectures.findFirst({ where: eq(lectures.id, lectureId) })) throw notFound('Lecture not found');
  const rows = await database.select({ card: flashcards, state: userFlashcardState }).from(flashcards)
    .leftJoin(userFlashcardState, and(eq(userFlashcardState.flashcardId, flashcards.id), eq(userFlashcardState.userId, user.id)))
    .where(eq(flashcards.lectureId, lectureId)).orderBy(asc(flashcards.ordering));
  return c.json({ data: rows.filter((row) => user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || !row.state?.hidden).map((row) => cardResponse(row.card, row.state ?? undefined)) });
});

flashcardRoutes.post('/lectures/:lectureId/flashcards', requireAdmin, async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const input = flashcardInput.parse(await c.req.json());
  const database = db(c.env.DB);
  if (!await database.query.lectures.findFirst({ where: eq(lectures.id, lectureId) })) throw notFound('Lecture not found');
  for (const imageKey of [input.frontImageKey, input.backImageKey]) {
    if (imageKey && !imageKey.startsWith(`flashcards/${lectureId}/`)) throw new Error('Flashcard images must be uploaded for this lecture');
  }
  const now = new Date();
  const item = { id: crypto.randomUUID(), lectureId, frontText: input.frontText ?? null, frontImageKey: input.frontImageKey ?? null, backText: input.backText ?? null, backImageKey: input.backImageKey ?? null, ordering: input.ordering, createdAt: now, updatedAt: now };
  await database.insert(flashcards).values(item);
  return c.json({ data: cardResponse(item) }, 201);
});

flashcardRoutes.post('/lectures/:lectureId/flashcards/image', requireAdmin, async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  if (!await db(c.env.DB).query.lectures.findFirst({ where: eq(lectures.id, lectureId) })) throw notFound('Lecture not found');
  const upload = await putPrivateObject(c.env.STORAGE, c.req.raw, 'flashcard-image', lectureId);
  return c.json({ data: upload }, 201);
});

flashcardRoutes.patch('/flashcards/:flashcardId', requireAdmin, async (c) => {
  const { flashcardId } = flashcardIdParam.parse(c.req.param());
  const input = flashcardPatch.parse(await c.req.json());
  const database = db(c.env.DB);
  const card = await database.query.flashcards.findFirst({ where: eq(flashcards.id, flashcardId) });
  if (!card) throw notFound('Flashcard not found');
  const updatedAt = new Date();
  await database.update(flashcards).set({ ...input, updatedAt }).where(eq(flashcards.id, flashcardId));
  return c.json({ data: cardResponse({ ...card, ...input, updatedAt }) });
});

flashcardRoutes.delete('/flashcards/:flashcardId', requireAdmin, async (c) => {
  const { flashcardId } = flashcardIdParam.parse(c.req.param());
  const result = await db(c.env.DB).delete(flashcards).where(eq(flashcards.id, flashcardId)).returning({ id: flashcards.id });
  if (!result[0]) throw notFound('Flashcard not found');
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

flashcardRoutes.get('/flashcards/:flashcardId/image/:side', async (c) => {
  const { flashcardId } = flashcardIdParam.parse(c.req.param());
  const side = z.enum(['front', 'back']).parse(c.req.param('side'));
  const card = await db(c.env.DB).query.flashcards.findFirst({ where: eq(flashcards.id, flashcardId) });
  if (!card) throw notFound('Flashcard not found');
  const key = side === 'front' ? card.frontImageKey : card.backImageKey;
  if (!key) throw notFound('Flashcard image not found');
  const object = await c.env.STORAGE.get(key);
  if (!object || !('body' in object)) throw notFound('Stored image not found');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  return new Response(object.body, { headers });
});
