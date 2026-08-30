import type { CameraStreamAvailabilityDto } from '@school-transport/shared-types';

/**
 * Boundary between the camera domain and an actual video provider. No real
 * provider (RTSP relay, vendor cloud API, WebRTC SFU, etc.) is wired up in
 * this phase — see docs/adr/0018-camera-device-management-foundation.md.
 * Neither implementation below ever returns a value implying a real, live
 * feed exists; `AVAILABLE` is deliberately not a value either can return.
 */
export interface CameraStreamProvider {
  getAvailability(): CameraStreamAvailabilityDto;
}

/** The default in every environment unless CAMERA_STREAM_PROVIDER=MOCK is explicitly set (never allowed in production — see env.schema.ts). */
export class NotConfiguredCameraStreamProvider implements CameraStreamProvider {
  getAvailability(): CameraStreamAvailabilityDto {
    return {
      status: 'NOT_CONFIGURED',
      message: 'Live stream is not configured for this camera.',
    };
  }
}

/**
 * Dev/test only — never returns anything a frontend could mistake for a
 * real, playable video. It exists to exercise the stream-availability
 * endpoint's plumbing (permission checks, DTO shape, frontend rendering)
 * without a real vendor integration.
 */
export class MockCameraStreamProvider implements CameraStreamProvider {
  getAvailability(): CameraStreamAvailabilityDto {
    return {
      status: 'SIMULATED',
      message: 'Simulated stream — no real video is available. Development/test only.',
    };
  }
}

export const CAMERA_STREAM_PROVIDER = Symbol('CAMERA_STREAM_PROVIDER');
