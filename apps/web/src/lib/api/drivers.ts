import type { CursorPage, DriverDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export interface DriverListParams {
  limit?: number;
  cursor?: string;
  search?: string;
  status?: string;
}

export async function listDrivers(params: DriverListParams = {}): Promise<CursorPage<DriverDto>> {
  return apiFetch(`/drivers${toQuery(params)}`);
}

export async function getDriver(id: string): Promise<DriverDto> {
  return apiFetch(`/drivers/${id}`);
}

export async function createDriver(input: { userId: string; licenseNumber: string; licenseExpiry?: string }): Promise<DriverDto> {
  return apiFetch('/drivers', { method: 'POST', body: input });
}

export async function updateDriver(id: string, input: { licenseNumber?: string; licenseExpiry?: string }): Promise<DriverDto> {
  return apiFetch(`/drivers/${id}`, { method: 'PATCH', body: input });
}

export async function activateDriver(id: string): Promise<DriverDto> {
  return apiFetch(`/drivers/${id}/activate`, { method: 'POST' });
}

export async function deactivateDriver(id: string): Promise<DriverDto> {
  return apiFetch(`/drivers/${id}/deactivate`, { method: 'POST' });
}
