import { and, asc, eq } from 'drizzle-orm';
import { ApiRouter } from '../openapi';
import { z } from 'zod';
import { db } from '../db/client';
import { lectures, mcqChoices, mcqs } from '../db/schema';
import { notFound } from '../lib/errors';
import { lectureIdParam, mcqIdParam, mcqInput, mcqPatch } from '../lib/validation';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

const publicQuestion = (question: typeof mcqs.$inferSelect, choices: Array<typeof mcqChoices.$inferSelect>) => ({
  id: question.id, lectureId: question.lectureId, questionText: question.questionText, ordering: question.ordering,
  choices: choices.map(({ isCorrect: _isCorrect, ...choice }) => choice),
});

async function questionWithChoices(database: ReturnType<typeof db>, id: string) {
  const question = await database.query.mcqs.findFirst({ where: eq(mcqs.id, id) });
  if (!question) return null;
  const choices = await database.select().from(mcqChoices).where(eq(mcqChoices.mcqId, id)).orderBy(asc(mcqChoices.ordering));
  return { question, choices };
}

export const mcqRoutes = new ApiRouter<AppBindings>('');
mcqRoutes.use('*', requireAuth);

mcqRoutes.get('/lectures/:lectureId/mcqs', async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const database = db(c.env.DB);
  if (!await database.query.lectures.findFirst({ where: eq(lectures.id, lectureId) })) throw notFound('Lecture not found');
  const questions = await database.select().from(mcqs).where(eq(mcqs.lectureId, lectureId)).orderBy(asc(mcqs.ordering));
  const result = await Promise.all(questions.map(async (question) => publicQuestion(question,
    await database.select().from(mcqChoices).where(eq(mcqChoices.mcqId, question.id)).orderBy(asc(mcqChoices.ordering)))));
  return c.json({ data: result });
});

mcqRoutes.post('/lectures/:lectureId/mcqs', requireAdmin, async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const input = mcqInput.parse(await c.req.json());
  const database = db(c.env.DB);
  if (!await database.query.lectures.findFirst({ where: eq(lectures.id, lectureId) })) throw notFound('Lecture not found');
  const now = new Date();
  const question = { id: crypto.randomUUID(), lectureId, questionText: input.questionText, ordering: input.ordering, createdAt: now, updatedAt: now };
  await database.insert(mcqs).values(question);
  const choices = input.choices.map((choice, ordering) => ({ id: crypto.randomUUID(), mcqId: question.id, choiceText: choice.text, isCorrect: choice.isCorrect, ordering }));
  await database.insert(mcqChoices).values(choices);
  return c.json({ data: publicQuestion(question, choices) }, 201);
});

mcqRoutes.patch('/mcqs/:mcqId', requireAdmin, async (c) => {
  const { mcqId } = mcqIdParam.parse(c.req.param());
  const input = mcqPatch.parse(await c.req.json());
  const database = db(c.env.DB);
  const existing = await questionWithChoices(database, mcqId);
  if (!existing) throw notFound('MCQ not found');
  const updatedAt = new Date();
  const questionUpdate = { ...(input.questionText !== undefined ? { questionText: input.questionText } : {}), ...(input.ordering !== undefined ? { ordering: input.ordering } : {}), updatedAt };
  await database.update(mcqs).set(questionUpdate).where(eq(mcqs.id, mcqId));
  if (input.choices) {
    await database.delete(mcqChoices).where(eq(mcqChoices.mcqId, mcqId));
    await database.insert(mcqChoices).values(input.choices.map((choice, ordering) => ({ id: crypto.randomUUID(), mcqId, choiceText: choice.text, isCorrect: choice.isCorrect, ordering })));
  }
  const result = await questionWithChoices(database, mcqId);
  if (!result) throw notFound('MCQ not found');
  return c.json({ data: publicQuestion(result.question, result.choices) });
});

mcqRoutes.delete('/mcqs/:mcqId', requireAdmin, async (c) => {
  const { mcqId } = mcqIdParam.parse(c.req.param());
  const result = await db(c.env.DB).delete(mcqs).where(eq(mcqs.id, mcqId)).returning({ id: mcqs.id });
  if (!result[0]) throw notFound('MCQ not found');
  return c.body(null, 204);
});

mcqRoutes.post('/mcqs/:mcqId/check-answer', async (c) => {
  const { mcqId } = mcqIdParam.parse(c.req.param());
  const { choiceId } = z.object({ choiceId: z.string().uuid() }).parse(await c.req.json());
  const choice = await db(c.env.DB).query.mcqChoices.findFirst({ where: and(eq(mcqChoices.id, choiceId), eq(mcqChoices.mcqId, mcqId)) });
  if (!choice) throw notFound('Choice not found for this MCQ');
  const correct = await db(c.env.DB).query.mcqChoices.findFirst({ where: and(eq(mcqChoices.mcqId, mcqId), eq(mcqChoices.isCorrect, true)) });
  if (!correct) throw new Error('MCQ has no correct answer');
  return c.json({ data: { correct: choice.isCorrect, correctChoiceId: correct.id } });
});
