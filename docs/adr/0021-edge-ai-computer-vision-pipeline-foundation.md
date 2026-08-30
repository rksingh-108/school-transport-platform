# ADR 0021: Edge AI / Computer Vision Pipeline Foundation

Status: Accepted
Date: 2026-08-30

## Context

Phase 3 Step 14 is the first AI implementation step: the edge-AI/computer-
vision pipeline **foundation** only — device model/authentication, a model
registry, a candidate-detection ("AI observation") model, ingestion, and
staff-only read access. Explicitly **not** built this step: any AI →
SafetyEvent promotion, a human-review workflow, AI safety analytics/incident
classification, AI emergency automation, or any facial/behavioral/identity
recognition — those are Step 15 and beyond. This step also does not build
real computer-vision inference: no camera hardware or model runtime exists
in this codebase, and none is pretended to.

## Decision 1: Real inference runs at the edge, outside this monolith — the API only ever receives an already-normalized result

The intended architecture is `Camera → Edge Computer → local inference →
small normalized observation → API`. This monolith never receives raw
frames or video, and never runs heavy inference synchronously inside a
NestJS request handler — both would violate the platform's existing
edge-first design intent ([ADR 0006](0006-ai-service-separation.md)) and
the step's own performance/privacy/bandwidth requirements. `AiObservation`
is the terminal, structured input the API accepts; what produced it
(vendor, model runtime, ONNX/TensorRT/whatever) is entirely the edge
device's concern and invisible to the domain.

## Decision 2: `ComputerVisionProvider` is a health/status abstraction, not an inference call site

Unlike `CameraStreamProvider` (Phase 2 Step 11), which the domain calls to
answer "is a stream available," `ComputerVisionProvider.getHealth()` is
**never called as part of ingestion** — a real edge device's submission is
accepted purely on the strength of its device credential, camera
assignment, and model-registry lookup, regardless of what this provider
reports. The provider exists only to answer "is a centralized/local
inference capability configured for this deployment at all," honestly
reporting `AI_NOT_CONFIGURED` (the default; no real provider exists) or
`AI_READY` (dev/test `MOCK` only, rejected in production exactly like
`CAMERA_STREAM_PROVIDER=MOCK`). This keeps the provider abstraction ready
for ADR 0006's "can run centrally before edge hardware is finalized"
future path without pretending that path exists today, and without forcing
the ingestion boundary to depend on it.

## Decision 3: Edge devices are `BusDevice` rows (`deviceType: 'EDGE_COMPUTER'`) — already reserved since Phase 1, no new device model

`EDGE_COMPUTER` has existed in the `DeviceType` enum since Phase 1 Step 7,
unused until now. Edge devices get zero new inventory/lifecycle/credential
code: registration, status (`ACTIVE`/`INACTIVE`/`FAULTY`), and the opaque
bearer-credential mechanism (issue/rotate via the existing
`POST /devices/:id/credential`, never returned by `GET`, hashed at rest)
are 100% the pre-existing generic `BusDevicesService`/`BusDevicesController`
— the same infrastructure GPS trackers and camera controllers already use.
The only genuinely new backend code for device auth is a small,
`EdgeAiDeviceAuthGuard`/`resolveDeviceByCredential` pair filtered to
`deviceType: 'EDGE_COMPUTER'`, deliberately its own guard rather than a
shared cross-domain one — the identical reasoning [ADR 0018](0018-camera-device-management-foundation.md)
Decision 2 gives for Camera's own guard: a GPS tracker's or camera
controller's credential must never authenticate an edge-AI submission, or
vice versa. The existing generic bus-detail device-management UI
(`/dashboard/buses/:id`) already listed `EDGE_COMPUTER` as a registerable
type; its credential-issuance control was gated to `GPS_TRACKER` only
(camera credentials had since grown their own dedicated UI on the cameras
page) — extended in this step to include `EDGE_COMPUTER` too, since it has
no dedicated page of its own and would otherwise have no way to obtain a
credential through the UI at all.

## Decision 4: Camera → edge-device assignment is a `Camera.edgeDeviceId` field, not a join table

