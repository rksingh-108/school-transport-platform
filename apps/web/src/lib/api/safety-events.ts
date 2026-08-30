import type { CursorPage, SafetyEventDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

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

export interface SafetyEventListParams {
  limit?: number;
  cursor?: string;
  status?: string;
  severity?: string;
  type?: string;
  busId?: string;
  tripId?: string;
  from?: string;
  to?: string;
}

export async function listSafetyEvents(params: SafetyEventListParams = {}): Promise<CursorPage<SafetyEventDto>> {
  return apiFetch(`/safety-events${toQuery(params)}`);
}

export async function getSafetyEvent(id: string): Promise<SafetyEventDto> {
  return apiFetch(`/safety-events/${id}`);
}

export interface CreateSafetyEventInput {
  busId?: string;
  tripId?: string;
  cameraId?: string;
  type: (typeof SAFETY_EVENT_TYPES)[number];
  severity: (typeof SEVERITIES)[number];
  description?: string;
  occurredAt?: string;
}

export async function createSafetyEvent(input: CreateSafetyEventInput): Promise<SafetyEventDto> {
  return apiFetch('/safety-events', { method: 'POST', body: input });
}

export async function acknowledgeSafetyEvent(id: string): Promise<SafetyEventDto> {
  return apiFetch(`/safety-events/${id}/acknowledge`, { method: 'POST' });
}

export async function dismissSafetyEvent(id: string, resolutionNote?: string): Promise<SafetyEventDto> {
  return apiFetch(`/safety-events/${id}/dismiss`, { method: 'POST', body: { resolutionNote } });
}

export async function escalateSafetyEvent(id: string): Promise<SafetyEventDto> {
  return apiFetch(`/safety-events/${id}/escalate`, { method: 'POST' });
}

export async function resolveSafetyEvent(id: string, resolutionNote?: string): Promise<SafetyEventDto> {
  return apiFetch(`/safety-events/${id}/resolve`, { method: 'POST', body: { resolutionNote } });
}
