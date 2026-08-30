import { z } from 'zod';

export const ROUTE_DIRECTIONS = ['HOME_TO_SCHOOL', 'SCHOOL_TO_HOME'] as const;
export const ROUTE_SHIFTS = ['MORNING_PICKUP', 'AFTERNOON_DROP', 'CUSTOM'] as const;
export const ROUTE_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
/** Settable via PATCH — excludes ARCHIVED, which is only ever set by POST /routes/:id/archive. */
const patchableRouteStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

/**
 * Deliberately has no `schoolId` field — a route's tenant is fixed at
 * creation from the caller's own authenticated context, same structural
 * tenant lock as buses/students. No `busId`/`driverId`/`attendantId`
 * field either — a Route is never bound to a specific vehicle or crew;
 * that's the future Trip model's job.
 */
export const createRouteSchema = z.object({
  code: z.string().max(50).optional(),
  name: z.string().min(1).max(200),
  direction: z.enum(ROUTE_DIRECTIONS),
  shift: z.enum(ROUTE_SHIFTS),
  description: z.string().max(2000).optional(),
});
export type CreateRouteInput = z.infer<typeof createRouteSchema>;

export const updateRouteSchema = z.object({
  code: z.string().max(50).optional(),
  name: z.string().min(1).max(200).optional(),
  direction: z.enum(ROUTE_DIRECTIONS).optional(),
  shift: z.enum(ROUTE_SHIFTS).optional(),
  status: patchableRouteStatusSchema.optional(),
  description: z.string().max(2000).optional(),
});
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;

export const listRoutesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  status: z.enum(ROUTE_STATUSES).optional(),
  direction: z.enum(ROUTE_DIRECTIONS).optional(),
});
export type ListRoutesQuery = z.infer<typeof listRoutesQuerySchema>;
