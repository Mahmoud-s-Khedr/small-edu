import { z } from 'zod';

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const pagination = ({ page, pageSize }: z.infer<typeof paginationQuery>) => ({
  limit: pageSize,
  offset: (page - 1) * pageSize,
  page,
  pageSize,
});
