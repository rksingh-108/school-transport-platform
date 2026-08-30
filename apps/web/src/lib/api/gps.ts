import type { BusLocationDto, GpsPointDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

export interface GpsHistoryParams {
  from?: string;
  to?: string;
  limit?: number;
}

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export async function getFleetLocations(): Promise<BusLocationDto[]> {
  return apiFetch('/gps/fleet');
}

export async function getBusLocation(busId: string): Promise<BusLocationDto> {
  return apiFetch(`/buses/${busId}/location`);
}

export async function getBusTelemetry(busId: string, params: GpsHistoryParams = {}): Promise<GpsPointDto[]> {
  return apiFetch(`/buses/${busId}/telemetry${toQuery(params)}`);
}

export async function getTripTelemetry(tripId: string, params: GpsHistoryParams = {}): Promise<GpsPointDto[]> {
  return apiFetch(`/trips/${tripId}/telemetry${toQuery(params)}`);
}

/** Dev/test-only — see GpsSimulatorController. Pushes one synthetic fix through the real ingestion path for manual verification. */
export async function simulateGpsTick(
  busId: string,
  input: { latitude: number; longitude: number; speedKmh?: number; heading?: number; accuracyM?: number; recordedAt: string },
): Promise<{ deduplicated: boolean }> {
  return apiFetch(`/dev/gps-simulator/buses/${busId}/tick`, { method: 'POST', body: input });
}
