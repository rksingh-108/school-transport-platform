import { z } from 'zod';
import { SEVERITIES } from './safety-events';
import { AI_DETECTION_TYPES } from './ai-observations';

const MIN_CONFIDENCE_FLOOR = 0.5; // a policy may never drop below this — see docs/adr/0022, "defaults are conservative"
const MIN_CONFIDENCE_CEILING = 1;

/**
 * Registers (or replaces) this school's policy for one detection type.
 * Deliberately has no `schoolId`/`createdBy` — always the caller's own
 * tenant/principal. `type` is fixed at creation (mirrors SafetyRule/
 * BusDevice.deviceType) — a policy row is identified by its detection type
 * for its whole life; changing what type it governs would be indistinguishable
 * from creating a new policy. `enabled` is excluded here — a freshly-created
 * policy always starts disabled, matching SafetyRule's own convention; use
 * the dedicated enable endpoint to turn it on.
 */
export const createAiSafetyPolicySchema = z.object({
  detectionType: z.enum(AI_DETECTION_TYPES),
  minimumConfidence: z.coerce.number().min(MIN_CONFIDENCE_FLOOR).max(MIN_CONFIDENCE_CEILING),
  defaultSeverity: z.enum(SEVERITIES),
  requiresHumanReview: z.boolean().optional(),
});
export type CreateAiSafetyPolicyInput = z.infer<typeof createAiSafetyPolicySchema>;

/** Never includes `detectionType` or `enabled` — see the create schema's docstring and the dedicated enable/disable endpoints. */
export const updateAiSafetyPolicySchema = z.object({
  minimumConfidence: z.coerce.number().min(MIN_CONFIDENCE_FLOOR).max(MIN_CONFIDENCE_CEILING).optional(),
  defaultSeverity: z.enum(SEVERITIES).optional(),
  requiresHumanReview: z.boolean().optional(),
});
export type UpdateAiSafetyPolicyInput = z.infer<typeof updateAiSafetyPolicySchema>;

export const listAiSafetyPoliciesQuerySchema = z.object({
  detectionType: z.enum(AI_DETECTION_TYPES).optional(),
  enabled: z.coerce.boolean().optional(),
});
export type ListAiSafetyPoliciesQuery = z.infer<typeof listAiSafetyPoliciesQuerySchema>;
