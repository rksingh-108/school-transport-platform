# ADR 0019: Safety Events and Emergency Management

Status: Accepted
Date: 2026-08-30

## Context

Phase 2 Step 12 builds the safety-operations foundation: human/operator-
generated safety observations, a controlled triage workflow, and a real
emergency-response workflow — explicitly **not** AI, computer vision,
facial/behavior recognition, or geofencing, all deferred to Phase 3 or
later Phase 2 steps. The platform already has cameras (Phase 2 Step 11),
trips/GPS/attendance (Phase 1), notifications (Phase 1 Step 9), and RBAC/
RLS/audit infrastructure — this step reuses all of it rather than building
parallel mechanisms.

## Decision 1: SafetyEvent and Emergency are two separate models, not one

"A potentially relevant safety observation occurred" (SafetyEvent) and "a
confirmed operational/safety issue requiring response" (Emergency) are
deliberately distinct, not two statuses on one table. This matters
specifically because Phase 3's AI integration will produce *candidate*
SafetyEvents a human must review — collapsing the two concepts now would
mean either AI output could reach the emergency workflow unreviewed, or a
later migration would have to split them apart under real data. The
`SafetyEvent.status` lifecycle (`NEW → ACKNOWLEDGED/DISMISSED/ESCALATED/
RESOLVED`) reflects *triage*; `Emergency.status`
(`ACTIVE → ACKNOWLEDGED → RESOLVED`, or `→ CANCELLED`) reflects *response*.
Not every SafetyEvent becomes an Emergency — most are dismissed or resolved
directly; escalation is one explicit, human-triggered action
(`POST /safety-events/:id/escalate`), never automatic on severity alone
(a CRITICAL event does not silently spawn an Emergency — see Decision 4 on
what CRITICAL severity *does* trigger).

## Decision 2: `Camera` reused; `SafetyEvent`/`Emergency` are new, thin, tenant-scoped tables

