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
| Camera footage/clips (Phase 2) | Bus camera | Only `camera.read`/`ai_events.review`/`incidents.*` roles; **never parents** | Short default (e.g., 30 days) unless attached to an open incident, then held per incident retention until resolution + defined window |
| AI safety events (Phase 3) | AI service | `ai_events.read/review` roles only | Tied to incident retention if escalated; otherwise short-lived |
| Notifications (Phase 1 Step 9) | System (derived from the events above) | The one addressed recipient only — a specific parent or a specific staff member, never a school-wide broadcast list | Not purged yet — see the implementation-status note below |
| Audit logs | System | `audit_logs.read` roles only | Long retention (compliance), append-only |

Concrete retention day-counts above are defaults, not fixed — see §4.

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
- AI-generated events or confidence scores.
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

See [ai-safety.md](ai-safety.md) for the full model. Privacy-relevant constraints:

- AI event taxonomy is behavior/safety-based (`POTENTIAL_FALL`, `DOOR_OPEN_IN_MOTION`,
  etc.) — never identity- or character-based labels. See
  [ai-safety.md](ai-safety.md#event-taxonomy).
- Prefer edge inference (on the bus) over shipping raw video to the cloud; only
  event metadata + a short evidentiary clip (when an event fires) leaves the
  vehicle, not continuous footage.
- AI outputs are never directly shown to parents, never auto-communicated to
  parents, and never used to auto-generate a disciplinary or behavioral record for
  a child.

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
