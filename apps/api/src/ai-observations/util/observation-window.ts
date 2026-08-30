/**
 * Pure helpers for AI-observation temporal aggregation and replay/clock-skew
 * bounds — see docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md.
 * Kept dependency-free and directly unit-testable, the same pattern as
 * geofencing's geo.util.ts.
 */

/**
 * Floors `occurredAt` to the start of its `windowSeconds`-wide bucket. Two
 * detections of the same type from the same camera+edge device landing in
 * the same bucket collapse into one observation row (see
 * AiObservationsService.ingest) — this is the entire dedup/temporal-
 * aggregation strategy, deliberately not based on exact-timestamp equality
 * (edge devices report slightly different timestamps for what is really the
 * same ongoing detection).
 */
export function computeWindowStart(occurredAt: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(occurredAt.getTime() / windowMs) * windowMs);
}

export class ObservationTimestampError extends Error {}

/**
 * Rejects a timestamp too far in the future (misconfigured device clock) or
 * too far in the past (stale/replayed request) relative to the server's own
 * receipt time — the same "trust the server clock for ordering/security,
 * not the device's" principle GPS ingestion already applies
 * (GpsService.assertTimestampSane), with tighter, AI-appropriate bounds.
 * This is a bounds check, not cryptographic replay protection — see the
 * ADR's explicit "do not overengineer signing" decision.
 */
export function assertObservationTimestampSane(
  occurredAt: Date,
  now: Date,
  maxFutureSkewSeconds: number,
  maxPastAgeSeconds: number,
): void {
  if (Number.isNaN(occurredAt.getTime())) {
    throw new ObservationTimestampError('Invalid occurredAt timestamp.');
  }
  const futureSkewSeconds = (occurredAt.getTime() - now.getTime()) / 1000;
  if (futureSkewSeconds > maxFutureSkewSeconds) {
    throw new ObservationTimestampError('occurredAt is too far in the future.');
  }
  const pastAgeSeconds = (now.getTime() - occurredAt.getTime()) / 1000;
  if (pastAgeSeconds > maxPastAgeSeconds) {
    throw new ObservationTimestampError('occurredAt is too far in the past.');
  }
}
