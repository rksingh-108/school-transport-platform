import type { AIObservationDto, CursorPage } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export const AI_DETECTION_TYPES = [
  'PERSON_DETECTED',
  'PERSON_COUNT',
  'OBJECT_DETECTED',
  'FALL_DETECTED',
  'SMOKE_DETECTED',
  'FIRE_DETECTED',
  'DOOR_STATE_DETECTED',
  'UNUSUAL_MOTION',
] as const;
export const AI_OBSERVATION_STATUSES = ['CANDIDATE', 'REVIEWED', 'DISMISSED', 'PROMOTED'] as const;

export interface AiObservationListParams {
  limit?: number;
  cursor?: string;
  detectionType?: string;
  status?: string;
  busId?: string;
  cameraId?: string;
  minConfidence?: number;
  from?: string;
  to?: string;
}

export async function listAiObservations(params: AiObservationListParams = {}): Promise<CursorPage<AIObservationDto>> {
  return apiFetch(`/ai-observations${toQuery(params)}`);
}

export async function getAiObservation(id: string): Promise<AIObservationDto> {
  return apiFetch(`/ai-observations/${id}`);
}

export interface AiProviderStatus {
  status: 'AI_NOT_CONFIGURED' | 'AI_READY';
  message: string;
}

export async function getAiProviderStatus(): Promise<AiProviderStatus> {
  return apiFetch('/ai-observations/provider-status');
}
