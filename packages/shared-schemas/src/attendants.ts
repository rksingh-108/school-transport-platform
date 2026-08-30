import { z } from 'zod';

/** Same principle as drivers — attaches a profile to an existing staff user, never creates one. */
export const createAttendantSchema = z.object({
  userId: z.string().uuid(),
});
export type CreateAttendantInput = z.infer<typeof createAttendantSchema>;

export const listAttendantsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type ListAttendantsQuery = z.infer<typeof listAttendantsQuerySchema>;
