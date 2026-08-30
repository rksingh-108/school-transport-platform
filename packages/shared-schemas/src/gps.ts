import { z } from 'zod';

/**
 * Device-facing telemetry payload (Phase 1 Step 7). Deliberately contains
 * NO `schoolId`/`busId`/`deviceId`/`tripId` — those are always resolved
 * server-side from the authenticated device credential (and, for `tripId`,
 * the bus's own current in-progress trip), never trusted from the client.
 * See docs/adr/0014-gps-telemetry-and-realtime-tracking.md.
 *
 * `z.number().finite()` rejects `NaN`/`Infinity` explicitly — `z.number()`
 * alone accepts both, which would otherwise slip an unusable value past
 * validation and into a Decimal/Float column.
 */
export const gpsTelemetrySchema = z.object({
  latitude: z.number().finite().gte(-90).lte(90),
  longitude: z.number().finite().gte(-180).lte(180),
  // Upper bound is a generous "obviously impossible for a school bus" guard
  // (roughly 200 km/h), not a real-world speed limit — see the ADR.
  speedKmh: z.number().finite().gte(0).lte(200).optional(),
  heading: z.number().finite().gte(0).lte(360).optional(),
  accuracyM: z.number().finite().gt(0).optional(),
  recordedAt: z.string().datetime(),
});
export type GpsTelemetryInput = z.infer<typeof gpsTelemetrySchema>;

/** Bounded, explicit range query — no cursor pagination, since telemetry is naturally time-ordered and always queried within a caller-chosen window. */
export const gpsHistoryQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type GpsHistoryQuery = z.infer<typeof gpsHistoryQuerySchema>;
