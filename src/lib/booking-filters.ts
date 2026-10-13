import { z } from '@hono/zod-openapi';
import { paginationQuery } from './pagination';

const bookingDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

// Calendar dates cover the full UTC day; timestamps identify an exact instant.
export function bookingDateBoundary(value: string, end = false): Date {
  return new Date(value.length === 10 ? `${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : value);
}

const filterFields = {
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional(),
  from: bookingDate.optional().describe('Inclusive createdAt lower bound: YYYY-MM-DD (UTC) or ISO timestamp with timezone'),
  to: bookingDate.optional().describe('Inclusive createdAt upper bound: YYYY-MM-DD (full UTC day) or ISO timestamp with timezone'),
};

function validRange(query: { from?: string; to?: string }): boolean {
  return !query.from || !query.to || bookingDateBoundary(query.from) <= bookingDateBoundary(query.to, true);
}

const rangeError = { message: 'from must be on or before to', path: ['to'] };
export const bookingFilters = z.object(filterFields).refine(validRange, rangeError);
export const adminBookingFilters = paginationQuery.extend(filterFields).refine(validRange, rangeError);
