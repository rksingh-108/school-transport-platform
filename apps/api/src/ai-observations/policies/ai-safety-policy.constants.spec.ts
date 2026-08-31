import { AI_DETECTION_TYPES } from '@school-transport/shared-schemas';
import { AI_DETECTION_TO_SAFETY_EVENT_TYPE, SYSTEM_DEFAULT_AI_SAFETY_POLICY } from './ai-safety-policy.constants';

const KNOWN_SAFETY_EVENT_TYPES = new Set([
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
  'ROUTE_DEVIATION',
  'GEOFENCE_ENTRY',
  'GEOFENCE_EXIT',
  'EXCESSIVE_SPEED',
  'UNEXPECTED_STOP',
]);

describe('AI_DETECTION_TO_SAFETY_EVENT_TYPE', () => {
  it('maps every detection type to a known, existing SafetyEventType — never an invented one', () => {
    for (const detectionType of AI_DETECTION_TYPES) {
      const mapped = AI_DETECTION_TO_SAFETY_EVENT_TYPE[detectionType];
      expect(mapped).toBeDefined();
      expect(KNOWN_SAFETY_EVENT_TYPES.has(mapped)).toBe(true);
    }
  });

  it('maps hazard-specific detections to their documented, distinct types', () => {
    expect(AI_DETECTION_TO_SAFETY_EVENT_TYPE.FALL_DETECTED).toBe('MEDICAL');
    expect(AI_DETECTION_TO_SAFETY_EVENT_TYPE.SMOKE_DETECTED).toBe('SMOKE_FIRE');
    expect(AI_DETECTION_TO_SAFETY_EVENT_TYPE.FIRE_DETECTED).toBe('SMOKE_FIRE');
    expect(AI_DETECTION_TO_SAFETY_EVENT_TYPE.DOOR_STATE_DETECTED).toBe('DOOR_OPEN');
  });
});

describe('SYSTEM_DEFAULT_AI_SAFETY_POLICY', () => {
  it('has a conservative default for every detection type', () => {
    for (const detectionType of AI_DETECTION_TYPES) {
      const policy = SYSTEM_DEFAULT_AI_SAFETY_POLICY[detectionType];
      expect(policy).toBeDefined();
      expect(policy.minimumConfidence).toBeGreaterThanOrEqual(0.5);
      expect(policy.minimumConfidence).toBeLessThanOrEqual(1);
      expect(policy.requiresHumanReview).toBe(true);
    }
  });

  it('disables promotion by default for detections not inherently indicative of a safety condition', () => {
    expect(SYSTEM_DEFAULT_AI_SAFETY_POLICY.PERSON_DETECTED.enabled).toBe(false);
    expect(SYSTEM_DEFAULT_AI_SAFETY_POLICY.PERSON_COUNT.enabled).toBe(false);
    expect(SYSTEM_DEFAULT_AI_SAFETY_POLICY.OBJECT_DETECTED.enabled).toBe(false);
  });

  it('enables promotion by default for the objective hazard/safety detections', () => {
    expect(SYSTEM_DEFAULT_AI_SAFETY_POLICY.FALL_DETECTED.enabled).toBe(true);
    expect(SYSTEM_DEFAULT_AI_SAFETY_POLICY.SMOKE_DETECTED.enabled).toBe(true);
    expect(SYSTEM_DEFAULT_AI_SAFETY_POLICY.FIRE_DETECTED.enabled).toBe(true);
    expect(SYSTEM_DEFAULT_AI_SAFETY_POLICY.DOOR_STATE_DETECTED.enabled).toBe(true);
  });
});
