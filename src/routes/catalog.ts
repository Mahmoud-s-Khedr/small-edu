import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { lectures, modules } from '../db/schema';
import { ApiRouter } from '../openapi';
import { requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

const academicYearQuery = z.object({
  academicYear: z.string().trim().min(1).max(30).optional(),
});

const subjectQuery = academicYearQuery.extend({
  moduleId: z.string().uuid().optional(),
  semester: z.string().trim().min(1).max(30).optional(),
});

/**
 * Read-only values used to populate catalogue filters. These values remain
 * derived from modules and lectures; they are not independently managed data.
 */
export const catalogRoutes = new ApiRouter<AppBindings>('');
catalogRoutes.use('*', requireAuth);

catalogRoutes.get('/academic-years', async (c) => {
  const items = await db(c.env.DB).selectDistinct({ academicYear: modules.academicYear })
    .from(modules).orderBy(desc(modules.academicYear));
  return c.json({ data: items.map(({ academicYear }) => academicYear) });
});

catalogRoutes.get('/semesters', async (c) => {
  const { academicYear } = academicYearQuery.parse(c.req.query());
  const items = await db(c.env.DB).selectDistinct({ semester: modules.semester })
    .from(modules)
    .where(academicYear ? eq(modules.academicYear, academicYear) : undefined)
    .orderBy(asc(modules.semester));
  return c.json({ data: items.map(({ semester }) => semester) });
});

catalogRoutes.get('/subjects', async (c) => {
  const query = subjectQuery.parse(c.req.query());
  const filters: SQL[] = [];
  if (query.moduleId) filters.push(eq(lectures.moduleId, query.moduleId));
  if (query.academicYear) filters.push(eq(modules.academicYear, query.academicYear));
  if (query.semester) filters.push(eq(modules.semester, query.semester));
  const where = filters.length ? and(...filters) : undefined;
  const items = await db(c.env.DB).selectDistinct({ subject: lectures.subject })
    .from(lectures).innerJoin(modules, eq(lectures.moduleId, modules.id))
    .where(where).orderBy(asc(lectures.subject));
  return c.json({ data: items.map(({ subject }) => subject) });
});
