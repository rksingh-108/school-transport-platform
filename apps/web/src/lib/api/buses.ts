import type { CursorPage, BusDto, BusDeviceDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export interface BusListParams {
  limit?: number;
  cursor?: string;
  search?: string;
  status?: string;
  minCapacity?: number;
}

export async function listBuses(params: BusListParams = {}): Promise<CursorPage<BusDto>> {
  return apiFetch(`/buses${toQuery(params)}`);
}

export async function getBus(id: string): Promise<BusDto> {
  return apiFetch(`/buses/${id}`);
}

export interface BusInput {
  fleetNumber?: string;
  registrationNumber: string;
  capacity: number;
  make?: string;
  model?: string;
  manufactureYear?: number;
  permitExpiry?: string;
  insuranceExpiry?: string;
  fitnessExpiry?: string;
  notes?: string;
}

export async function createBus(input: BusInput): Promise<BusDto> {
  return apiFetch('/buses', { method: 'POST', body: input });
}

export async function updateBus(
  id: string,
  input: Partial<BusInput> & { status?: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' },
): Promise<BusDto> {
  return apiFetch(`/buses/${id}`, { method: 'PATCH', body: input });
}

export async function archiveBus(id: string): Promise<BusDto> {
  return apiFetch(`/buses/${id}/archive`, { method: 'POST' });
}

export async function listBusDevices(busId: string): Promise<BusDeviceDto[]> {
  return apiFetch(`/buses/${busId}/devices`);
}

export interface DeviceInput {
  deviceType: 'GPS_TRACKER' | 'EDGE_COMPUTER' | 'NETWORK_GATEWAY';
  externalDeviceId: string;
  firmwareVersion?: string;
}

export async function registerDevice(busId: string, input: DeviceInput): Promise<BusDeviceDto> {
  return apiFetch(`/buses/${busId}/devices`, { method: 'POST', body: input });
}

export async function updateDevice(id: string, input: { firmwareVersion?: string; status?: 'ACTIVE' | 'FAULTY' }): Promise<BusDeviceDto> {
  return apiFetch(`/devices/${id}`, { method: 'PATCH', body: input });
}

export async function deactivateDevice(id: string): Promise<BusDeviceDto> {
  return apiFetch(`/devices/${id}/deactivate`, { method: 'POST' });
}
