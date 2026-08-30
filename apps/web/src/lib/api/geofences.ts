import type { CursorPage, GeofenceDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export const GEOFENCE_TYPES = ['SCHOOL', 'DEPOT', 'CUSTOM'] as const;

export interface GeofenceListParams {
  limit?: number;
  cursor?: string;
  status?: string;
  type?: string;
}

export async function listGeofences(params: GeofenceListParams = {}): Promise<CursorPage<GeofenceDto>> {
  return apiFetch(`/geofences${toQuery(params)}`);
}

export async function getGeofence(id: string): Promise<GeofenceDto> {
  return apiFetch(`/geofences/${id}`);
}

export interface GeofenceInput {
  name: string;
  type: (typeof GEOFENCE_TYPES)[number];
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export async function createGeofence(input: GeofenceInput): Promise<GeofenceDto> {
  return apiFetch('/geofences', { method: 'POST', body: input });
}

export async function updateGeofence(id: string, input: Partial<GeofenceInput> & { status?: 'ACTIVE' | 'INACTIVE' }): Promise<GeofenceDto> {
  return apiFetch(`/geofences/${id}`, { method: 'PATCH', body: input });
}

export async function archiveGeofence(id: string): Promise<GeofenceDto> {
  return apiFetch(`/geofences/${id}/archive`, { method: 'POST' });
}
