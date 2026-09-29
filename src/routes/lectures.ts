import { and, count, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { ApiRouter } from '../openapi';
import { z } from 'zod';
import { db } from '../db/client';
import { flashcards, lectureMaterials, lectures, moduleAccess, modules } from '../db/schema';
import { hasModuleVideoAccess, requireModuleVideoAccess } from '../lib/access';
import { notFound } from '../lib/errors';
import { pagination, paginationQuery } from '../lib/pagination';
import { lectureIdParam, lecturePatch } from '../lib/validation';
import { deletePrivateObjects } from '../lib/storage';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

const listFilters = paginationQuery.extend({
  moduleId: z.string().uuid().optional(),
  subject: z.string().min(1).optional(),
  academicYear: z.string().min(1).optional(),
  semester: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const lectureRoutes = new ApiRouter<AppBindings>('/lectures');
lectureRoutes.use('*', requireAuth);

lectureRoutes.get('/', async (c) => {
  const query = listFilters.parse(c.req.query());
  const p = pagination(query);
  const filters: SQL[] = [];
  if (query.moduleId) filters.push(eq(lectures.moduleId, query.moduleId));
  if (query.subject) filters.push(eq(lectures.subject, query.subject));
  if (query.academicYear) filters.push(eq(modules.academicYear, query.academicYear));
  if (query.semester) filters.push(eq(modules.semester, query.semester));
  if (query.from) filters.push(gte(lectures.lectureDate, query.from));
  if (query.to) filters.push(lte(lectures.lectureDate, query.to));
  const where = filters.length ? and(...filters) : undefined;
  const database = db(c.env.DB);
  const [items, totalRow] = await Promise.all([
    database.select({ lecture: lectures, module: modules }).from(lectures).innerJoin(modules, eq(lectures.moduleId, modules.id))
      .where(where).orderBy(desc(lectures.lectureDate)).limit(p.limit).offset(p.offset),
    database.select({ total: count() }).from(lectures).innerJoin(modules, eq(lectures.moduleId, modules.id)).where(where).get(),
  ]);
  const user = c.get('user');
  const moduleIds = [...new Set(items.map(({ lecture }) => lecture.moduleId))];
  const accessibleModuleIds = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN'
    ? new Set(moduleIds)
    : new Set((moduleIds.length ? await database.select({ moduleId: moduleAccess.moduleId }).from(moduleAccess)
      .where(and(eq(moduleAccess.userId, user.id), inArray(moduleAccess.moduleId, moduleIds))) : []).map((access) => access.moduleId));
  return c.json({ data: items.map(({ lecture, module }) => {
    const canWatch = accessibleModuleIds.has(lecture.moduleId);
    return { ...lecture, videoUrl: canWatch ? lecture.videoUrl : null, videoLocked: !canWatch, academicYear: module.academicYear, semester: module.semester };
  }), meta: { ...p, total: totalRow?.total ?? 0 } });
});

lectureRoutes.get('/:lectureId', async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const row = await db(c.env.DB).select({ lecture: lectures, module: modules }).from(lectures)
    .innerJoin(modules, eq(lectures.moduleId, modules.id)).where(eq(lectures.id, lectureId)).get();
  if (!row) throw notFound('Lecture not found');
  const canWatch = await hasModuleVideoAccess(c.env, c.get('user'), row.lecture.moduleId);
  return c.json({ data: { ...row.lecture, videoUrl: canWatch ? row.lecture.videoUrl : null, videoLocked: !canWatch } });
});

lectureRoutes.patch('/:lectureId', requireAdmin, async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const input = lecturePatch.parse(await c.req.json());
  const database = db(c.env.DB);
  const existing = await database.query.lectures.findFirst({ where: eq(lectures.id, lectureId) });
  if (!existing) throw notFound('Lecture not found');
  const updatedAt = new Date();
  await database.update(lectures).set({ ...input, updatedAt }).where(eq(lectures.id, lectureId));
  return c.json({ data: { ...existing, ...input, updatedAt } });
});

lectureRoutes.delete('/:lectureId', requireAdmin, async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const database = db(c.env.DB);
  const [materialRows, cardRows] = await Promise.all([
    database.select({ objectKey: lectureMaterials.objectKey }).from(lectureMaterials).where(eq(lectureMaterials.lectureId, lectureId)),
    database.select({ frontImageKey: flashcards.frontImageKey, backImageKey: flashcards.backImageKey }).from(flashcards).where(eq(flashcards.lectureId, lectureId)),
  ]);
  const result = await database.delete(lectures).where(eq(lectures.id, lectureId)).returning({ id: lectures.id });
  if (!result[0]) throw notFound('Lecture not found');
  await deletePrivateObjects(c.env.STORAGE, [
    ...materialRows.map((material) => material.objectKey),
    ...cardRows.flatMap((card) => [card.frontImageKey, card.backImageKey]),
  ]);
  return c.body(null, 204);
});

