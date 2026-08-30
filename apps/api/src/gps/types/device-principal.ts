/**
 * The authenticated device identity attached to `request.device` by
 * DeviceAuthGuard, resolved from the device's bearer credential — never
 * from a client-supplied `deviceId`/`busId`/`schoolId`. Same
 * ambient-namespace-augmentation pattern as `AuthenticatedPrincipal`
 * (apps/api/src/auth/types/principal.ts).
 */
export interface AuthenticatedDevice {
  id: string;
  busId: string;
  schoolId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      device?: AuthenticatedDevice;
    }
  }
}
