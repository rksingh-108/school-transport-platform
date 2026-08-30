import { z } from 'zod';

export const STOP_MODES = ['PICKUP', 'DROPOFF', 'BOTH'] as const;
export const STOP_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

const latitudeSchema = z.coerce.number().finite().min(-90).max(90);
const longitudeSchema = z.coerce.number().finite().min(-180).max(180);

/**
 * Deliberately has no `schoolId` field (fixed from the caller's tenant
 * context) and no `sequenceNo` field on update — sequence only ever changes
 * through the dedicated atomic reorder endpoint, never a plain field edit,
 * so there is exactly one code path that can produce a duplicate-sequence
 * conflict to guard against.
 */
export const createStopSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  sequenceNo: z.coerce.number().int().min(1),
  expectedOffsetMinutes: z.coerce.number().int().min(0).max(1440),
  radiusMeters: z.coerce.number().int().min(10).max(2000).optional(),
  mode: z.enum(STOP_MODES).optional(),
});
export type CreateStopInput = z.infer<typeof createStopSchema>;

export const updateStopSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(500).optional(),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  expectedOffsetMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  radiusMeters: z.coerce.number().int().min(10).max(2000).optional(),
  mode: z.enum(STOP_MODES).optional(),
  status: z.enum(STOP_STATUSES).optional(),
});
export type UpdateStopInput = z.infer<typeof updateStopSchema>;

/** Full reorder — every stop id currently on the route, in its new sequence order (index 0 becomes sequenceNo 1). */
export const reorderStopsSchema = z.object({
  stopIds: z.array(z.string().uuid()).min(1),
});
export type ReorderStopsInput = z.infer<typeof reorderStopsSchema>;
