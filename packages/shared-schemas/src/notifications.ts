import { z } from 'zod';

/** No filters beyond pagination — a notification list is already scoped entirely to the caller's own identity server-side; there is nothing else safe for a client to filter by. */
export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
