/**
 * The authenticated camera-device identity attached to `request.cameraDevice`
 * by CameraDeviceAuthGuard, resolved purely from the device's bearer
 * credential — never from a client-supplied id. Same
 * ambient-namespace-augmentation pattern as GPS's `AuthenticatedDevice`
 * (apps/api/src/gps/types/device-principal.ts); kept as its own type/guard
 * pair rather than sharing GPS's, because the two resolve against a
 * different `deviceType` and must never be interchangeable — a GPS
 * tracker's credential must not authenticate a camera heartbeat, or vice
 * versa (see docs/adr/0018-camera-device-management-foundation.md).
 */
export interface AuthenticatedCameraDevice {
  /** The BusDevice row's id (not the Camera row's id). */
  id: string;
  busId: string;
  schoolId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      cameraDevice?: AuthenticatedCameraDevice;
    }
  }
}
