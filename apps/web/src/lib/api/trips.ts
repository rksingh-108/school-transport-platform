import type { CursorPage, TripDto, TripStopDto, TripStudentDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export interface TripListParams {
  limit?: number;
  cursor?: string;
  serviceDate?: string;
  routeId?: string;
  status?: string;
  busId?: string;
  driverId?: string;
}

export async function listTrips(params: TripListParams = {}): Promise<CursorPage<TripDto>> {
  return apiFetch(`/trips${toQuery(params)}`);
}

export async function getTrip(id: string): Promise<TripDto> {
  return apiFetch(`/trips/${id}`);
}

export async function listTripStops(tripId: string): Promise<TripStopDto[]> {
  return apiFetch(`/trips/${tripId}/stops`);
}

export interface TripInput {
  routeId: string;
  busId: string;
  driverId: string;
  attendantId?: string;
  serviceDate: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  notes?: string;
}

export async function createTrip(input: TripInput): Promise<TripDto> {
  return apiFetch('/trips', { method: 'POST', body: input });
}

export async function updateTrip(
  id: string,
  input: Partial<Omit<TripInput, 'routeId' | 'attendantId'>> & { attendantId?: string | null },
): Promise<TripDto> {
  return apiFetch(`/trips/${id}`, { method: 'PATCH', body: input });
}

export async function readyTrip(id: string): Promise<TripDto> {
  return apiFetch(`/trips/${id}/ready`, { method: 'POST' });
}

export async function startTrip(id: string): Promise<TripDto> {
  return apiFetch(`/trips/${id}/start`, { method: 'POST' });
}

export async function completeTrip(id: string): Promise<TripDto> {
  return apiFetch(`/trips/${id}/complete`, { method: 'POST' });
}

export async function cancelTrip(id: string, reason: string): Promise<TripDto> {
  return apiFetch(`/trips/${id}/cancel`, { method: 'POST', body: { reason } });
}

export async function noShowTrip(id: string, reason: string): Promise<TripDto> {
  return apiFetch(`/trips/${id}/no-show`, { method: 'POST', body: { reason } });
}

export async function listManifest(tripId: string): Promise<TripStudentDto[]> {
  return apiFetch(`/trips/${tripId}/students`);
}

export interface TripStudentInput {
  studentId: string;
  pickupTripStopId?: string | null;
  dropoffTripStopId?: string | null;
  notes?: string;
}

export async function addTripStudent(tripId: string, input: TripStudentInput): Promise<TripStudentDto> {
  return apiFetch(`/trips/${tripId}/students`, { method: 'POST', body: input });
}

export async function updateTripStudent(
  tripId: string,
  tripStudentId: string,
  input: Partial<Omit<TripStudentInput, 'studentId'>>,
): Promise<TripStudentDto> {
  return apiFetch(`/trips/${tripId}/students/${tripStudentId}`, { method: 'PATCH', body: input });
}

export async function removeTripStudent(tripId: string, tripStudentId: string): Promise<void> {
  await apiFetch(`/trips/${tripId}/students/${tripStudentId}`, { method: 'DELETE' });
}
