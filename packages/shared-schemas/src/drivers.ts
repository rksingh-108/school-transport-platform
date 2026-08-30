import { z } from 'zod';

/**
 * Attaches a transport-specific profile to an EXISTING staff user
 * (`userId`) — this endpoint never creates a User or sets a password;
 * onboarding a new person as staff goes through the existing invite flow
 * (`POST /users/invite`) first. See docs/database.md's User/Driver-profile
 * separation note.
 */
export const createDriverSchema = z.object({
  userId: z.string().uuid(),
  licenseNumber: z.string().min(1).max(50),
  licenseExpiry: z.string().date().optional(),
});
export type CreateDriverInput = z.infer<typeof createDriverSchema>;

export const updateDriverSchema = z.object({
  licenseNumber: z.string().min(1).max(50).optional(),
  licenseExpiry: z.string().date().optional(),
});
export type UpdateDriverInput = z.infer<typeof updateDriverSchema>;

export const listDriversQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type ListDriversQuery = z.infer<typeof listDriversQuerySchema>;
