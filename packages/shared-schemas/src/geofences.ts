import { z } from 'zod';

export const GEOFENCE_TYPES = ['SCHOOL', 'DEPOT', 'CUSTOM'] as const;
export const GEOFENCE_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
/** Settable via PATCH — excludes ARCHIVED, which is only ever set by POST /geofences/:id/archive. */
const patchableGeofenceStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

// Bounded, not arbitrary — a 10m radius is the smallest that tolerates
// ordinary consumer-GPS jitter; 5km keeps a single zone from swallowing an
// entire district (docs/adr/0020-geofencing-and-operational-safety-rules.md).
const RADIUS_METERS_MIN = 10;
const RADIUS_METERS_MAX = 5000;

/**
 * Deliberately has no `schoolId` field — always the caller's own tenant.
 * There is no `stopId`/route-stop association here: a "stop geofence" is
 * `RouteStop.latitude/longitude/radiusMeters`, which already exists — see
 * the ADR for why GeofenceType has no STOP value.
 */
export const createGeofenceSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(GEOFENCE_TYPES),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().int().min(RADIUS_METERS_MIN).max(RADIUS_METERS_MAX),
});
export type CreateGeofenceInput = z.infer<typeof createGeofenceSchema>;

export const updateGeofenceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(GEOFENCE_TYPES).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusMeters: z.coerce.number().int().min(RADIUS_METERS_MIN).max(RADIUS_METERS_MAX).optional(),
  status: patchableGeofenceStatusSchema.optional(),
});
export type UpdateGeofenceInput = z.infer<typeof updateGeofenceSchema>;

export const listGeofencesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  status: z.enum(GEOFENCE_STATUSES).optional(),
  type: z.enum(GEOFENCE_TYPES).optional(),
});
export type ListGeofencesQuery = z.infer<typeof listGeofencesQuerySchema>;
