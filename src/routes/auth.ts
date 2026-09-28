import { and, eq, isNull } from 'drizzle-orm';
import { ApiRouter } from '../openapi';
import { db } from '../db/client';
import { users } from '../db/schema';
import { conflict, unauthorized } from '../lib/errors';
import { verifyFirebaseIdToken } from '../middleware/auth';
import type { AppBindings, AuthUser } from '../types';

const asAuthUser = (user: typeof users.$inferSelect): AuthUser => ({
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

  const database = db(c.env.DB);
  const linked = await database.query.users.findFirst({ where: eq(users.externalSubject, identity.subject) });
  if (linked) return c.json({ data: { user: asAuthUser(linked), created: false } });

  const emailMatch = await database.query.users.findFirst({ where: eq(users.email, identity.email) });
  if (emailMatch) {
    if (emailMatch.externalSubject) {
      throw conflict('This email address is already linked to a different Firebase account');
    }

    // The predicate preserves a legacy account if two first-login requests race.
    let linkedLegacy: Array<typeof users.$inferSelect>;
    try {
      linkedLegacy = await database.update(users)
        .set({ externalSubject: identity.subject, updatedAt: new Date() })
        .where(and(eq(users.id, emailMatch.id), isNull(users.externalSubject)))
        .returning();
    } catch (error) {
      const raced = await database.query.users.findFirst({ where: eq(users.externalSubject, identity.subject) });
      if (raced) return c.json({ data: { user: asAuthUser(raced), created: false } });
      throw error;
    }
    if (linkedLegacy[0]) return c.json({ data: { user: asAuthUser(linkedLegacy[0]), created: false } });

    const raced = await database.query.users.findFirst({ where: eq(users.externalSubject, identity.subject) });
    if (raced) return c.json({ data: { user: asAuthUser(raced), created: false } });
    throw conflict('This email address is already linked to a different Firebase account');
  }

  const now = new Date();
  const created = {
    id: crypto.randomUUID(),
    externalSubject: identity.subject,
    email: identity.email,
    name: identity.name ?? fallbackName(identity.email),
    role: 'USER' as const,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await database.insert(users).values(created);
    return c.json({ data: { user: asAuthUser(created), created: true } });
  } catch (error) {
    // Unique constraints make concurrent first-login calls safe. Re-read the
    // resulting local account; a different subject for this email is a conflict.
    const existing = await database.query.users.findFirst({ where: eq(users.externalSubject, identity.subject) });
    if (existing) return c.json({ data: { user: asAuthUser(existing), created: false } });
    const collidingEmail = await database.query.users.findFirst({ where: eq(users.email, identity.email) });
    if (collidingEmail) throw conflict('This email address is already linked to a different Firebase account');
    throw error;
  }
});
