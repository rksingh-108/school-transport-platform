import { z } from 'zod';
import { SEVERITIES } from './safety-events';

export const AI_DETECTION_TYPES = [
  'PERSON_DETECTED',
  'PERSON_COUNT',
  'OBJECT_DETECTED',
  'FALL_DETECTED',
  'SMOKE_DETECTED',
  'FIRE_DETECTED',
  'DOOR_STATE_DETECTED',
  'UNUSUAL_MOTION',
] as const;
export const AI_OBSERVATION_STATUSES = ['CANDIDATE', 'REVIEWED', 'DISMISSED', 'PROMOTED'] as const;

// Bounded — a small structured blob only (e.g. a bounding box, a frame
// window in ms, a person count), never an arbitrary or huge payload. See
// docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md's "payload
// limits" decision.
const METADATA_MAX_KEYS = 20;
const METADATA_MAX_SERIALIZED_LENGTH = 2000;
const aiObservationMetadataSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .refine((obj) => Object.keys(obj).length <= METADATA_MAX_KEYS, {
    message: `metadata may have at most ${METADATA_MAX_KEYS} keys.`,
  })
  .refine((obj) => JSON.stringify(obj).length <= METADATA_MAX_SERIALIZED_LENGTH, {
    message: `metadata must serialize to at most ${METADATA_MAX_SERIALIZED_LENGTH} characters.`,
  });

/**
 * The device-facing edge-AI observation-ingestion payload. Deliberately has
 * NO `schoolId`/`busId`/`tripId`/`edgeDeviceId`/`createdBy`/`reviewedBy` —
 * every one of those is server-derived from the authenticated edge-device
 * credential (schoolId/busId/edgeDeviceId) or resolved internally from the
 * bus's own current trip (tripId is never accepted from the client at all —
 * see the ADR). `cameraId` is the one caller-supplied identifier, and is
 * re-verified server-side against both the device's own tenant/bus AND that
 * the camera is actually assigned to this specific edge device (Camera.
 * edgeDeviceId) — an edge device may not report detections for a camera it
 * hasn't been assigned to process. `modelName`/`modelVersion` reference the
 * platform-wide model registry by its natural (name, version) key, not an
 * internal UUID a physical device would have no reason to know.
 */
export const submitAiObservationSchema = z.object({
  cameraId: z.string().uuid(),
  detectionType: z.enum(AI_DETECTION_TYPES),
  confidence: z.number().min(0).max(1),
  occurredAt: z.string().datetime({ offset: true }),
  modelName: z.string().min(1).max(100),
  modelVersion: z.string().min(1).max(50),
  metadata: aiObservationMetadataSchema.optional(),
});
export type SubmitAiObservationInput = z.infer<typeof submitAiObservationSchema>;

export const listAiObservationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  detectionType: z.enum(AI_DETECTION_TYPES).optional(),
  status: z.enum(AI_OBSERVATION_STATUSES).optional(),
  busId: z.string().uuid().optional(),
  cameraId: z.string().uuid().optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
export type ListAiObservationsQuery = z.infer<typeof listAiObservationsQuerySchema>;

/**
 * Device-facing edge health ping — the edge-AI analogue of
 * cameraHeartbeatSchema. Carries no "online"/status field: arrival of this
 * authenticated request is the entire signal (see
 * EdgeAiObservationsService.heartbeat). `activeModel`/`activeModelVersion`
 * let a device report which model it is currently running locally, purely
 * for staff-visible diagnostics — never trusted as authorization for what
 * the device may submit (every observation's modelName/modelVersion is
 * independently validated against the registry regardless of what a prior
 * heartbeat claimed).
 */
export const edgeAiHeartbeatSchema = z.object({
  firmwareVersion: z.string().max(50).optional(),
  activeModel: z.string().max(100).optional(),
  activeModelVersion: z.string().max(50).optional(),
  health: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type EdgeAiHeartbeatInput = z.infer<typeof edgeAiHeartbeatSchema>;

// ---------------------------------------------------------------------------
// Human review workflow (Phase 3 Step 15) — three dedicated state-transition
// endpoints, never a generic PATCH. See
// docs/adr/0022-ai-observation-review-and-safety-analytics.md. None of these
// accept model/modelVersion/confidence/occurredAt/cameraId/edgeDeviceId —
// the original AI detection is immutable; only the review outcome is being
// recorded.
// ---------------------------------------------------------------------------

const REVIEW_NOTE_MAX_LENGTH = 2000;

/** CANDIDATE → REVIEWED only — a lightweight "seen, still deciding" marker. */
export const reviewAiObservationSchema = z.object({
  reviewNote: z.string().max(REVIEW_NOTE_MAX_LENGTH).optional(),
});
export type ReviewAiObservationInput = z.infer<typeof reviewAiObservationSchema>;

/** {CANDIDATE, REVIEWED} → DISMISSED — terminal, no SafetyEvent is ever created. */
export const dismissAiObservationSchema = z.object({
  reviewNote: z.string().max(REVIEW_NOTE_MAX_LENGTH).optional(),
});
export type DismissAiObservationInput = z.infer<typeof dismissAiObservationSchema>;

/**
 * {CANDIDATE, REVIEWED} → PROMOTED — creates the linked SafetyEvent.
 * `severity` is an optional human override of the school's configured
 * `AiSafetyPolicy.defaultSeverity` for this detection type — the reviewer
 * just looked at the evidence and may judge it more or less severe than the
 * school's static default; omitting it uses the policy default.
 */
export const promoteAiObservationSchema = z.object({
  reviewNote: z.string().max(REVIEW_NOTE_MAX_LENGTH).optional(),
  severity: z.enum(SEVERITIES).optional(),
});
export type PromoteAiObservationInput = z.infer<typeof promoteAiObservationSchema>;
