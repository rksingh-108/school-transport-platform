import type { CursorPage, AttendantDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export interface AttendantListParams {
  limit?: number;
  cursor?: string;
  search?: string;
  status?: string;
}

export async function listAttendants(params: AttendantListParams = {}): Promise<CursorPage<AttendantDto>> {
  return apiFetch(`/attendants${toQuery(params)}`);
}

export async function getAttendant(id: string): Promise<AttendantDto> {
  return apiFetch(`/attendants/${id}`);
}

export async function createAttendant(input: { userId: string }): Promise<AttendantDto> {
  return apiFetch('/attendants', { method: 'POST', body: input });
}

export async function activateAttendant(id: string): Promise<AttendantDto> {
  return apiFetch(`/attendants/${id}/activate`, { method: 'POST' });
}

export async function deactivateAttendant(id: string): Promise<AttendantDto> {
  return apiFetch(`/attendants/${id}/deactivate`, { method: 'POST' });
}