lectureRoutes.get('/:lectureId/materials', async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const database = db(c.env.DB);
  if (!await database.query.lectures.findFirst({ where: eq(lectures.id, lectureId) })) throw notFound('Lecture not found');
  const items = await database.select().from(lectureMaterials).where(eq(lectureMaterials.lectureId, lectureId));
  return c.json({ data: items.map(({ objectKey: _objectKey, ...material }) => material) });
});

lectureRoutes.get('/:lectureId/video', async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const lecture = await db(c.env.DB).query.lectures.findFirst({ where: eq(lectures.id, lectureId) });
  if (!lecture) throw notFound('Lecture not found');
  await requireModuleVideoAccess(c.env, c.get('user'), lecture.moduleId);
  return c.json({ data: { videoUrl: lecture.videoUrl } });
});

lectureRoutes.get('/:lectureId/materials/:materialId/download', async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const materialId = z.string().uuid().parse(c.req.param('materialId'));
  const material = await db(c.env.DB).query.lectureMaterials.findFirst({
    where: and(eq(lectureMaterials.id, materialId), eq(lectureMaterials.lectureId, lectureId)),
  });
  if (!material) throw notFound('Material not found');
  const object = await c.env.STORAGE.get(material.objectKey);
  if (!object || !('body' in object)) throw notFound('Stored file not found');
  const headers = new Headers({
    'Content-Type': material.contentType,
    'Content-Disposition': `attachment; filename="${material.originalFilename.replaceAll('"', '')}"`,
  });
  object.writeHttpMetadata(headers);
  return new Response(object.body, { headers });
});

lectureRoutes.patch('/:lectureId/materials/:materialId', requireAdmin, async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const materialId = z.string().uuid().parse(c.req.param('materialId'));
  const { originalFilename } = z.object({ originalFilename: z.string().trim().min(1).max(255) }).parse(await c.req.json());
  const database = db(c.env.DB);
  const material = await database.query.lectureMaterials.findFirst({
    where: and(eq(lectureMaterials.id, materialId), eq(lectureMaterials.lectureId, lectureId)),
  });
  if (!material) throw notFound('Material not found');
  const updatedAt = new Date();
  await database.update(lectureMaterials).set({ originalFilename, updatedAt }).where(eq(lectureMaterials.id, materialId));
  const { objectKey: _objectKey, ...response } = { ...material, originalFilename, updatedAt };
  return c.json({ data: response });
});

lectureRoutes.delete('/:lectureId/materials/:materialId', requireAdmin, async (c) => {
  const { lectureId } = lectureIdParam.parse(c.req.param());
  const materialId = z.string().uuid().parse(c.req.param('materialId'));
  const database = db(c.env.DB);
  const material = await database.query.lectureMaterials.findFirst({
    where: and(eq(lectureMaterials.id, materialId), eq(lectureMaterials.lectureId, lectureId)),
  });
  if (!material) throw notFound('Material not found');
  await database.delete(lectureMaterials).where(eq(lectureMaterials.id, materialId));
  await c.env.STORAGE.delete(material.objectKey);
  return c.body(null, 204);
});
