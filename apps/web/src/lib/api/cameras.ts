import type { CursorPage, CameraDto, CameraStreamAvailabilityDto, DeviceCredentialDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export const CAMERA_POSITIONS = ['FRONT', 'CABIN', 'REAR', 'LEFT', 'RIGHT', 'DOOR', 'CUSTOM'] as const;

export interface CameraListParams {
  limit?: number;
  cursor?: string;
  busId?: string;
  status?: string;
  search?: string;
}

export async function listCameras(params: CameraListParams = {}): Promise<CursorPage<CameraDto>> {
  return apiFetch(`/cameras${toQuery(params)}`);
}

export async function listCamerasForBus(busId: string): Promise<CameraDto[]> {
  return apiFetch(`/buses/${busId}/cameras`);
}

export async function getCamera(id: string): Promise<CameraDto> {
  return apiFetch(`/cameras/${id}`);
}

export interface CameraInput {
  cameraCode: string;
  name: string;
  position: (typeof CAMERA_POSITIONS)[number];
  customPositionLabel?: string;
  manufacturer?: string;
  model?: string;
  serialNumber: string;
  firmwareVersion?: string;
}

export async function createCamera(busId: string, input: CameraInput): Promise<CameraDto> {
  return apiFetch(`/buses/${busId}/cameras`, { method: 'POST', body: input });
}

export async function updateCamera(
  id: string,
  input: Partial<Omit<CameraInput, 'serialNumber'>> & { status?: 'ACTIVE' | 'INACTIVE' | 'FAULT'; busId?: string },
): Promise<CameraDto> {
  return apiFetch(`/cameras/${id}`, { method: 'PATCH', body: input });
}

export async function archiveCamera(id: string): Promise<CameraDto> {
  return apiFetch(`/cameras/${id}/archive`, { method: 'POST' });
}

/** Returns the raw bearer token exactly once — the caller must show/copy it immediately; it can never be retrieved again. */
export async function rotateCameraCredential(id: string): Promise<DeviceCredentialDto> {
  return apiFetch(`/cameras/${id}/credential`, { method: 'POST' });
}

/** Never returns a real playback URL or credential this phase — see CameraStreamAvailabilityDto. */
export async function getCameraStream(id: string): Promise<CameraStreamAvailabilityDto> {
  return apiFetch(`/cameras/${id}/stream`);
}
