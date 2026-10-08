import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { ApiRouter } from '../openapi';
import { z } from 'zod';
import { db } from '../db/client';
import { flashcards, lectureMaterials, lectures, modules } from '../db/schema';
import { notFound } from '../lib/errors';
import { pagination, paginationQuery } from '../lib/pagination';
import { lectureInput, lecturePatch, moduleIdParam, moduleInput, modulePatch } from '../lib/validation';
import { hasModuleVideoAccess } from '../lib/access';
import { deletePrivateObjects } from '../lib/storage';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

const moduleFilters = paginationQuery.extend({
  number: z.string().min(1).optional(),
  academicYear: z.string().min(1).optional(),
  semester: z.string().min(1).optional(),
});
const lectureFilters = paginationQuery.extend({
  subject: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const moduleRoutes = new ApiRouter<AppBindings>('/modules');
moduleRoutes.use('*', requireAuth);

moduleRoutes.get('/', async (c) => {
  const query = moduleFilters.parse(c.req.query());
  const filters: SQL[] = [];
  if (query.number) filters.push(eq(modules.number, query.number));
  if (query.academicYear) filters.push(eq(modules.academicYear, query.academicYear));
  if (query.semester) filters.push(eq(modules.semester, query.semester));
  const where = filters.length ? and(...filters) : undefined;
  const p = pagination(query);
  const database = db(c.env.DB);
  const [items, totalRow] = await Promise.all([
    database.select().from(modules).where(where).orderBy(desc(modules.createdAt)).limit(p.limit).offset(p.offset),
    database.select({ total: count() }).from(modules).where(where).get(),
  ]);
  return c.json({ data: items, meta: { ...p, total: totalRow?.total ?? 0 } });
});

moduleRoutes.post('/', requireAdmin, async (c) => {
  const input = moduleInput.parse(await c.req.json());
  const now = new Date();
  const item = { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now };
  await db(c.env.DB).insert(modules).values(item);
  return c.json({ data: item }, 201);
});

moduleRoutes.get('/:moduleId', async (c) => {
  const { moduleId } = moduleIdParam.parse(c.req.param());
  const item = await db(c.env.DB).query.modules.findFirst({ where: eq(modules.id, moduleId) });
  if (!item) throw notFound('Module not found');
  return c.json({ data: item });
});

moduleRoutes.patch('/:moduleId', requireAdmin, async (c) => {
  const { moduleId } = moduleIdParam.parse(c.req.param());
  const input = modulePatch.parse(await c.req.json());
  const database = db(c.env.DB);
  const existing = await database.query.modules.findFirst({ where: eq(modules.id, moduleId) });
  if (!existing) throw notFound('Module not found');
  await database.update(modules).set({ ...input, updatedAt: new Date() }).where(eq(modules.id, moduleId));
  return c.json({ data: { ...existing, ...input, updatedAt: new Date() } });
});

moduleRoutes.delete('/:moduleId', requireAdmin, async (c) => {
  const { moduleId } = moduleIdParam.parse(c.req.param());
  const database = db(c.env.DB);
  const [materialRows, cardRows] = await Promise.all([
    database.select({ objectKey: lectureMaterials.objectKey }).from(lectureMaterials)
      .innerJoin(lectures, eq(lectureMaterials.lectureId, lectures.id)).where(eq(lectures.moduleId, moduleId)),
    database.select({ frontImageKey: flashcards.frontImageKey, backImageKey: flashcards.backImageKey }).from(flashcards)
      .innerJoin(lectures, eq(flashcards.lectureId, lectures.id)).where(eq(lectures.moduleId, moduleId)),
  ]);
  const result = await database.delete(modules).where(eq(modules.id, moduleId)).returning({ id: modules.id });
  if (!result[0]) throw notFound('Module not found');
  await deletePrivateObjects(c.env.STORAGE, [
    ...materialRows.map((material) => material.objectKey),
    ...cardRows.flatMap((card) => [card.frontImageKey, card.backImageKey]),
  ]);
  return c.body(null, 204);
});

moduleRoutes.get('/:moduleId/lectures', async (c) => {
  const { moduleId } = moduleIdParam.parse(c.req.param());
  const query = lectureFilters.parse(c.req.query());
  const filters: SQL[] = [eq(lectures.moduleId, moduleId)];
  if (query.subject) filters.push(eq(lectures.subject, query.subject));
  if (query.from) filters.push(gte(lectures.lectureDate, query.from));
  if (query.to) filters.push(lte(lectures.lectureDate, query.to));
  const p = pagination(query);
  const database = db(c.env.DB);
  const [items, totalRow] = await Promise.all([
    database.select({ lecture: lectures, module: modules }).from(lectures).innerJoin(modules, eq(lectures.moduleId, modules.id))
      .where(and(...filters)).orderBy(desc(lectures.lectureDate)).limit(p.limit).offset(p.offset),
    database.select({ total: count() }).from(lectures).where(and(...filters)).get(),
  ]);
  const canWatch = await hasModuleVideoAccess(c.env, c.get('user'), moduleId);
  return c.json({ data: items.map(({ lecture, module }) => ({ ...lecture, videoUrl: canWatch ? lecture.videoUrl : null, videoLocked: !canWatch, module })), meta: { ...p, total: totalRow?.total ?? 0 } });
});

moduleRoutes.post('/:moduleId/lectures', requireAdmin, async (c) => {
  const { moduleId } = moduleIdParam.parse(c.req.param());
  const input = lectureInput.parse(await c.req.json());
  const database = db(c.env.DB);
  if (!await database.query.modules.findFirst({ where: eq(modules.id, moduleId) })) throw notFound('Module not found');
  const now = new Date();
  const item = { id: crypto.randomUUID(), moduleId, ...input, createdAt: now, updatedAt: now };
  await database.insert(lectures).values(item);
  return c.json({ data: item }, 201);
});

export { lecturePatch };
