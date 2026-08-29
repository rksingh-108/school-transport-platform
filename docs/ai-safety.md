# AI Safety Architecture

Status: Draft v1 (Phase 3 — design now, build later against real camera/edge
hardware; documented early because it constrains the `cameras`/`ai_events`/
`incidents` module boundaries decided in [architecture.md](architecture.md))

## 1. Role of AI in this Product

AI is an **assistive detector**, not a decision-maker. It never:
- labels a child ("bad," "suspicious," "dangerous," or any subjective/character
  trait),
- takes an autonomous action in the physical world (it cannot lock a door, stop a
  bus, or contact a parent directly),
- finalizes an incident — a human with `ai_events.review` always adjudicates before
  anything becomes a `CONFIRMED_INCIDENT`.

AI outputs are **candidate signals for authorized humans to review**, exactly like a
smoke detector: it flags, a person decides what it means and what to do.

## 2. Event Taxonomy (objective, behavior-based)

| `event_type` | Description |
|---|---|
| `POTENTIAL_FALL` | Sudden posture/position change consistent with a fall |
| `UNUSUAL_CROWDING` | Density/movement pattern inconsistent with normal boarding |
| `POTENTIAL_PHYSICAL_CONFLICT` | Rapid, forceful contact-pattern between occupants |
| `DRIVER_DISTRACTION` | Driver gaze/posture inconsistent with attentive driving |
| `DOOR_OPEN_IN_MOTION` | Door sensor + vehicle-motion signal conflict |
| `SMOKE_FIRE_INDICATION` | Visual/sensor pattern consistent with smoke or fire |
| `CHILD_POTENTIALLY_LEFT_BEHIND` | Occupancy check at trip-end mismatch |
| `UNUSUAL_MOVEMENT` | Catch-all for anomalous motion pattern not otherwise classified |
| `CAMERA_OBSTRUCTION` | Lens blocked/covered/degraded — a device-health event, not a
  child-behavior event, but flows through the same pipeline |
| `CAMERA_DEVICE_FAILURE` | Device stopped reporting / hardware fault |

Every event type name and its description is reviewed for neutrality before being
added — this list is a governance artifact, not just an enum, and additions go
through the same review as a schema change.

## 3. Event Schema

```json
{
  "eventType": "POTENTIAL_FALL",
  "confidence": 0.92,
  "severity": "HIGH",
  "busId": "uuid",
  "cameraId": "uuid",
  "deviceId": "uuid",
  "timestamp": "2026-08-30T07:41:12+05:30",
  "modelVersion": "fall-detector-v1.3.0",
  "clipFileId": "uuid | null",
  "metadata": { "frameWindowMs": 4000 }
}
```
`severity` is derived from `(eventType, confidence)` by a school-configurable
mapping table, not hardcoded per model — a school can be more or less conservative
without a code change.

## 4. Architecture

```
Camera ──▶ Edge Device (per bus) ──▶ Edge AI Inference ──▶ [event fires?]
                                                                │ yes
                                                                ▼
                                          Short evidentiary clip + event metadata
                                          (NOT continuous raw video) ──▶ Cloud API
                                                                │
                                                                ▼
                                    NestJS `ai-events` module: creates AI_EVENT row,
                                    notifies authorized staff (`ai_events.read`),
                                    never notifies parents directly
```

**Provider/model abstraction** (so no vendor/model is hardcoded):

```typescript
interface SafetyEventDetector {
  readonly eventType: AiEventType;
  detect(frameWindow: FrameWindow): Promise<DetectionResult | null>;
}

interface AIInferenceProvider {
  runDetectors(frameWindow: FrameWindow, detectors: SafetyEventDetector[]): Promise<DetectionResult[]>;
}

interface ModelRegistry {
  getActiveModel(eventType: AiEventType, schoolId: string): ModelDescriptor;
}
```
The Phase 1/2 monolith depends only on the `ai-events` module's REST contract
(`POST /internal/ai-events`, service-to-service credential, not exposed publicly);
it does not depend on any specific model, vendor, or inference runtime. The Python
AI service (`apps/ai-service`) implements `AIInferenceProvider` and can run at the
edge (on a bus-mounted box) or centrally during early pilots before edge hardware is
finalized — the interface doesn't change either way, only the deployment location
does. This directly serves the "avoid sending unnecessary raw video to the cloud"
requirement without requiring edge hardware to exist on day one of Phase 3.

## 5. Human-in-the-Loop Workflow

```
AI_EVENT created (status: NEW)
    │  notifies staff with ai_events.read/review
    ▼
Authorized reviewer opens event, watches clip, decides:
    ├─▶ DISMISSED  (false positive; recorded with reviewer + reason, feeds model
    │               feedback loop — not silently discarded)
    └─▶ CONFIRMED  ──▶ incidents module creates an INCIDENT (status: OPEN)
                          │
                          ▼
                    incident_events append-only trail (investigation notes,
                    status changes) — same pattern as attendance_events
                          │
                          ▼
                    RESOLVED (with resolution summary, resolved_by, resolved_at)
```

Invariants enforced at the service layer (and tested per
[security.md](security.md#6-testing-requirements)):
- No code path creates a `CONFIRMED_INCIDENT` without a non-null `reviewed_by`
  (a human `user_id`).
- `AI_EVENT.status` transitions are one-way (`NEW → REVIEWED → {DISMISSED|
  CONFIRMED}`) — no automated job can flip a dismissed event back to confirmed or
  vice versa.
- Confidence score is visible to reviewers, never surfaced to parents, and never
  used as a standalone threshold that auto-escalates without human review (even a
  0.99-confidence event still requires a human to confirm before it becomes an
  incident) — the door is left open for a future school-configurable
  "auto-escalate-for-immediate-notification-but-still-require-review" policy for
  the most severe categories (e.g., `SMOKE_FIRE_INDICATION`), but that would notify
  staff faster, not auto-create a finalized incident.

## 6. Camera & Device Health (feeds into the same pipeline)

`CAMERA_OBSTRUCTION` and `CAMERA_DEVICE_FAILURE` are modeled as AI/device events
using the identical schema and review pipeline as behavioral events, because a
degraded camera is itself a safety-relevant condition schools must act on (e.g.,
schedule maintenance, temporarily flag the bus). This avoids building a second,
parallel "device health event" pipeline — see
[architecture.md](architecture.md#4-module-boundaries--ownership-table) for why
`cameras`/`device-health` and `ai-events` are separate modules but share this event
shape.

## 7. What This Explicitly Does Not Do (guardrails, not just omissions)

- No continuous behavioral scoring/profiling of any individual child over time (see
  [privacy.md](privacy.md#1-principles)).
- No automated disciplinary action, parent notification, or academic-record linkage
  triggered directly by an AI event.
- No facial recognition/biometric identification as part of the safety-event
  pipeline described here — a hypothetical future biometric *boarding* feature
  (identity verification, not behavior detection) is a fully separate, flagged,
  legally-reviewed feature per [privacy.md](privacy.md#1-principles), not something
  this pipeline does implicitly.
- Model outputs are never treated as ground truth in reporting — reports on
  incidents count `CONFIRMED_INCIDENT`s (human-adjudicated), not raw `AI_EVENT`
  volume, to avoid conflating "the model fired" with "something happened."
