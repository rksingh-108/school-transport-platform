import { z } from 'zod';

/**
 * Normal boarding/drop-off/absence actions never accept a client-supplied
 * timestamp — the server always uses "now" (docs/adr/0013). Only a
 * correction may specify an explicit `occurredAt`, since fixing the
 * recorded time is the whole point of a correction.
 */
export const recordAttendanceSchema = z.object({
  notes: z.string().max(1000).optional(),
});
export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;

export const CORRECTABLE_EVENT_TYPES = ['BOARDING_CONFIRMED', 'DROPPED_OFF', 'MARKED_ABSENT'] as const;

export const correctAttendanceSchema = z.object({
  eventType: z.enum(CORRECTABLE_EVENT_TYPES),
  occurredAt: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});
export type CorrectAttendanceInput = z.infer<typeof correctAttendanceSchema>;
