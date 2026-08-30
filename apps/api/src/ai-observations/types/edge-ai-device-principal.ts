/**
 * The authenticated edge-AI device identity attached to `request.edgeAiDevice`
 * by EdgeAiDeviceAuthGuard, resolved purely from the device's bearer
 * credential — never from a client-supplied id. Same pattern as GPS's
 * `AuthenticatedDevice`/Camera's `AuthenticatedCameraDevice`; kept as its own
 * type/guard pair rather than sharing either, because each resolves against
 * a different `deviceType` and must never be interchangeable — a camera
 * controller's credential must not authenticate an edge-AI observation
 * submission, or vice versa (see
 * docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md, and
 * docs/adr/0018's identical Decision 2 for the camera/GPS split).
 */
export interface AuthenticatedEdgeAiDevice {
  /** The BusDevice row's id (deviceType EDGE_COMPUTER). */
  id: string;
  busId: string;
  schoolId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      edgeAiDevice?: AuthenticatedEdgeAiDevice;
    }
  }
}
