import { z } from 'zod';
import { SEVERITIES } from './safety-events';

export const SAFETY_RULE_TYPES = ['ROUTE_DEVIATION', 'GEOFENCE', 'SPEED', 'STOP'] as const;

// Bounded ranges — an operational rule, not a legal claim (no speed limit is
// ever implied or asserted). See
// docs/adr/0020-geofencing-and-operational-safety-rules.md.
const THRESHOLD_METERS_MIN = 10;
const THRESHOLD_METERS_MAX = 5000;
const THRESHOLD_SPEED_KMH_MIN = 1;
const THRESHOLD_SPEED_KMH_MAX = 200;
const MIN_CONSECUTIVE_POINTS_MIN = 1;
const MIN_CONSECUTIVE_POINTS_MAX = 20;
const COOLDOWN_SECONDS_MIN = 30;
const COOLDOWN_SECONDS_MAX = 86400;

const sharedRuleFields = {
  severity: z.enum(SEVERITIES),
  geofenceId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  busId: z.string().uuid().optional(),
  thresholdMeters: z.coerce.number().int().min(THRESHOLD_METERS_MIN).max(THRESHOLD_METERS_MAX).optional(),
  thresholdSpeedKmh: z.coerce.number().int().min(THRESHOLD_SPEED_KMH_MIN).max(THRESHOLD_SPEED_KMH_MAX).optional(),
  minConsecutivePoints: z.coerce.number().int().min(MIN_CONSECUTIVE_POINTS_MIN).max(MIN_CONSECUTIVE_POINTS_MAX).optional(),
  cooldownSeconds: z.coerce.number().int().min(COOLDOWN_SECONDS_MIN).max(COOLDOWN_SECONDS_MAX).optional(),
};

/**
 * `type` is fixed at creation, never updatable — same convention as
 * BusDevice.deviceType. Each type requires the field(s) it actually reads
 * (validated here, not just documented): `GEOFENCE` needs `geofenceId`;
 * `ROUTE_DEVIATION` needs `thresholdMeters`; `SPEED` needs
 * `thresholdSpeedKmh`; `STOP` needs both (max-stationary-speed and
 * min-distance-from-any-stop — see OperationalSafetyService). `routeId`/
 * `busId` optionally narrow which trips a rule applies to; omitting both
 * means "every trip in the school." No `schoolId`/`createdBy`/`enabled`
 * field — tenant and actor are always server-derived, and `enabled` is only
 * ever set via the dedicated enable/disable endpoints.
 */
export const createSafetyRuleSchema = z
  .object({
    type: z.enum(SAFETY_RULE_TYPES),
    ...sharedRuleFields,
  })
  .refine((v) => v.type !== 'GEOFENCE' || !!v.geofenceId, {
    message: 'geofenceId is required for a GEOFENCE rule.',
    path: ['geofenceId'],
  })
  .refine((v) => v.type !== 'ROUTE_DEVIATION' || v.thresholdMeters !== undefined, {
    message: 'thresholdMeters is required for a ROUTE_DEVIATION rule.',
    path: ['thresholdMeters'],
  })
  .refine((v) => v.type !== 'SPEED' || v.thresholdSpeedKmh !== undefined, {
    message: 'thresholdSpeedKmh is required for a SPEED rule.',
    path: ['thresholdSpeedKmh'],
  })
  .refine((v) => v.type !== 'STOP' || (v.thresholdSpeedKmh !== undefined && v.thresholdMeters !== undefined), {
    message: 'thresholdSpeedKmh (max stationary speed) and thresholdMeters (min distance from any stop) are both required for a STOP rule.',
    path: ['thresholdSpeedKmh'],
  });
export type CreateSafetyRuleInput = z.infer<typeof createSafetyRuleSchema>;

export const updateSafetyRuleSchema = z.object(sharedRuleFields);
export type UpdateSafetyRuleInput = z.infer<typeof updateSafetyRuleSchema>;

export const listSafetyRulesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  type: z.enum(SAFETY_RULE_TYPES).optional(),
  enabled: z.coerce.boolean().optional(),
  busId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
});
export type ListSafetyRulesQuery = z.infer<typeof listSafetyRulesQuerySchema>;