An edge computer may process multiple cameras (one-to-many), but a camera
is processed by at most one edge device at a time — a plain optional FK on
`Camera` (`edgeDeviceId → BusDevice.id`) captures this exactly, with no new
join table. Assignment goes through the existing `PATCH /cameras/:id`
(gated by the existing `camera.manage` — no new permission needed for this
specific field), server-verified to be an `ACTIVE` `EDGE_COMPUTER` device
**on the same bus and tenant** as the camera (404, existence never
revealed, for a foreign/wrong-type/wrong-bus device — the same convention
as every other cross-tenant check in this codebase). Critically, an edge
device may only submit observations for a camera whose `edgeDeviceId`
equals its own authenticated device id — being on the same bus is
deliberately **not** sufficient (Step 14 §5's "ensure all relationships are
tenant verified" requirement) — so staff must explicitly assign a camera to
an edge device before that device can report anything for it.

## Decision 5: The AI model registry is platform-wide, not per-school

`AIModel` has no `schoolId` column at all — a specific named, versioned
model (e.g. `person-detector` `1.3.0`) is a shared ML asset used across
every school's fleet, not a per-tenant configuration, so duplicating
registry rows per school would be pure noise with no isolation benefit.
This follows the pre-existing `platform.*` convention
([ADR 0011](0011-school-status-platform-managed.md)) rather than every
other table in this schema's tenant-scoped default: new
`platform.ai_models.read`/`.manage` permissions, granted to `SUPER_ADMIN`
only — no school-level staff role ever registers, activates, or
deactivates a model. School staff only ever see a model's `name`/`version`
as denormalized display fields on the `AIObservation`s they're permitted to
read; there is no model-registry UI in the school dashboard, deliberately
(this is not a per-school concern to expose there). Consequently `ai_models`
gets no RLS policy at all — the same precedent already established for the
pre-existing, equally platform-wide `permissions` table — while
`ai_observations` gets the standard tenant-scoped `tenant_isolation` policy
like every operational table in this schema.

## Decision 6: Model versions are immutable rows; "updating" a model means registering a new version

`AIModel`'s natural key is `(name, version)`, unique and never mutated after
creation — `AiModelsService` has no update-fields endpoint at all, only
dedicated `activate`/`deactivate`/`deprecate` lifecycle transitions (mirrors
`SafetyRule`'s enable/disable discipline from
[ADR 0020](0020-geofencing-and-operational-safety-rules.md)). `DEPRECATED`
is terminal — no code path moves a model out of it. Every `AIObservation`
stores both a `modelId` FK and a denormalized `modelVersion` string
snapshot, so historical observations remain traceable to exactly the model
version that produced them even if that version's `status` later changes.
Registering a duplicate `(name, version)` is a clean `400` (an ordinary
input mistake — the caller likely meant to bump the version string), not a
server error.

## Decision 7: `AIObservation` is the terminal AI output this step — never a `SafetyEvent`, never an `Emergency`

No code path in `AiObservationsService` calls into the `safety` module at
all. This mirrors the exact separation `SafetyEvent` vs. `Emergency`
already established in [ADR 0019](0019-safety-events-and-emergency-management.md)
— a candidate signal is not the same concept as a confirmed/actionable one,
and collapsing them now would either let unreviewed AI output reach
operational response unreviewed, or force a painful later migration to
split them apart under real data. `AIObservationStatus` includes
`REVIEWED`/`DISMISSED`/`PROMOTED` in the schema (so Step 15 doesn't need a
migration just to add states), but no endpoint in this step ever sets
anything other than `CANDIDATE` — there is no review/promote endpoint at
all yet. Step 15 owns `AIObservation → review/threshold → SafetyEvent →
human action`, exactly as specified.

## Decision 8: Deduplication is a time-windowed unique constraint, not per-frame rows

`AIObservation` carries a `windowStart` column (`occurredAt` floored to a
configurable window, default 30s — `AI_OBSERVATION_DEDUP_WINDOW_SECONDS`)
and a unique constraint on `(edgeDeviceId, cameraId, detectionType,
windowStart)`. A repeated detection of the same type from the same
camera+edge device within the same window **updates** the existing
candidate row (latest `confidence`/`occurredAt`/`metadata` wins, `receivedAt`
bumped to now) instead of creating a new one — implemented as
create-then-catch-`P2002`-then-update, the same idiom `GpsService.ingest()`
already uses for its own dedup, adapted from "no-op on conflict" to
"update on conflict" since repeated detections here are meaningfully new
information (a stronger/weaker confidence reading), unlike GPS's identical-
resend case. This directly prevents "one row per inference frame" without
any additional infrastructure. Realtime (`ai.observation.created`/
`.updated`) fires only after this collapse, never once per raw detection.

## Decision 9: Replay/clock-skew bounds, not cryptographic anti-replay

`occurredAt` is rejected (400) if it's more than
`AI_OBSERVATION_MAX_FUTURE_SKEW_SECONDS` (default 120s) ahead of the
server's own clock, or more than `AI_OBSERVATION_MAX_PAST_AGE_SECONDS`
(default 3600s) behind it — the same "trust the server clock for
ordering/security, never the device's" principle
`GpsService.assertTimestampSane` already applies, with an AI-appropriate
(near-realtime, not multi-day) past bound. This is a bounds check, not a
nonce/signature scheme — a deliberate, documented decision not to
overengineer replay protection the step's own instructions warned against.
Combined with the dedup window (Decision 8), this is "a reasonable
protection mechanism," not a cryptographic guarantee.

## Decision 10: `ai_events.*` (reserved since Phase 0) is reused for `AIObservation`, not a new `ai_observations.*` scheme

`architecture.md`'s module table has reserved an `ai-events` module and
`ai_events.read`/`ai_events.review` permissions since before this codebase
had any AI feature — clearly the intended future slot for "AI-generated
candidate events," which is exactly what `AIObservation` is, just named
precisely per this step's own terminology. Reusing the reserved permission
keys (rather than minting a parallel `ai_observations.*` pair) follows the
project's "define the permission now, enforce later" convention exactly as
done for `camera.*`/`emergency.*` in prior steps. Two real gaps were found
and closed while wiring this up (same class of correction as every prior
step's RBAC review): `ai_events.read` had never been granted to
`SCHOOL_ADMIN` or `TRANSPORT_MANAGER` despite both roles holding the
equivalent read grant for every other safety-adjacent domain
(camera/safety-events/geofences), and `TRANSPORT_ADMIN` held
`ai_events.review` without the prerequisite `ai_events.read`. All three
gaps closed; `DRIVER`/`BUS_ATTENDANT` remain deliberately ungranted (no
broad AI dashboard for either role), and `ai_events.review` remains
unused/reserved — no review action exists until Step 15.

## Decision 11: No facial recognition, no biometrics, no child identity — structurally, not just by convention

`AIDetectionType` is a closed, objective, physical-event enum
(`PERSON_DETECTED`, `PERSON_COUNT`, `OBJECT_DETECTED`, `FALL_DETECTED`,
`SMOKE_DETECTED`, `FIRE_DETECTED`, `DOOR_STATE_DETECTED`,
`UNUSUAL_MOTION`) — there is no schema value, column, or code path anywhere
in this module that could carry a face embedding, a biometric template, or
a `studentId`. `AIObservationDto` has no identity field of any kind.
`evidenceReference` is always `null` in this step — no snapshot/clip
storage integration exists, and none is fabricated. This is the same
"there is no schema shape here that could carry it" discipline
`SafetyEvent.metadata` already applies (ADR 0019), extended to the entire
new model rather than one field.

## Decision 12: No parent-facing surface at all

There is no parent-audience route on `AiObservationsController`,
`EdgeAiController`, or `AiModelsController` (all staff-only via
`@RequireAudience('STAFF')` or, for the model registry, platform-only), no
AI field on any parent DTO, and no AI event on the parent realtime channel.
This mirrors every prior Phase 2 module's identical privacy stance —
parents receive no AI observations, no confidence scores, no detection
details, and no indication that edge-AI processing exists on their child's
bus at all.

## Consequences

- One migration
  (`20260830192757_phase3_step14_edge_ai_pipeline_foundation`) adds
  `AIModel`/`AIObservation` and `Camera.edgeDeviceId`, with a
  `tenant_isolation` RLS policy on `ai_observations` only (never
  `ai_models`, per Decision 5).
- No existing module's runtime behavior changed except: `Camera.update()`
  gained one new optional field (`edgeDeviceId`), and the bus-detail
  device-management UI's credential-issuance control now also covers
  `EDGE_COMPUTER` (previously `GPS_TRACKER`-only).
- Explicitly out of scope and not attempted, per the step's own boundary:
  any AI → SafetyEvent/Emergency promotion or human-review workflow (Step
  15), real computer-vision inference of any kind, facial/behavioral/
  identity recognition, biometric storage, raw video/snapshot storage, and
  a model-registry frontend UI (API-only this step — SUPER_ADMIN has no
  dedicated platform-admin UI anywhere in this codebase yet, and adding one
  solely for this would be speculative beyond what this step asked for).
