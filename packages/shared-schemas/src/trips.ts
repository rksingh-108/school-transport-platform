import { z } from 'zod';

export const TRIP_STATUSES = ['SCHEDULED', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;

/** 24-hour "HH:mm" wall-clock time — deliberately not a Date/DateTime; see the ADR. */
const wallClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Expected HH:mm (24-hour)');

/**
 * Deliberately has no `schoolId` or `shift` field — schoolId is fixed from
 * the caller's tenant context; shift is derived from the route (a trip's
 * shift must match the route it executes, so it is never independently
 * specified). No `status` field either — every trip starts SCHEDULED.
 */
export const createTripSchema = z
  .object({
    routeId: z.string().uuid(),
    busId: z.string().uuid(),
    driverId: z.string().uuid(),
    attendantId: z.string().uuid().optional(),
    serviceDate: z.string().date(),
    scheduledStartTime: wallClockTimeSchema,
    scheduledEndTime: wallClockTimeSchema,
    notes: z.string().max(2000).optional(),
  })
  .refine((data) => data.scheduledEndTime > data.scheduledStartTime, {
    message: 'scheduledEndTime must be after scheduledStartTime',
    path: ['scheduledEndTime'],
  });
export type CreateTripInput = z.infer<typeof createTripSchema>;

/**
 * `routeId` is intentionally absent — a trip's route is fixed at creation
 * (a different route is a different trip, not an edit of this one).
 * `attendantId: null` explicitly removes an assigned attendant.
 */
export const updateTripSchema = z
  .object({
    busId: z.string().uuid().optional(),
    driverId: z.string().uuid().optional(),
    attendantId: z.string().uuid().nullable().optional(),
    serviceDate: z.string().date().optional(),
    scheduledStartTime: wallClockTimeSchema.optional(),
    scheduledEndTime: wallClockTimeSchema.optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((data) => !data.scheduledStartTime || !data.scheduledEndTime || data.scheduledEndTime > data.scheduledStartTime, {
    message: 'scheduledEndTime must be after scheduledStartTime',
    path: ['scheduledEndTime'],
  });
export type UpdateTripInput = z.infer<typeof updateTripSchema>;

export const cancelTripSchema = z.object({
  reason: z.string().min(1).max(1000),
});
export type CancelTripInput = z.infer<typeof cancelTripSchema>;

export const noShowTripSchema = z.object({
  reason: z.string().min(1).max(1000),
});
export type NoShowTripInput = z.infer<typeof noShowTripSchema>;

export const listTripsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  serviceDate: z.string().date().optional(),
  routeId: z.string().uuid().optional(),
  status: z.enum(TRIP_STATUSES).optional(),
  busId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
});
export type ListTripsQuery = z.infer<typeof listTripsQuerySchema>;

/**
 * At least one of pickup/dropoff must be set — an entry with neither
 * records nothing operationally useful. Either may be omitted/null to mean
 * "the school itself" (a route's implicit terminus, never modeled as a
 * stop) — see docs/api.md's trips section.
 */
export const createTripStudentSchema = z
  .object({
    studentId: z.string().uuid(),
    pickupTripStopId: z.string().uuid().nullable().optional(),
    dropoffTripStopId: z.string().uuid().nullable().optional(),
    notes: z.string().max(1000).optional(),
  })
  .refine((data) => Boolean(data.pickupTripStopId) || Boolean(data.dropoffTripStopId), {
    message: 'At least one of pickupTripStopId or dropoffTripStopId is required',
    path: ['pickupTripStopId'],
  });
export type CreateTripStudentInput = z.infer<typeof createTripStudentSchema>;

export const updateTripStudentSchema = z.object({
  pickupTripStopId: z.string().uuid().nullable().optional(),
  dropoffTripStopId: z.string().uuid().nullable().optional(),
  notes: z.string().max(1000).optional(),
});
export type UpdateTripStudentInput = z.infer<typeof updateTripStudentSchema>;
