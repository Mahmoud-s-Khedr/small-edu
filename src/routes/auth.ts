import { and, eq, isNull, sql } from 'drizzle-orm';
import { ApiRouter } from '../openapi';
import { db } from '../db/client';
import { users } from '../db/schema';
import { conflict, unauthorized } from '../lib/errors';
import { authSessionInput } from '../lib/validation';
import { verifyFirebaseIdToken } from '../middleware/auth';
import type { AppBindings, AuthUser } from '../types';

const asAuthUser = (user: Pick<typeof users.$inferSelect, 'id' | 'email' | 'name' | 'role'>): AuthUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
});

const fallbackName = (email: string): string => email.split('@', 1)[0] || email;
/** Provision a local account only after a verified Firebase ID token. */
export const authRoutes = new ApiRouter<AppBindings>('/auth');

authRoutes.post('/session', async (c) => {
  const value = c.req.header('Authorization');
  if (!value?.startsWith('Bearer ')) throw unauthorized();
  const identity = await verifyFirebaseIdToken(value.slice(7), c.env);
  if (!identity) throw unauthorized('Invalid or expired Firebase ID token');
  const { name } = c.req.header('Content-Type')?.includes('application/json')
    ? authSessionInput.parse(await c.req.json())
    : {};

  const database = db(c.env.DB);
  const deletionGuard = () => c.env.DB.prepare('SELECT firebase_uid FROM account_deletion_jobs WHERE firebase_uid = ?')
    .bind(identity.subject).first();
  const rejectDeleting = async () => {
    if (await deletionGuard()) throw conflict('This account is being deleted or has been deleted');
  };
  await rejectDeleting();
  const linked = await database.query.users.findFirst({ where: eq(users.externalSubject, identity.subject) });
  if (linked?.deletionRequestedAt) throw conflict('This account is being deleted');
  if (linked) return c.json({ data: { user: asAuthUser(linked), created: false } });

  const emailMatch = await database.query.users.findFirst({ where: eq(users.email, identity.email) });
  if (emailMatch) {
    if (emailMatch.deletionRequestedAt) throw conflict('This account is being deleted');
    if (emailMatch.externalSubject) {
      throw conflict('This email address is already linked to a different Firebase account');
    }

    // The predicate preserves a legacy account if two first-login requests race.
    let linkedLegacy: Array<typeof users.$inferSelect>;
    try {
      linkedLegacy = await database.update(users)
        .set({ externalSubject: identity.subject, updatedAt: new Date() })
        .where(and(eq(users.id, emailMatch.id), isNull(users.externalSubject), isNull(users.deletionRequestedAt),
          sql`NOT EXISTS (SELECT 1 FROM account_deletion_jobs WHERE firebase_uid = ${identity.subject})`))
        .returning();
    } catch (error) {
      await rejectDeleting();
      const raced = await database.query.users.findFirst({ where: eq(users.externalSubject, identity.subject) });
      if (raced?.deletionRequestedAt) throw conflict('This account is being deleted');
      if (raced) return c.json({ data: { user: asAuthUser(raced), created: false } });
      throw error;
    }
    if (linkedLegacy[0]) return c.json({ data: { user: asAuthUser(linkedLegacy[0]), created: false } });

    await rejectDeleting();
    const raced = await database.query.users.findFirst({ where: eq(users.externalSubject, identity.subject) });
    if (raced?.deletionRequestedAt) throw conflict('This account is being deleted');
    if (raced) return c.json({ data: { user: asAuthUser(raced), created: false } });
    throw conflict('This email address is already linked to a different Firebase account');
  }

  const now = new Date();
  const created = {
    id: crypto.randomUUID(),
    externalSubject: identity.subject,
    email: identity.email,
    name: name ?? identity.name ?? fallbackName(identity.email),
    role: 'USER' as const,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const inserted = await c.env.DB.prepare(`INSERT INTO users (id, external_subject, email, name, role, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM account_deletion_jobs WHERE firebase_uid = ?)`)
      .bind(created.id, created.externalSubject, created.email, created.name, created.role,
        now.getTime(), now.getTime(), identity.subject).run();
    if (!inserted.meta.changes) throw conflict('This account is being deleted or has been deleted');
    return c.json({ data: { user: asAuthUser(created), created: true } });
  } catch (error) {
    // Unique constraints make concurrent first-login calls safe. Re-read the
    // resulting local account; a different subject for this email is a conflict.
    await rejectDeleting();
    const existing = await database.query.users.findFirst({ where: eq(users.externalSubject, identity.subject) });
    if (existing?.deletionRequestedAt) throw conflict('This account is being deleted');
    if (existing) return c.json({ data: { user: asAuthUser(existing), created: false } });
    const collidingEmail = await database.query.users.findFirst({ where: eq(users.email, identity.email) });
    if (collidingEmail) throw conflict('This email address is already linked to a different Firebase account');
    throw error;
  }
});
