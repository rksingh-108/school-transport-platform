# Privacy — Child Data Handling

Status: Draft v1 — **engineering-authored, not a legal document.** Sections marked
⚠️ require sign-off from qualified legal/privacy counsel before production launch
with real student data, particularly regarding India's Digital Personal Data
Protection Act (DPDPA 2023) and its treatment of children's data and "Significant
Data Fiduciary" obligations, which impose specific consent and processing
requirements this document does not attempt to interpret authoritatively.

## 1. Principles

1. **Data minimization**: collect only fields with a named product purpose (traced
   to a requirement in [product-requirements.md](product-requirements.md)). No
   speculative "might be useful later" fields on `students`/`parents`.
2. **Purpose limitation**: student location/attendance data is used only for
   transport safety and parent communication — never analytics products, never
   advertising, never sold or shared with third parties outside the operating
   school's explicit instructions.
3. **No behavioral profiling**: the platform does not build longitudinal behavioral
   profiles of a child (e.g., "this child is frequently late," scored/ranked) for
   any purpose beyond the operational display of that day's/week's data the school
   already needs to run transport.
4. **Biometric data is opt-in, isolated, and flagged.** Any future facial-recognition
   or biometric-boarding feature sits behind a feature flag (`ff.biometric_boarding`,
   default OFF), lives in an isolated module with its own data store and retention
   policy, and requires ⚠️ documented legal review and explicit parental consent
   capture before enablement for any school. It is **not** part of MVP or Phase
   2/3 scope as currently planned.
5. **School-controlled, platform-processed.** The school is the data controller for
   its students' data; the platform is a processor acting on the school's
   instructions and configured retention policy. Contractual terms (⚠️ legal) should
   reflect this.

## 2. Data Inventory (MVP scope)

