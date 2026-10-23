import { and, asc, countDistinct, desc, eq, ne, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { lectures, modules } from '../db/schema';
import { ApiRouter } from '../openapi';
import { facultyNameInput } from '../lib/validation';
import { pagination, paginationQuery } from '../lib/pagination';
import { requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

const facultyQuery = z.object({
  facultyName: facultyNameInput.optional(),
});

const academicYearQuery = facultyQuery.extend({
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

catalogRoutes.get('/faculties', async (c) => {
  const p = pagination(paginationQuery.parse(c.req.query()));
  const database = db(c.env.DB);
  // Older modules remain unassigned until an admin supplies their faculty name.
  const where = ne(modules.facultyName, '');
  const [items, totalRow] = await Promise.all([
    database.selectDistinct({ facultyName: modules.facultyName }).from(modules).where(where)
      .orderBy(asc(modules.facultyName)).limit(p.limit).offset(p.offset),
    database.select({ total: countDistinct(modules.facultyName) }).from(modules).where(where).get(),
  ]);
  return c.json({ data: items.map(({ facultyName }) => facultyName), meta: { ...p, total: totalRow?.total ?? 0 } });
});

catalogRoutes.get('/academic-years', async (c) => {
  const { facultyName } = facultyQuery.parse(c.req.query());
  const items = await db(c.env.DB).selectDistinct({ academicYear: modules.academicYear })
    .from(modules).where(facultyName ? eq(modules.facultyName, facultyName) : undefined).orderBy(desc(modules.academicYear));
  return c.json({ data: items.map(({ academicYear }) => academicYear) });
});

catalogRoutes.get('/semesters', async (c) => {
  const { academicYear, facultyName } = academicYearQuery.parse(c.req.query());
  const items = await db(c.env.DB).selectDistinct({ semester: modules.semester })
    .from(modules)
    .where(and(
      academicYear ? eq(modules.academicYear, academicYear) : undefined,
      facultyName ? eq(modules.facultyName, facultyName) : undefined,
    ))
    .orderBy(asc(modules.semester));
  return c.json({ data: items.map(({ semester }) => semester) });
});

catalogRoutes.get('/subjects', async (c) => {
  const query = subjectQuery.parse(c.req.query());
  const filters: SQL[] = [];
  if (query.facultyName) filters.push(eq(modules.facultyName, query.facultyName));
  if (query.moduleId) filters.push(eq(lectures.moduleId, query.moduleId));
  if (query.academicYear) filters.push(eq(modules.academicYear, query.academicYear));
  if (query.semester) filters.push(eq(modules.semester, query.semester));
  const where = filters.length ? and(...filters) : undefined;
  const items = await db(c.env.DB).selectDistinct({ subject: lectures.subject })
    .from(lectures).innerJoin(modules, eq(lectures.moduleId, modules.id))
    .where(where).orderBy(asc(lectures.subject));
  return c.json({ data: items.map(({ subject }) => subject) });
});
