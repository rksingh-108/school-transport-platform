import { z } from 'zod';
import { SEVERITIES } from './safety-events';

export const EMERGENCY_STATUSES = ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'] as const;

export const EMERGENCY_ACTION_TYPES = [
  'ACKNOWLEDGED',
  'CALLED_CONTACT',
  'CONTACTED_SCHOOL',
  'CONTACTED_EMERGENCY_SERVICE',
  'DISPATCHED_HELP',
  'RESOLVED',
  'OTHER',
] as const;

/**
 * No `schoolId`/`initiatedBy` field — always server-resolved
 * (EmergenciesService). `busId`/`tripId` are optional; for DRIVER/
 * BUS_ATTENDANT they are auto-filled from the caller's own currently
 * in-progress trip when omitted, and rejected if they don't match it when
 * supplied. `severity` defaults to `CRITICAL` in the service if omitted —
 * triggering an emergency is inherently high-urgency.
 */
export const triggerEmergencySchema = z.object({
  busId: z.string().uuid().optional(),
  tripId: z.string().uuid().optional(),
  severity: z.enum(SEVERITIES).optional(),
  reason: z.string().max(2000).optional(),
});
export type TriggerEmergencyInput = z.infer<typeof triggerEmergencySchema>;

/**
 * `CONTACTED_EMERGENCY_SERVICE` records only that an operator logged having
 * made contact themselves — this platform never actually contacts an
 * external service (see docs/adr/0019-safety-events-and-emergency-management.md).
 */
export const addEmergencyActionSchema = z.object({
  actionType: z.enum(EMERGENCY_ACTION_TYPES),
  note: z.string().max(2000).optional(),
});
export type AddEmergencyActionInput = z.infer<typeof addEmergencyActionSchema>;

export const resolveEmergencySchema = z.object({ resolutionNote: z.string().max(2000).optional() });
export type ResolveEmergencyInput = z.infer<typeof resolveEmergencySchema>;

export const cancelEmergencySchema = z.object({ resolutionNote: z.string().max(2000).optional() });
export type CancelEmergencyInput = z.infer<typeof cancelEmergencySchema>;

export const listEmergenciesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  status: z.enum(EMERGENCY_STATUSES).optional(),
  busId: z.string().uuid().optional(),
  tripId: z.string().uuid().optional(),
});
export type ListEmergenciesQuery = z.infer<typeof listEmergenciesQuerySchema>;