| Data | Collected from | Who can access | Retention default |
|---|---|---|---|
| Student profile (name, DOB, grade, photo) | School admin | School staff per RBAC; parent sees own child's name/photo only | Retained while enrolled + configurable post-graduation window |
| Parent profile (name, phone, email) | Parent/school | School staff, the parent themself | While account active |
| Trip manifest (which student is planned on which trip, pickup/dropoff stop) | School staff (Phase 1 Step 5) | School staff per RBAC (`trips.read`/`trips.manage`); parent sees a simplified trip status for their own child only, via a dedicated parent-safe view (Phase 1 Step 8) — never this staff management API, never a raw manifest/`TripStudent` row | Soft-removed only, never hard-deleted (kept for the trip's own historical record); no separate retention job yet, tracked in [roadmap.md](roadmap.md) |
| Attendance/boarding events | Attendant app, device sources | School staff per RBAC; parent sees own child's events | Configurable per school (default 1 year), see §4 |
| GPS points | Bus device | School staff (`gps.read`); parent sees only current/derived location for own child's active trip, never raw historical trails | Raw points: short window (default 90 days) then aggregated/discarded; live state not retained beyond trip completion in derived form |
| Camera inventory & metadata (Phase 2 Step 11) | School staff (registration) | `camera.read`/`camera.manage` roles only; **never parents** | Kept for the fleet asset's lifetime, same as `buses`/`bus_devices` — not footage, see below |
| Camera footage/clips/streaming (Phase 2, not yet built) | Bus camera | Only `camera.read`/`ai_events.review`/`incidents.*` roles; **never parents** | Short default (e.g., 30 days) unless attached to an open incident, then held per incident retention until resolution + defined window |
| Safety events & emergencies (Phase 2 Step 12) | Human operator/driver/attendant, own-trip-scoped for the latter two; system-generated for a fired operational safety rule (Phase 2 Step 13) | `safety_events.*`/`emergency.*` roles only; **never parents** | Never purged/hard-deleted — operational history, see §4 |
| Geofences & safety rules (Phase 2 Step 13) | School staff (configuration only) | `geofences.*`/`safety_rules.*` roles only; **never parents, never drivers/attendants** | Geofences never hard-deleted once referenced (terminal `ARCHIVED` status); safety rules kept indefinitely, enabled/disabled only. Transient debounce/cooldown state lives in Redis only, never retained as history — see [ADR 0020](adr/0020-geofencing-and-operational-safety-rules.md) |
| AI model registry (Phase 3 Step 14) | SUPER_ADMIN (registration only) | `platform.ai_models.read/manage`, SUPER_ADMIN only; **never school staff, never parents** | Platform-wide, not per-school; version rows never mutated/deleted, only status-transitioned — see [ADR 0021](adr/0021-edge-ai-computer-vision-pipeline-foundation.md) |
| AI observations (Phase 3 Steps 14-15) | Authenticated edge device (`EDGE_COMPUTER`), one per detected event, deduplicated within a time window | `ai_events.read` (view) / `ai_events.review` (review/dismiss/promote) roles only; **never parents, never drivers/attendants** | No retention/purge job yet — same not-yet-decided state as GPS telemetry (see §4). A `SafetyEvent` is created from one only via an explicit, authenticated staff promotion — never automatically |
| AI safety policies (Phase 3 Step 15) | School staff (configuration only) | `ai_safety_policies.*` roles only; **never parents, never drivers/attendants** | Kept indefinitely, enabled/disabled only — same lifecycle discipline as `safety_rules` |
| Notifications (Phase 1 Step 9) | System (derived from the events above) | The one addressed recipient only — a specific parent or a specific staff member, never a school-wide broadcast list | Not purged yet — see the implementation-status note below |
| Audit logs | System | `audit_logs.read` roles only | Long retention (compliance), append-only |

Concrete retention day-counts above are defaults, not fixed — see §4.

**Implementation status (Phase 2 Step 12):** safety events and emergency
management are now real — a human operator, driver, or attendant can
report a safety observation or trigger an emergency, and operational staff
can triage/respond to it, all genuinely stored and enforced. No AI,
computer vision, facial/behavior recognition, or geofencing is involved
anywhere in this — every event's `source` is `HUMAN_OPERATOR`/`DRIVER`/
`ATTENDANT` (device/camera/system sources exist in the schema for future
use but nothing currently produces them; see
[ADR 0019](adr/0019-safety-events-and-emergency-management.md)). No parent
capability exists on any of this data — not a permission gap to be widened
later, but a hard product requirement, identical in spirit to Step 11's
camera stance: there is no parent-audience route on either controller, no
safety/emergency field on any parent DTO, and no safety/emergency event on
the parent realtime channel. Data collected is deliberately minimal:
`description`/`reason`/`resolutionNote` are free-text fields an operator
types themselves, and `metadata` is a small, Zod-bounded blob — no face
data, no biometric identifiers, no raw video, and no image is ever
automatically captured.

**Implementation status (Phase 2 Step 11):** camera *inventory and device
management* is now real — a camera's name/position/status/manufacturer/
model/serial number/firmware version/connectivity, and its heartbeat
credential — is genuinely stored and staff-manageable, split into the new
"Camera inventory & metadata" row above (distinct from the pre-existing
"Camera footage/clips/streaming" row, which remains entirely unbuilt: no
footage is ever captured, stored, or retrievable in this phase). No parent
capability exists on this data at all — not a permission gap to be widened
later, but a hard product requirement (there is no parent-audience route,
no camera field on any parent DTO, and no camera event on the parent
realtime channel — see [ADR 0018](adr/0018-camera-device-management-foundation.md)).
No recording, snapshot, AI processing, or stream-viewing capability exists
either; `GET /cameras/:id/stream` always reports the feed as not
configured (or, only in a non-production dev/test configuration, an
explicitly-labeled simulated placeholder), never a real playable stream.
Camera device-heartbeat diagnostic data (`BusDevice.lastHealth`) is a small
bounded blob the device itself reports (e.g. temperature, disk usage) —
never footage, never an image, never anything derived from what the camera
actually sees.

**Implementation status (Phase 1 Step 9):** notification content is
deliberately minimal — pre-rendered plain-language `title`/`body` text
from a centralized template (never assembled from a domain record at read
time) plus a small `payload` pointer (e.g. `{tripId}`). A notification
**never** contains: raw GPS coordinates, a device id, who recorded an
attendance event, correction details, internal database ids beyond the
one pointer field, or another student's/parent's/staff member's
information. External delivery (PUSH/SMS/EMAIL) is prepared at the
interface level but not operational — no real provider is configured (see
[ADR 0016](adr/0016-notifications-and-alerts.md)), so a parent's
email/phone is read internally to *attempt* delivery but no message
actually leaves the system; the attempt itself is logged clearly as
unconfigured, never as a fake "sent" confirmation. No retention/purge job
exists yet for the `notifications`/`notification_deliveries` tables
(tracked in [roadmap.md](roadmap.md)).

**Implementation status (Phase 1 Step 8):** parent access to trip/attendance/
location data is now real, superseding the "does not exist yet" statements
in the Step 6 and Step 7 notes below. Concretely, `GET /parent/children`
(enriched) and `GET /parent/children/:studentId/transport` give a parent a
**simplified, parent-safe view only**: which of the four attendance states
their own child is in, a plain-text trip status, a bus display name
(never an id), and — only while that specific trip is `IN_PROGRESS` — a
current latitude/longitude/speed/heading and freshness identical to what
staff see for the same bus. A parent still never receives: raw
`AttendanceEvent` history or corrections, who recorded an event, any
`TripStudent`/`Trip`/`Bus`/`BusDevice`/`GpsPoint` id, historical GPS
telemetry, or a location for any trip that isn't currently in progress
(see [ADR 0015](adr/0015-parent-transport-tracking.md) for the exact field
list). This is delivered as a live *view* (REST + a dedicated
`/realtime/parent` WebSocket channel) — no push notification (SMS/email/
native push) exists yet; that remains Phase 1 Step 9, exactly as the
now-superseded notes below anticipated.

**Implementation status (Phase 1 Step 7):** the "GPS points" row above is
only partially built. Raw telemetry (`GpsPoint`) and a Redis-backed current
location are real, and staff can read them per RBAC (`gps.read`, with
`DRIVER`/`BUS_ATTENDANT` scoped to their own currently-assigned bus — see
security.md §5.6). **"parent sees only current/derived location" does not
exist yet** — there is no parent-facing location endpoint or realtime
channel at all in this phase; that row's parent column describes the
Phase 1 Step 8 target, not current behavior. `GPS_TELEMETRY_RETENTION_DAYS`
(default 90) exists as a config placeholder only — no purge/aggregation job
runs yet, so raw points are currently kept indefinitely (tracked in
[roadmap.md](roadmap.md)); "short window then aggregated/discarded" above
is the intended, not-yet-built policy.

**Implementation status (Phase 1 Step 6):** the "Attendance/boarding events"
row above is only partially built. `AttendanceEvent` rows (boarding/
drop-off/absence/correction, `MANUAL` source only — no device/QR/RFID/AI
source is wired up yet) are real and staff can read/write them per RBAC.
**"parent sees own child's events" does not exist yet** — there is no
parent-facing attendance endpoint at all in this phase; the table's parent
column describes the eventual target, not current behavior. No retention
job runs yet either (tracked in [roadmap.md](roadmap.md)); events are kept
indefinitely for now, same as the trip manifest row above.

**Implementation status (Phase 1 Step 2):** the student profile and parent
profile rows above are now real, not just planned — `admissionNumber`,
`fullName`, `dateOfBirth`, `grade`, `section` for students (no photo field yet;
`photo_file_id` remains a Phase 2 addition once file storage is wired to a
real upload flow) and `phone`, `fullName`, `email` for parents. The
parent-student relationship itself carries a privacy-relevant state: a link is
`unverified` (created by staff, e.g. from an admission form) or `verified`
(staff-confirmed) — **only verified links are ever exposed to the parent**
(`GET /parent/children`, `GET /parent/children/:studentId`); an unverified
link grants no read access at all, so a data-entry mistake linking the wrong
parent cannot leak a child's name/grade before a human confirms it. Retention
jobs, the compliance checklist, and the export/deletion operations below
remain unbuilt (tracked in [roadmap.md](roadmap.md)) — Phase 1 Step 2 built
the data model and the access boundary around it, not the lifecycle tooling.

## 3. Parent Access Boundary (privacy view of the security control)

This restates the boundary defined in
[security.md](security.md#4-parent-data-access-boundary) from the data-purpose
angle: a parent does not have a "hidden" higher access level gated only by a missing
UI button anywhere in the system. The following are **structurally unreachable**
from any parent-authenticated session, not merely unlinked in the parent UI:

- Camera feeds or recordings, in any resolution or delayed form.
- The camera inventory itself (Phase 2 Step 11) — a camera's existence,
  name, position, status, connectivity/health, manufacturer/model, serial
  number, or credential state. There is no parent-audience camera route,
  no camera field on any parent DTO, and no camera event on the parent
  realtime channel — not an oversight to close later, a hard product
  requirement (see [ADR 0018](adr/0018-camera-device-management-foundation.md)).
- Safety events or emergency records, in any form (Phase 2 Step 12) — no
  parent-audience route, DTO field, or realtime event exists for either;
  a parent is never told their child's bus had a reported safety event or
  an active emergency through this system (see
  [ADR 0019](adr/0019-safety-events-and-emergency-management.md); if a
  future product decision requires notifying parents of a real emergency,
  that would be a new, deliberately-designed parent-safe notification
  template — never exposure of the internal `SafetyEvent`/`Emergency`
  object).
- Geofences or safety rules, in any form (Phase 2 Step 13) — no
  parent-audience route or DTO field exists for either `Geofence` or
  `SafetyRule`, and no geofence/rule event is ever pushed on the parent
  realtime channel. A system-generated safety event produced by a fired
  rule (e.g. exiting a school geofence, exceeding a configured speed
  threshold) is subject to the exact same boundary as any other
  `SafetyEvent` above — a parent is never told a rule fired, what the
  rule's configuration is, or that geofencing/rule evaluation exists at
  all; their transport tracking view continues to show only the
  pre-existing safe location summary, unchanged by this step (see
  [ADR 0020](adr/0020-geofencing-and-operational-safety-rules.md)).
- AI-generated observations, detection types, confidence scores, model
  metadata, review decisions/notes, AI safety policy configuration, safety
  analytics, or camera-frame/edge-device internals of any kind (Phase 3
  Steps 14-15) — no parent-audience route or DTO field exists for
  `AIObservation`/`AIModel`/`AiSafetyPolicy`, and no AI event is ever
  pushed on the parent realtime channel. A parent has no way to learn that
  edge-AI processing exists on their child's bus at all through this
  system — see
  [ADR 0021](adr/0021-edge-ai-computer-vision-pipeline-foundation.md) and
  [ADR 0022](adr/0022-ai-observation-review-and-safety-analytics.md). Even
  when an AI observation is promoted into a `SafetyEvent` (Step 15), that
  `SafetyEvent` is subject to the exact same parent-invisibility boundary
  as any other — a parent is never told the event originated from AI, and
  never sees the source observation, its confidence, or the reviewing
  staff member's identity.
- Incident records or investigation notes.
- Any other student's data, including siblings' classmates on the same bus.
- Any other bus/route not currently carrying their verified child.
- Driver/attendant personal data beyond what the school chooses to expose (default:
  first name + bus assignment; not phone/address/license number). As of Phase 1
  Step 8, driver/attendant identity isn't exposed to parents **at all** yet — the
  transport view surfaces only a bus display name, no crew information.
- Raw GPS telemetry history, device IDs, device metadata, or device credentials
  (Phase 1 Step 8) — a parent's location view is always the current-moment
  snapshot for their own child's active trip only, computed server-side; there
  is no endpoint that returns a list of past positions or any `GpsPoint`/
  `BusDevice` row to a parent session.
- Internal attendance event history, corrections, or who recorded an event
  (Phase 1 Step 8) — a parent sees one of four simplified states
  (`EXPECTED`/`BOARDED`/`ABSENT`/`DROPPED_OFF`), never `AttendanceEvent` rows.
- Any internal database id (`Trip`/`TripStudent`/`Bus`/`BusDevice`/`GpsPoint`)
  — the parent transport DTOs (Phase 1 Step 8) are hand-built and never
  serialize an internal entity.
- Another parent's notifications, or any notification not addressed to
  them (Phase 1 Step 9) — recipient resolution is entirely server-side,
  from verified `ParentStudent` relationships; there is no field anywhere
  in the notification API a parent could use to name a different
  recipient, and no endpoint lists another parent's inbox.
- Any staff-only operational alert (`GPS_STALE`/`GPS_OFFLINE`, or the
  staff-facing copy of a `TRIP_CANCELLED`/`TRIP_NO_SHOW` alert) — these are
  a completely separate notification stream (`recipientType = 'USER'`)
  that no parent-facing endpoint or room ever reads from.

## 4. Retention & Deletion

- Retention windows are **school-level configuration** (`system_config` module),
  with platform-enforced sane defaults and maximums, not per-record manual
  decisions.
- A scheduled retention job (not manual deletion) purges/anonymizes data past its
  window: `gps_points` are aggregated then dropped, `attendance_events` older than
  the configured window are archived (exported, then removed from the primary
  store) rather than kept indefinitely "just in case."
- Incident-linked files/events are exempt from routine retention deletion until the
  incident is resolved and its own (typically longer) retention window elapses —
  investigations must not lose evidence mid-review.
- **Right to deletion** (⚠️ legal to confirm applicability/exceptions under DPDPA):
  a school admin can request erasure of a specific student/parent's data; the
  system supports this as a first-class operation (not a manual DB script) that
  respects legal-hold flags on records tied to an open incident.
- **Data export**: a parent or school admin can request a machine-readable export
  of the data the platform holds about a given student, scoped exactly to what that
  requester is authorized to see per §3 (a parent's export is the same shape as
  their in-app view, not an internal dump).

## 5. Access Logging

All reads of `students`, `ai_events`, `incidents`, and `files` of type
`INCIDENT_CLIP`/`STUDENT_PHOTO` are written to `audit_logs`, including staff reads
(not just writes), because over-access by authorized-but-curious staff is a real
child-privacy risk distinct from external attackers. Reports on "who viewed this
child's data" are a first-class query against `audit_logs`, not an afterthought.

## 6. AI-Specific Privacy Controls

See [ai-safety.md](ai-safety.md) for the original design model,
[ADR 0021](adr/0021-edge-ai-computer-vision-pipeline-foundation.md) for
the pipeline foundation (device auth, model registry, `AIObservation`
ingestion/reads), and
[ADR 0022](adr/0022-ai-observation-review-and-safety-analytics.md) for the
human-review/promotion workflow and safety analytics that complete this
platform's planned AI scope. Privacy-relevant constraints, updated to
reflect what is real as of Step 15 — the final planned implementation
step:

- **Edge inference is the only implemented path, and no raw video/frame
  ever reaches this platform.** The edge device runs inference locally and
  submits only a small, structured, already-normalized result (detection
  type, a bounded confidence number, a timestamp, model name/version, an
  optional small metadata blob) — there is no endpoint anywhere in this
  codebase that accepts a frame, a clip, or any video payload.
- **No facial recognition, no biometric embeddings, no identity matching,
  structurally, not just by policy.** `AIDetectionType` is a closed,
  objective, physical-event enum (`PERSON_DETECTED`, `PERSON_COUNT`,
  `OBJECT_DETECTED`, `FALL_DETECTED`, `SMOKE_DETECTED`, `FIRE_DETECTED`,
  `DOOR_STATE_DETECTED`, `UNUSUAL_MOTION`) — there is no schema value,
  column, or code path in this module that could carry a face embedding, a
  biometric template, or a `studentId`. `AIObservationDto` has no identity
  field of any kind. The hypothetical future biometric *boarding* feature
  ai-safety.md and §1 above already flag as a fully separate, legally-
  reviewed decision remains untouched — nothing in this step moves toward
  it implicitly.
- **No evidence/snapshot storage exists.** `AIObservation.evidenceReference`
  is always `null` in this step — no clip/snapshot storage integration was
  built, and none is fabricated to look like one.
- **Parent has zero AI-observation access, including after promotion.** No
  parent-audience route, DTO field, or realtime event exists for
  `AIObservation`/`AIModel`/`AiSafetyPolicy` anywhere — see §3 below. When
  a staff member promotes an observation into a `SafetyEvent`, that event
  is exactly as invisible to parents as any other `SafetyEvent` — a
  promoted event's AI origin, confidence, and reviewing staff member are
  never surfaced to a parent under any circumstance.
- **AI observations, their review, and safety analytics are internal
  operational data**, visible only to staff holding `ai_events.read`
  (view), `ai_events.review` (review/dismiss/promote),
  `ai_safety_policies.*` (policy configuration), or `safety_analytics.read`
  (aggregated trends) — all pre-existing or newly-added permissions, none
  ever granted to `DRIVER`/`BUS_ATTENDANT`/`PARENT` (see
  [security.md](security.md#23-default-role--permission-matrix-mvp-scope-phase-23-permissions-granted)).
  Model confidence is a statement about the model's own certainty in the
  detection, never a probability of harm, guilt, or any judgment about a
  person — this distinction is documented on the DTO itself and surfaced
  in the staff UI, not left implicit. Safety analytics returns aggregated
  counts only — no endpoint returns raw observation or event rows.
- **Retention is not yet decided** — `AIObservation`/`AiSafetyPolicy` rows
  have no purge job and no configured retention window, the same
  not-yet-decided state GPS telemetry and other operational tables are
  already in (see §4); this remains a business/legal decision, not an
  engineering default.
- **The human-review boundary is structural, not a policy toggle.** No
  code path anywhere in this codebase — not the ingestion path, not a
  confidence threshold, not a policy configuration — can create a
  `SafetyEvent` or `Emergency` from an `AIObservation` without an
  authenticated staff member explicitly calling
  `POST /ai-observations/:id/promote`. `AiSafetyPolicy.requiresHumanReview`
  is stored but not read by any code path that could act on `false` —
  review remains unconditional regardless of its value (see
  [ADR 0022](adr/0022-ai-observation-review-and-safety-analytics.md)
  Decision 4). An Emergency is never created automatically from a promoted
  event either — escalation remains the same explicit human action
  established in Phase 2 Step 12.
- This section makes no legal-compliance claim — see the checklist in §7
  below, which still applies in full to this data category.

## 7. Compliance Checklist (⚠️ all items require legal/privacy professional review
before production launch — this is an engineering starting point, not a compliance
determination)

- [ ] ⚠️ DPDPA 2023 applicability review, including children's-data consent
      mechanics (verifiable parental consent flow) and Significant Data Fiduciary
      criteria if user volume crosses relevant thresholds.
- [ ] ⚠️ School-as-controller / platform-as-processor contract terms (DPA).
- [ ] ⚠️ State-specific school regulatory requirements (if any) on transport safety
      record-keeping.
- [ ] ⚠️ Biometric data handling review before any facial-recognition feature is
      enabled for any school (see §1.4).
- [ ] ⚠️ Data localization requirements for storage/processing location.
- [ ] ⚠️ Incident/camera clip evidentiary requirements if data is ever used in a
      school disciplinary process or shared with law enforcement/parents under
      legal compulsion.
- [ ] ⚠️ Data breach notification obligations and incident-response plan.
- [ ] Engineering: retention job implemented and tested (tracked in
      [roadmap.md](roadmap.md)).
- [ ] Engineering: data export endpoint implemented and tested.
- [ ] Engineering: access-logging coverage verified for all PII-bearing reads.
