import type { TripStudentDto, AttendanceEventDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

export async function boardStudent(tripId: string, tripStudentId: string, notes?: string): Promise<TripStudentDto> {
  return apiFetch(`/trips/${tripId}/students/${tripStudentId}/board`, { method: 'POST', body: { notes } });
}

export async function dropOffStudent(tripId: string, tripStudentId: string, notes?: string): Promise<TripStudentDto> {
  return apiFetch(`/trips/${tripId}/students/${tripStudentId}/dropoff`, { method: 'POST', body: { notes } });
}

export async function markStudentAbsent(tripId: string, tripStudentId: string, notes?: string): Promise<TripStudentDto> {
  return apiFetch(`/trips/${tripId}/students/${tripStudentId}/absent`, { method: 'POST', body: { notes } });
}

export async function getAttendanceHistory(tripId: string, tripStudentId: string): Promise<AttendanceEventDto[]> {
  return apiFetch(`/trips/${tripId}/students/${tripStudentId}/attendance`);
}

export async function correctAttendanceEvent(
  tripId: string,
  tripStudentId: string,
  eventId: string,
  input: { eventType: 'BOARDING_CONFIRMED' | 'DROPPED_OFF' | 'MARKED_ABSENT'; occurredAt?: string; notes?: string },
): Promise<TripStudentDto> {
  return apiFetch(`/trips/${tripId}/students/${tripStudentId}/attendance/${eventId}/correct`, { method: 'POST', body: input });
}
