import type { CursorPage, RouteDto, RouteStopDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export interface RouteListParams {
  limit?: number;
  cursor?: string;
  search?: string;
  status?: string;
  direction?: string;
}

export async function listRoutes(params: RouteListParams = {}): Promise<CursorPage<RouteDto>> {
  return apiFetch(`/routes${toQuery(params)}`);
}

export async function getRoute(id: string): Promise<RouteDto> {
  return apiFetch(`/routes/${id}`);
}

export interface RouteInput {
  code?: string;
  name: string;
  direction: 'HOME_TO_SCHOOL' | 'SCHOOL_TO_HOME';
  shift: 'MORNING_PICKUP' | 'AFTERNOON_DROP' | 'CUSTOM';
  description?: string;
}

export async function createRoute(input: RouteInput): Promise<RouteDto> {
  return apiFetch('/routes', { method: 'POST', body: input });
}

export async function updateRoute(
  id: string,
  input: Partial<RouteInput> & { status?: 'ACTIVE' | 'INACTIVE' },
): Promise<RouteDto> {
  return apiFetch(`/routes/${id}`, { method: 'PATCH', body: input });
}

export async function archiveRoute(id: string): Promise<RouteDto> {
  return apiFetch(`/routes/${id}/archive`, { method: 'POST' });
}

export async function listStops(routeId: string): Promise<RouteStopDto[]> {
  return apiFetch(`/routes/${routeId}/stops`);
}

export interface StopInput {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  sequenceNo: number;
  expectedOffsetMinutes: number;
  radiusMeters?: number;
  mode?: 'PICKUP' | 'DROPOFF' | 'BOTH';
}

export async function createStop(routeId: string, input: StopInput): Promise<RouteStopDto> {
  return apiFetch(`/routes/${routeId}/stops`, { method: 'POST', body: input });
}

export async function updateStop(
  id: string,
  input: Partial<Omit<StopInput, 'sequenceNo'>> & { status?: 'ACTIVE' | 'INACTIVE' },
): Promise<RouteStopDto> {
  return apiFetch(`/stops/${id}`, { method: 'PATCH', body: input });
}

export async function reorderStops(routeId: string, stopIds: string[]): Promise<RouteStopDto[]> {
  return apiFetch(`/routes/${routeId}/stops/reorder`, { method: 'POST', body: { stopIds } });
}

export async function deleteStop(id: string): Promise<void> {
  await apiFetch(`/stops/${id}`, { method: 'DELETE' });
}
