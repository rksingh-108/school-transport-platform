import { z } from 'zod';

export const SAFETY_EVENT_TYPES = [
  'MANUAL_ALERT',
  'EMERGENCY_BUTTON',
  'CAMERA_ALERT',
  'DRIVER_ALERT',
  'ATTENDANT_ALERT',
  'DOOR_OPEN',
  'UNAUTHORIZED_ACCESS',
  'MEDICAL',
  'ACCIDENT',
  'FIGHTING',
  'SMOKE_FIRE',
  'OTHER',
] as const;

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const SAFETY_EVENT_STATUSES = ['NEW', 'ACKNOWLEDGED', 'DISMISSED', 'ESCALATED', 'RESOLVED'] as const;

/**
 * Deliberately has no `schoolId`/`createdBy`/`source`/`reviewedBy`/
 * `escalatedToEmergencyId` field — all server-determined
 * (SafetyEventsService). `busId`/`tripId`/`cameraId` are optional and
 * independently nullable; when supplied they are re-verified against the
 * caller's own tenant, and (for DRIVER/BUS_ATTENDANT) against their own
 * currently-assigned trip. `occurredAt` defaults to "now" if omitted — most
 * manual alerts are reported as they happen.
 */
export const createSafetyEventSchema = z.object({
  busId: z.string().uuid().optional(),
  tripId: z.string().uuid().optional(),
  cameraId: z.string().uuid().optional(),
  type: z.enum(SAFETY_EVENT_TYPES),
  severity: z.enum(SEVERITIES),
  description: z.string().max(2000).optional(),
  occurredAt: z.string().datetime().optional(),
  // Small, bounded, non-sensitive context only — never raw video/face/
  // biometric data (there is no schema shape here that could carry it).
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type CreateSafetyEventInput = z.infer<typeof createSafetyEventSchema>;

export const dismissSafetyEventSchema = z.object({ resolutionNote: z.string().max(2000).optional() });
export type DismissSafetyEventInput = z.infer<typeof dismissSafetyEventSchema>;

export const resolveSafetyEventSchema = z.object({ resolutionNote: z.string().max(2000).optional() });
export type ResolveSafetyEventInput = z.infer<typeof resolveSafetyEventSchema>;

export const listSafetyEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  status: z.enum(SAFETY_EVENT_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  type: z.enum(SAFETY_EVENT_TYPES).optional(),
  busId: z.string().uuid().optional(),
  tripId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ListSafetyEventsQuery = z.infer<typeof listSafetyEventsQuerySchema>;
