# ADR 0013: Attendance Event Model — Boarding, Drop-off, Absence, Correction

Status: Accepted
Date: 2026-08-30

## Context

Phase 1 Step 6 adds real boarding/drop-off/absence tracking on top of the
Trip manifest (Phase 1 Step 5). Three things needed a real decision:

1. How does "did this student board" relate to "is this student planned on
   this trip" (`TripStudent.membershipStatus`, Step 5)? These must stay
   separate concepts.
2. How is a mistaken event fixed without destroying the audit trail?
3. How does a `BUS_ATTENDANT` get scoped to only their own trip when they
   hold the *same* `attendance.manage` permission key as an unrestricted
   role (`TRANSPORT_MANAGER`)?

## Decisions

### 1. `AttendanceEvent` is the fact log; `TripStudent` carries a derived projection

Every boarding/drop-off/absence action inserts a new, immutable
`AttendanceEvent` row. `TripStudent.currentStatus` (`EXPECTED`/`BOARDED`/
`ABSENT`/`DROPPED_OFF` — a field already scaffolded in Phase 0, deliberately
left untouched through Step 5) plus two new columns, `boardedAt`/
`droppedOffAt`, are a **derived, denormalized projection** of "the most
recent event for this student" — written only by `AttendanceService`, never
directly by `TripStudentsService`. This is the same rule already documented
for `currentStatus` in `docs/database.md` since Phase 0, now actually wired
up. It exists purely so the manifest list (`GET /trips/:id/students`) can
show live attendance state in the one query it already makes — no N+1 join
against `attendance_events` for every row.

No separate stop-name columns were added alongside `boardedAt`/
`droppedOffAt`: a boarding event's stop is always the student's own
`pickupTripStopId` (see decision 3), so the existing `pickupStopName`/
`dropoffStopName` fields already say where it happened.

### 2. A correction is a new event, never an edit

`POST .../attendance/:eventId/correct` creates a **new** `AttendanceEvent`
row with `correctsEventId` pointing at the one it supersedes — the original
row is never updated or deleted. "Current state" is simply whichever event
has the latest `createdAt` for that `TripStudent`, correction or not, so a
correction always wins going forward while the full sequence — original,
then correction — remains queryable via
`GET .../attendance` for audit. No `STATUS_CORRECTED` event type is used
for this (that value exists in the Phase 0 enum scaffold but sits unused,
same as `ARRIVED_AT_SCHOOL`): a correction's `eventType` is simply the
*actual* corrected type (`BOARDING_CONFIRMED`/`DROPPED_OFF`/
`MARKED_ABSENT`), because it needs the same type-specific stop-derivation
logic as a normal event of that type, not a fourth, separate shape.

Corrections are exempt from the normal operational-state gate (a trip must
be `IN_PROGRESS` to record a *normal* boarding/drop-off) — fixing a
past mistake doesn't depend on the trip still being underway, and often
happens after it's `COMPLETED`.

### 3. Duplicate prevention is a reject, not a silent idempotent success

A second `/board` call on an already-`BOARDED` student returns `400`,
rather than silently succeeding again. This was a deliberate choice over
treating it as idempotent: a double-click retry and a genuine "attendant
tapped board a second time by habit" look identical over HTTP, and
rejecting surfaces the mistake immediately rather than potentially masking
a caller's wrong assumption about current state. The same reject-not-merge
rule applies to duplicate drop-off and duplicate absence.

### 4. `BUS_ATTENDANT`'s "own trip only" scoping is resolved by profile, not permission

The seeded matrix (`docs/security.md` §2.3, unchanged from Phase 0) grants
`attendance.manage` to both `TRANSPORT_MANAGER` (unscoped) and
`BUS_ATTENDANT` ("own trip only") — the *same* permission string, so the
permission-level trick used in Phase 1 Step 5 for `DRIVER` (a strictly
weaker permission than `trips.manage`) doesn't apply here; both roles pass
an identical `@RequirePermission('attendance.manage')` guard. Instead,
`AttendanceService` resolves scope by looking up whether the caller has an
`Attendant` **profile** at all (`Attendant.findUnique({ where: { userId } })`)
— if they do, they may only act on trips where `trip.attendantId` matches
that profile; if they don't (e.g. `TRANSPORT_MANAGER`, who typically has no
`Attendant` row), no restriction applies. This is the same
profile-based-not-role-name-based pattern `TripsService` already uses for
`DRIVER`'s own-trip scoping (Phase 1 Step 5) — authorization is tied to the
actual operational relationship, not an RBAC role label. A person who is
*both* an attendant profile-holder and a `TRANSPORT_MANAGER` would still be
scoped down (the profile check runs first) — an accepted, deliberately
conservative edge case.

`attendance.read` was missing from `BUS_ATTENDANT`'s seeded grants (a
Phase 0 gap — they had `attendance.manage` but not the weaker read
permission the manifest/history endpoints also check), fixed while
reviewing existing grants, the same kind of correction made for
`TRANSPORT_MANAGER`'s fleet visibility (Step 3) and `DRIVER`'s over-broad
`trips.manage` (Step 5).

### 5. Absence has its own, narrower state-transition rule

`MARKED_ABSENT` is allowed only from `EXPECTED` (never from `BOARDED`/
`DROPPED_OFF` — the instruction is explicit that "not boarded yet" must
never be confused with "absent," and the reverse direction, un-boarding
someone by marking them absent, would be exactly that confusion; a
correction is the right tool if a `BOARDED` mark was itself the mistake).
Unlike boarding/drop-off, marking absence is allowed while the trip is
still `SCHEDULED`/`READY` — a parent calling in sick before the bus even
leaves is a normal, common case, not an edge case to special-case around.

## Consequences

- Every attendance write is a single transaction: load trip + manifest
  entry, check tenant/authorization/operational-state/duplicate rules,
  insert the event, update the projection — all inside
  `runInTenantContext`, matching every other write path in this codebase.
- `recordedBy` is always the authenticated principal's id, taken from
  `AuthenticatedPrincipal`, never from the request body — there is no
  `recordedByUserId` field in any request schema for a client to even
  attempt to spoof.
- A future device/QR/RFID/AI attendance source only needs a new
  `AttendanceEventSource` value and a new code path that creates the same
  `AttendanceEvent` shape — the model does not need to change.
