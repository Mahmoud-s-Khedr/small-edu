import { asc, eq } from 'drizzle-orm';
import { ApiRouter } from '../openapi';
import { db } from '../db/client';
import { paymentMethods } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { paymentMethodIdParam, paymentMethodInput, paymentMethodPatch } from '../lib/validation';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppBindings } from '../types';

function handleWriteError(error: unknown): never {
  // Drizzle wraps D1 errors; inspect the cause as well as the outer error.
  if (error instanceof Error && /UNIQUE constraint failed: payment_methods\.key/.test(
    `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}`,
  )) throw conflict('A payment method with this key already exists');
  throw error;
}

export const paymentMethodRoutes = new ApiRouter<AppBindings>('/payment-methods');
paymentMethodRoutes.use('*', requireAuth);

paymentMethodRoutes.get('/', async (c) => {
  const items = await db(c.env.DB).select().from(paymentMethods).orderBy(asc(paymentMethods.key));
  return c.json({ data: items });
});

paymentMethodRoutes.post('/', requireAdmin, async (c) => {
  const input = paymentMethodInput.parse(await c.req.json());
  const now = new Date();
  const item = { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now };
  try {
    await db(c.env.DB).insert(paymentMethods).values(item);
  } catch (error) {
    handleWriteError(error);
  }
  return c.json({ data: item }, 201);
});

paymentMethodRoutes.patch('/:paymentMethodId', requireAdmin, async (c) => {
  const { paymentMethodId } = paymentMethodIdParam.parse(c.req.param());
  const input = paymentMethodPatch.parse(await c.req.json());
  try {
    const [item] = await db(c.env.DB).update(paymentMethods).set({ ...input, updatedAt: new Date() })
      .where(eq(paymentMethods.id, paymentMethodId)).returning();
    if (!item) throw notFound('Payment method not found');
    return c.json({ data: item });
  } catch (error) {
    handleWriteError(error);
  }
});

paymentMethodRoutes.delete('/:paymentMethodId', requireAdmin, async (c) => {
  const [item] = await db(c.env.DB).delete(paymentMethods)
    .where(eq(paymentMethods.id, paymentMethodIdParam.parse(c.req.param()).paymentMethodId))
    .returning({ id: paymentMethods.id });
  if (!item) throw notFound('Payment method not found');
  return c.body(null, 204);
});
