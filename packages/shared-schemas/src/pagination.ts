import { z } from 'zod';

/**
 * Cursor pagination query params, per docs/api.md#1-conventions
 * (`?limit=25&cursor=<opaque>`). The cursor is an entity id (UUID) — opaque
 * to the client, not meant to be constructed by hand.
 */
export const cursorPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});
export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;
