import type { CursorPage, EmergencyDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export const EMERGENCY_ACTION_TYPES = [
  'ACKNOWLEDGED',
  'CALLED_CONTACT',
  'CONTACTED_SCHOOL',
  'CONTACTED_EMERGENCY_SERVICE',
  'DISPATCHED_HELP',
  'RESOLVED',
  'OTHER',
] as const;

export interface EmergencyListParams {
  limit?: number;
  cursor?: string;
  status?: string;
  busId?: string;
  tripId?: string;
}

export async function listEmergencies(params: EmergencyListParams = {}): Promise<CursorPage<EmergencyDto>> {
  return apiFetch(`/emergencies${toQuery(params)}`);
}

export async function getEmergency(id: string): Promise<EmergencyDto> {
  return apiFetch(`/emergencies/${id}`);
}

export async function triggerEmergency(input: { busId?: string; tripId?: string; severity?: string; reason?: string } = {}): Promise<EmergencyDto> {
  return apiFetch('/emergencies', { method: 'POST', body: input });
}

export async function acknowledgeEmergency(id: string): Promise<EmergencyDto> {
  return apiFetch(`/emergencies/${id}/acknowledge`, { method: 'POST' });
}

export async function addEmergencyAction(id: string, actionType: (typeof EMERGENCY_ACTION_TYPES)[number], note?: string): Promise<EmergencyDto> {
  return apiFetch(`/emergencies/${id}/actions`, { method: 'POST', body: { actionType, note } });
}

export async function resolveEmergency(id: string, resolutionNote?: string): Promise<EmergencyDto> {
  return apiFetch(`/emergencies/${id}/resolve`, { method: 'POST', body: { resolutionNote } });
}

export async function cancelEmergency(id: string, resolutionNote?: string): Promise<EmergencyDto> {
  return apiFetch(`/emergencies/${id}/cancel`, { method: 'POST', body: { resolutionNote } });
}
