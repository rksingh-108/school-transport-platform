import type { AiSafetyPolicyDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

export const AI_SAFETY_POLICY_DETECTION_TYPES = [
  'PERSON_DETECTED',
  'PERSON_COUNT',
  'OBJECT_DETECTED',
  'FALL_DETECTED',
  'SMOKE_DETECTED',
  'FIRE_DETECTED',
  'DOOR_STATE_DETECTED',
  'UNUSUAL_MOTION',
] as const;

export async function listAiSafetyPolicies(): Promise<AiSafetyPolicyDto[]> {
  return apiFetch('/ai-safety-policies');
}

export interface AiSafetyPolicyInput {
  detectionType: (typeof AI_SAFETY_POLICY_DETECTION_TYPES)[number];
  minimumConfidence: number;
  defaultSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requiresHumanReview?: boolean;
}

export async function createAiSafetyPolicy(input: AiSafetyPolicyInput): Promise<AiSafetyPolicyDto> {
  return apiFetch('/ai-safety-policies', { method: 'POST', body: input });
}

export async function updateAiSafetyPolicy(id: string, input: Partial<Omit<AiSafetyPolicyInput, 'detectionType'>>): Promise<AiSafetyPolicyDto> {
  return apiFetch(`/ai-safety-policies/${id}`, { method: 'PATCH', body: input });
}

export async function enableAiSafetyPolicy(id: string): Promise<AiSafetyPolicyDto> {
  return apiFetch(`/ai-safety-policies/${id}/enable`, { method: 'POST' });
}

export async function disableAiSafetyPolicy(id: string): Promise<AiSafetyPolicyDto> {
  return apiFetch(`/ai-safety-policies/${id}/disable`, { method: 'POST' });
}
