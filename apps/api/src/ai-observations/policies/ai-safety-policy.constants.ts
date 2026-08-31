import type { AIObservationDto, SafetyEventDto } from '@school-transport/shared-types';

type DetectionType = AIObservationDto['detectionType'];
type SafetyEventType = SafetyEventDto['type'];
type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * A fixed, hardcoded, documented mapping from AI detection type to
 * SafetyEvent type — deliberately NOT school-configurable and NOT a
 * generic rules engine (see docs/adr/0022-ai-observation-review-and-safety-analytics.md's
 * "safety event type mapping" decision). Every value here is an EXISTING
 * SafetyEventType — no new type is invented for this step.
 *
 * PERSON_DETECTED/PERSON_COUNT/OBJECT_DETECTED map to OTHER because they
 * are not, by themselves, evidence of any specific safety condition (a
 * person being detected on a school bus is the expected case) — see
 * `SYSTEM_DEFAULT_AI_SAFETY_POLICY` below, which additionally disables
 * promotion for these three by default. The mapping still exists so a
 * school that deliberately opts in (e.g. "flag any person detected outside
 * scheduled hours") has a real, existing type to land on rather than a
 * missing-mapping error.
 */
export const AI_DETECTION_TO_SAFETY_EVENT_TYPE: Record<DetectionType, SafetyEventType> = {
  FALL_DETECTED: 'MEDICAL',
  SMOKE_DETECTED: 'SMOKE_FIRE',
  FIRE_DETECTED: 'SMOKE_FIRE',
  DOOR_STATE_DETECTED: 'DOOR_OPEN',
  UNUSUAL_MOTION: 'OTHER',
  PERSON_DETECTED: 'OTHER',
  PERSON_COUNT: 'OTHER',
  OBJECT_DETECTED: 'OTHER',
};

export interface AiSafetyPolicyValues {
  enabled: boolean;
  minimumConfidence: number;
  defaultSeverity: SeverityLevel;
  requiresHumanReview: boolean;
}

/**
 * Conservative system defaults, used only when a school has no
 * `AiSafetyPolicy` row for a given detection type — see the "defaults"
 * decision in the ADR. `PERSON_DETECTED`/`PERSON_COUNT`/`OBJECT_DETECTED`
 * default to `enabled: false` (not promotable at all) since, per the
 * step's own instruction, these are "normally NOT promotable by itself."
 * `requiresHumanReview` is always `true` here — see the schema comment on
 * `AiSafetyPolicy.requiresHumanReview` for why this field's value never
 * actually changes that unconditional guarantee in this codebase.
 */
export const SYSTEM_DEFAULT_AI_SAFETY_POLICY: Record<DetectionType, AiSafetyPolicyValues> = {
  FALL_DETECTED: { enabled: true, minimumConfidence: 0.85, defaultSeverity: 'HIGH', requiresHumanReview: true },
  SMOKE_DETECTED: { enabled: true, minimumConfidence: 0.8, defaultSeverity: 'CRITICAL', requiresHumanReview: true },
  FIRE_DETECTED: { enabled: true, minimumConfidence: 0.8, defaultSeverity: 'CRITICAL', requiresHumanReview: true },
  DOOR_STATE_DETECTED: { enabled: true, minimumConfidence: 0.75, defaultSeverity: 'MEDIUM', requiresHumanReview: true },
  UNUSUAL_MOTION: { enabled: true, minimumConfidence: 0.7, defaultSeverity: 'LOW', requiresHumanReview: true },
  PERSON_DETECTED: { enabled: false, minimumConfidence: 0.9, defaultSeverity: 'LOW', requiresHumanReview: true },
  PERSON_COUNT: { enabled: false, minimumConfidence: 0.9, defaultSeverity: 'LOW', requiresHumanReview: true },
  OBJECT_DETECTED: { enabled: false, minimumConfidence: 0.9, defaultSeverity: 'LOW', requiresHumanReview: true },
};
