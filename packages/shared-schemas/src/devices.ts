import { z } from 'zod';

export const DEVICE_TYPES = ['GPS_TRACKER', 'EDGE_COMPUTER', 'NETWORK_GATEWAY'] as const;
/** Settable via PATCH — excludes INACTIVE, which is only ever set by POST /devices/:id/deactivate. */
const patchableDeviceStatusSchema = z.enum(['ACTIVE', 'FAULTY']);

/**
 * No credential/secret field — there is no real device-provisioning flow to
 * issue one against yet (docs/security.md#device-security). `deviceType` is
 * fixed at registration and never updatable — a GPS tracker doesn't turn
 * into an edge computer after the fact.
 */
export const createDeviceSchema = z.object({
  deviceType: z.enum(DEVICE_TYPES),
  externalDeviceId: z.string().min(1).max(100),
  firmwareVersion: z.string().max(50).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;

export const updateDeviceSchema = z.object({
  externalDeviceId: z.string().min(1).max(100).optional(),
  firmwareVersion: z.string().max(50).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  status: patchableDeviceStatusSchema.optional(),
});
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;
