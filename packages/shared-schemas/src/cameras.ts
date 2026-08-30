import { z } from 'zod';

export const CAMERA_POSITIONS = ['FRONT', 'CABIN', 'REAR', 'LEFT', 'RIGHT', 'DOOR', 'CUSTOM'] as const;
export const CAMERA_STATUSES = ['ACTIVE', 'INACTIVE', 'FAULT', 'RETIRED'] as const;
export const CAMERA_STREAM_TYPES = ['NONE', 'RTSP', 'HLS', 'WEBRTC', 'VENDOR'] as const;
/** Settable via PATCH — excludes RETIRED, which is only ever set by POST /cameras/:id/archive. */
const patchableCameraStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'FAULT']);

/**
 * Deliberately has no `schoolId` field — a camera's tenant is fixed at
 * creation from the caller's own authenticated context (and, transitively,
 * from the bus it's being attached to, which is itself re-verified against
 * that same tenant) and can never be supplied or changed through this
 * endpoint. `serialNumber` becomes the underlying BusDevice's
 * `externalDeviceId` — there is no second, independent serial-number column
 * (see docs/adr/0018-camera-device-management-foundation.md).
 */
export const createCameraSchema = z
  .object({
    cameraCode: z.string().min(1).max(50),
    name: z.string().min(1).max(100),
    position: z.enum(CAMERA_POSITIONS),
    customPositionLabel: z.string().min(1).max(50).optional(),
    manufacturer: z.string().max(100).optional(),
    model: z.string().max(100).optional(),
    serialNumber: z.string().min(1).max(100),
    firmwareVersion: z.string().max(50).optional(),
    streamType: z.enum(CAMERA_STREAM_TYPES).optional(),
  })
  .refine((v) => v.position !== 'CUSTOM' || !!v.customPositionLabel, {
    message: 'customPositionLabel is required when position is CUSTOM.',
    path: ['customPositionLabel'],
  });
export type CreateCameraInput = z.infer<typeof createCameraSchema>;

export const updateCameraSchema = z
  .object({
    cameraCode: z.string().min(1).max(50).optional(),
    name: z.string().min(1).max(100).optional(),
    position: z.enum(CAMERA_POSITIONS).optional(),
    customPositionLabel: z.string().min(1).max(50).optional(),
    manufacturer: z.string().max(100).optional(),
    model: z.string().max(100).optional(),
    firmwareVersion: z.string().max(50).optional(),
    streamType: z.enum(CAMERA_STREAM_TYPES).optional(),
    status: patchableCameraStatusSchema.optional(),
    // Reassignment to a different bus — must belong to the same tenant,
    // re-verified server-side exactly like creation's busId path param.
    busId: z.string().uuid().optional(),
  })
  .refine((v) => v.position !== 'CUSTOM' || !!v.customPositionLabel, {
    message: 'customPositionLabel is required when position is CUSTOM.',
    path: ['customPositionLabel'],
  });
export type UpdateCameraInput = z.infer<typeof updateCameraSchema>;

export const listCamerasQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  busId: z.string().uuid().optional(),
  status: z.enum(CAMERA_STATUSES).optional(),
  search: z.string().max(200).optional(),
});
export type ListCamerasQuery = z.infer<typeof listCamerasQuerySchema>;

/**
 * Device-facing heartbeat (Phase 2 Step 11) — the camera-domain analogue of
 * gpsTelemetrySchema. Deliberately carries no status/"online" field: the
 * fact that this request arrived, authenticated by the device's own
 * credential, is the entire signal. `firmwareVersion` lets a device report
 * an update; `health` is a small bounded diagnostic blob written verbatim to
 * BusDevice.lastHealth (never trusted as an authoritative connectivity
 * state — see CamerasService.deriveConnectivity, which is computed only
 * from lastSeenAt).
 */
export const cameraHeartbeatSchema = z.object({
  firmwareVersion: z.string().max(50).optional(),
  health: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type CameraHeartbeatInput = z.infer<typeof cameraHeartbeatSchema>;