Both new tables (`safety_events`, `emergencies`, plus the append-only
`emergency_actions`) follow the same conventions established throughout
this schema: UUID PKs, denormalized `schoolId` for RLS, a plain
`tenant_isolation` RLS policy (no platform-admin bypass — neither table is
ever queried pre-tenant, unlike `bus_devices`' credential-lookup case).
`SafetyEvent.cameraId`/`busId`/`tripId` are all optional and independently
nullable — a `MANUAL_ALERT` from an operator reviewing footage after the
fact may have no bus/trip context at all, while a `DRIVER_ALERT` always
has both (see Decision 3). No new device, credential, or camera-adjacent
model was introduced; a SafetyEvent simply references an existing `Camera`
row when relevant.

**Fields deliberately not stored**: no face embeddings, no biometric
identifiers, no raw video, no automatically-captured images. `metadata` is
a small, Zod-bounded JSON blob for operator-entered context, not an
arbitrary payload.

## Decision 3: Profile-based own-scope authorization, reusing the established pattern exactly

DRIVER/BUS_ATTENDANT creating a SafetyEvent or triggering an Emergency are
scoped to their own currently-`IN_PROGRESS` trip — resolved via the
identical `Driver`/`Attendant` profile lookup + current-trip query already
used by `GpsService.resolveGpsScope` and `TripsService.assertCanOperate`
(Phase 1). No new scoping mechanism was invented. Concretely:

- If the principal has a `Driver` or `Attendant` profile, they are *always*
  scope-restricted (regardless of what other permissions their account
  might also hold) — a supplied `busId`/`tripId` that doesn't match their
  own current trip is `403`; omitting both auto-fills from their own trip;
  having no current trip at all and supplying neither is `400` (see
  Decision 6).
- Otherwise (a staff principal with no Driver/Attendant profile), any
  `busId`/`tripId`/`cameraId` supplied is verified against the caller's own
  tenant only — never against a "current trip," since staff aren't tied to
  one.

Controllers gate `POST /safety-events` and `POST /emergencies` by the
*narrowest* permission every eligible caller holds
(`safety_events.create`/`emergency.create`), with the real scope decision
made inside the service — the exact same "gate by the shared weak
permission, authorize for real in the service" pattern
`TripsController`/`TripsService` already use for `/start`/`/complete`
(documented in that controller's own docstring).

## Decision 4: New singular permissions, not a new pluralized scheme — and two real RBAC gaps closed

`emergency.create`/`emergency.read` already existed in `rbac.ts` since
Phase 0, reserved for this exact module. This step adds `emergency.manage`
(lifecycle transitions) as a sibling of that existing pair, and
`safety_events.create`/`safety_events.read`/`safety_events.manage` as a new
trio — reusing the codebase's established singular-permission-per-domain
convention (`gps.read`, `attendance.read`/`.manage`) rather than the spec's
suggested `emergencies.*` plural scheme, which would have sat awkwardly
next to the pre-existing singular `emergency.*` keys in the same domain.

While wiring this up, two real gaps were found and closed the same way
prior phases have closed similar ones (Step 3's `TRANSPORT_MANAGER`
fleet-visibility fix, Step 9's `TRANSPORT_ADMIN`/`PRINCIPAL` notification
fix, Step 11's `SCHOOL_ADMIN`/`PRINCIPAL` camera fix): `emergency.create`
had never actually been granted to any of the four school-operational
staff roles (`SCHOOL_ADMIN`/`PRINCIPAL`/`TRANSPORT_ADMIN`/
`TRANSPORT_MANAGER`) despite this step's own spec explicitly listing
"authorized staff" as able to trigger an emergency directly, not just
DRIVER/BUS_ATTENDANT. Both `emergency.create` and `emergency.manage` were
added to all four roles. `DRIVER`/`BUS_ATTENDANT` remain deliberately
without `emergency.manage`/`safety_events.manage`/`safety_events.read` —
triggering is not the same capability as managing the response, and a
driver who raises an alert does not thereby get to browse or triage every
other event in the school.

## Decision 5: One system-driven transition — `ESCALATED → RESOLVED`

Every SafetyEvent transition is reachable through exactly one guarded
staff endpoint, with one exception: `ESCALATED → RESOLVED` is real and
valid, but is **never** reachable through a direct
`POST /safety-events/:id/resolve` call (that endpoint's transition table
excludes `ESCALATED` entirely). It happens only as a side effect of
`POST /emergencies/:id/resolve`, when that emergency has a
`sourceSafetyEventId` — `EmergenciesService.resolve()` calls
`SafetyEventsService.resolveFromEmergency()` in the same transaction,
which bypasses the normal manual-transition guard by design. This reflects
the real-world shape of the workflow: once escalated, the Emergency is the
live record; the original SafetyEvent report closes automatically when the
response concludes, not through a second manual action on a now-secondary
record. Verified end-to-end in both the e2e suite and a live browser
session (escalate → resolve the resulting emergency → the source event is
independently confirmed `RESOLVED`).

## Decision 6: "No active trip" fails closed with a clear 400, never a guess

If a DRIVER/BUS_ATTENDANT has no currently-`IN_PROGRESS` trip and supplies
no explicit `busId`/`tripId`, both `SafetyEventsService.create()` and
`EmergenciesService.create()` reject with a `400` and an explicit message
("no active trip") rather than silently creating an unscoped record or
guessing a bus. This is a deliberate, explicit policy choice per the step's
own instruction not to guess.

## Decision 7: Realtime is a new, minimal `/realtime/safety` staff namespace

A new Socket.IO namespace, not a reuse of `/realtime/fleet` — the audience
and authorization check differ (`safety_events.read` or `emergency.read`,
not `gps.read`), and conflating them would mean granting fleet visibility
to `SECURITY` and vice versa. Room granularity is a single whole-school
room (`school:{id}:safety`), unlike GPS's fleet-vs-per-bus split: every
role that can see the safety/emergency dashboard at all is meant to see
every event in their school, not a bus-scoped subset. The connection
handshake follows `GpsGateway`'s exact pattern (verify the access token,
resolve the principal, check the permission, join a server-computed room)
— there is no `@SubscribeMessage` handler anywhere on this gateway, so
there is no mechanism for a client to request an arbitrary room. Verified
with a real `socket.io-client`: authorized staff receive
`safety.event.created`/`emergency.created`/`*.updated`; a parent token, no
token, and a DRIVER token (who holds neither `safety_events.read` nor
`emergency.read`) are all rejected identically to an unauthenticated
connection; a School B staff socket never receives School A's events.

## Decision 8: Notifications are narrow and reuse Step 9's infrastructure exactly

Three new `NotificationEventType` values (`SAFETY_EVENT_CRITICAL`,
`EMERGENCY_CREATED`, `EMERGENCY_RESOLVED`), consumed by
`NotificationsService`'s existing `DomainEventsService` subscription — no
second event bus, no new delivery mechanism. Deliberately narrow triggers,
to avoid the notification-storm risk the step's own spec warns about:

- **Not every SafetyEvent notifies staff** — only `severity: 'CRITICAL'`
  does (`SafetyEventsService.create()` only calls
  `domainEvents.publish({ type: 'SAFETY_EVENT_CRITICAL', ... })` in that one
  branch). A LOW/MEDIUM/HIGH event produces zero notifications, verified by
  a dedicated e2e assertion.
- Every Emergency creation (button or escalation) notifies staff
  (`EMERGENCY_CREATED`) — this is the one case where "every occurrence
  notifies" is correct, since an emergency is by definition urgent.
- Resolving an emergency also notifies staff (`EMERGENCY_RESOLVED`) — a
  useful stand-down signal, not required by the spec but low-risk and
  explicitly permitted ("if useful").
- Recipients are the same `resolveOperationalStaffRecipients` helper Step 9
  already uses for `GPS_STALE`/`GPS_OFFLINE`/trip alerts
  (`SCHOOL_ADMIN`/`PRINCIPAL`/`TRANSPORT_ADMIN`/`TRANSPORT_MANAGER`) — no
  new recipient-resolution logic, and no parent ever receives any of these
  three notification types (there is no parent-facing template for them at
  all).

## Decision 9: `CONTACTED_EMERGENCY_SERVICE` never means a real call was placed

`EmergencyAction.actionType` includes `CONTACTED_EMERGENCY_SERVICE`, but
recording one only means an operator logged, after the fact, that *they*
made contact (e.g., by phone) — this platform has no integration with any
external emergency service and never automatically contacts one. This is
stated explicitly here because it is the single easiest thing in this
step to accidentally overclaim.

## Decision 10: No parent-facing surface at all

There is no parent-audience route on `SafetyEventsController` or
`EmergenciesController` (both are `@RequireAudience('STAFF')` only), no
safety/emergency field on any parent DTO
(`ParentTransportDto`/`ParentChildTransportSummaryDto`, both untouched),
and no safety/emergency event on the parent realtime channel
(`ParentGateway` was not modified in this step at all). This mirrors
Phase 2 Step 11's identical camera-privacy stance and is a hard product
requirement, not a permission gap to widen later — see
[privacy.md](../privacy.md).

## Consequences

- Two migrations: one creating `safety_events`/`emergencies`/
  `emergency_actions` (plus their RLS policies) and the new enums; a second,
  separate one adding the three `NotificationEventType` enum values
  (Postgres requires `ALTER TYPE ... ADD VALUE` values to commit before
  they can be used in the same session, so this had to be a second
  migration file — same constraint already documented for
  `CAMERA_CONTROLLER` in Phase 2 Step 11).
- No existing module's behavior changed — GPS, attendance, trips, cameras,
  and parent-facing code are all untouched except for three additive lines
  in `NotificationsService`'s event switch and one new case each in
  `notification-templates.ts` and `domain-event.types.ts`.
- Explicitly out of scope and not attempted: AI/computer-vision detection
  of any kind, geofencing, a driver/attendant-facing mobile UI (the
  backend capability is complete and tested at the API level; no dedicated
  UI exists, consistent with "Driver/Attendant UI" already being an
  unbuilt item in the wider roadmap), recording/snapshot storage, and any
  real external emergency-service integration.
