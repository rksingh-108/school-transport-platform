# ADR 0015: Parent Transport Tracking — Safe DTOs, Active-Trip Resolution, Realtime Isolation

Status: Accepted
Date: 2026-08-30

## Context

Phase 1 Step 8 gives parents a read-only view of their own child's transport
state — is my child on a trip, have they boarded, where is the bus, has
their been dropped off — built entirely on infrastructure already shipped
in Steps 2 (parent auth/verified relationships), 5 (trips/manifests), 6
(attendance projection), and 7 (GPS current-location + realtime). No new
domain model was needed; this phase is a composition/exposure layer with
its own strict data boundary, not a new source of truth.

## Decisions

### 1. Dedicated parent-safe DTOs, never a passthrough of internal types

`ParentTransportDto` and `ParentChildTransportSummaryDto`
(`packages/shared-types/src/domain.ts`) are hand-built, not aliases or
subsets computed at the type level from `TripDto`/`TripStudentDto`/
`BusLocationDto`. Concretely excluded, on every parent-facing response:
`deviceId`, `schoolId`, `driverId`, `attendantId`, `recordedBy`,
`accuracyM`, raw telemetry history, correction/audit metadata, and any
other student's or parent's data. `bus` is reduced to a single
`displayName` string (`fleetNumber` prefixed with "Bus", falling back to
`registrationNumber`) — a parent never sees a bus's internal id.
`attendance` is one of the four states `AttendanceService` actually writes
(`EXPECTED`/`BOARDED`/`ABSENT`/`DROPPED_OFF`) with only `boardedAt`/
`droppedOffAt` — never the full `AttendanceEvent` history, never who
recorded it, never a correction record.

### 2. Active-trip resolution: in-progress first, then today, then recent-past

A parent never supplies a Trip ID. `ParentTransportService.resolveActiveTripStudent`
picks the one relevant `TripStudent` for a child with a simple, explicit
priority, not a generic "most recent" query:

1. Any trip currently `IN_PROGRESS` for this student, regardless of date —
   a trip running past midnight is still the relevant one.
2. Otherwise, among today's trips (school-timezone "today", via
   `Intl.DateTimeFormat('en-CA', { timeZone })`), the soonest-starting
   `SCHEDULED`/`READY` one.
3. Otherwise, today's most-recently-ended `COMPLETED`/`CANCELLED`/
   `NO_SHOW` trip — so a parent still sees "dropped off"/"cancelled" for a
   while after the trip ends, rather than the screen suddenly showing
   nothing.
4. Otherwise, no trip at all — `trip`/`attendance`/`bus`/`location` are all
   `null` together.

This is at most two small, indexed queries per child (an `IN_PROGRESS`
check, then a same-day list only if that first check misses) — bounded by
however many children one parent has, not school size. `getMyChildren`
resolves this once per verified child in parallel
(`Promise.all`), which is the actual "avoid N+1" requirement here: the
concern is per-row-of-a-large-result-set fan-out, not a couple of queries
for a parent's own 1–3 children.

### 3. Location is shown only while the trip is `IN_PROGRESS`

`ParentTransportDto.location` is `null` for every trip status except
`IN_PROGRESS` — a parent is never shown a location for a trip that hasn't
started (nothing to show yet) or has already ended (would misleadingly
imply the child is still on a moving bus). While `IN_PROGRESS`,
`GpsService.getLocationSnapshotForBus` (a new public entry point,
Phase 1 Step 8) is called with the bus resolved through the child's own
active trip — never a client-supplied bus id — reusing the exact same
Redis-backed current-location/freshness pipeline Step 7 built for staff, no
parallel implementation. `freshness` (`LIVE`/`STALE`/`UNKNOWN`) is the
identical value staff see for the same bus at the same moment — there is
only one freshness calculation in the whole system.

### 4. `GET /parent/children` carries a transport summary in the same response

Rather than adding an overlapping `/parent/children/summary`-type endpoint,
the existing `GET /parent/children` (Phase 1 Step 2) was extended in place:
each entry gains a `transport: ParentChildTransportSummaryDto` field
(trip/attendance status text, bus display name, freshness — no
coordinates). `GET /parent/children/:studentId` (Step 2's plain
identity-only lookup) is untouched, still returns `ParentLinkedChildDto`
with no transport field — a different consumer, a different need. The one
new detail endpoint, `GET /parent/children/:studentId/transport`, returns
the full `ParentTransportDto` (with coordinates) for the child a parent has
actually opened. This is the "smallest clean surface" the spec asked for:
one enriched list endpoint, one detail endpoint, no third
"active-trip"-only endpoint returning data already covered by the other
two.

### 5. Realtime: a separate namespace, driven by the existing GPS event via an in-process EventEmitter

`ParentGateway` (`/realtime/parent`) is a completely separate Socket.IO
namespace from `GpsGateway`'s `/realtime/fleet` — a parent socket never
connects to the staff namespace at all (rejected identically to an
unauthenticated connection if it tries, per Step 7's existing behavior).
On connect, `ParentGateway` resolves the caller's verified children via the
existing `ParentAccessService.getVerifiedChildIds` and joins exactly those
`parent:child:{studentId}` rooms — computed entirely server-side; there is
no `@SubscribeMessage` handler at all, so there is no code path for a
client to request, discover, or join an arbitrary room (`school:{id}:fleet`,
`school:{id}:bus:{busId}`, or another child's room).

Rather than duplicating the current-location/monotonic-timestamp pipeline,
`GpsGateway` gained a plain Node `EventEmitter` (`onLocationUpdate`/internal
`emit`) fired every time it emits `bus.location.updated` to staff. This
keeps the dependency direction one-way — `parents` module imports `gps`,
never the reverse — while letting `ParentGateway` react to every accepted,
monotonically-newer fix without `GpsGateway`/`GpsService` needing to know
parents exist. `ParentGateway.handleLocationUpdate` looks up which
students are on the update's trip (`TripStudent` by `tripId`, an indexed
lookup) and emits a `parent.child.transport.updated` event
(`ParentChildTransportUpdatedEvent` — same exclusion list as
`ParentTransportDto`) into each affected child's room.

**Accepted simplification**: the realtime push is GPS-triggered only. A
boarding/drop-off event with no GPS fix arriving in between it and the next
one won't independently trigger a push in this phase — `AttendanceService`
was not touched to add a second trigger, to avoid a second cross-module
wiring for a lower-value signal (attendance changes are discrete and rare;
location changes are frequent and are what "realtime" is actually for
here). A trip that's `IN_PROGRESS` normally has frequent GPS pings anyway,
so a boarding event is reflected within seconds by the very next tick; the
REST endpoint always reflects the true current state on page load or
socket reconnect regardless.

### 6. No new tables, no new migration

Every read in this phase composes existing tables (`Student`,
`ParentStudent`, `Trip`, `TripStudent`, `Bus`, `GpsPoint`/Redis current
state) through existing RLS-protected `runInTenantContext` queries. No
schema change was needed or made.

## Consequences

- `ParentTransportService`/`ParentGateway` are the only new backend
  components; both are thin composition layers over already-tested
  services (`GpsService`, and direct Prisma reads matching the exact
  pattern `AttendanceService`/`GpsService` already use for cross-domain
  reads without importing each other's full service).
- A parent-facing "historical trip" or "past trips" view was explicitly out
  of scope this phase (item 10 of the spec) — `resolveActiveTripStudent`
  only ever returns *the* current/most-relevant trip, never a
  client-selectable one. Historical viewing, if wanted later, needs its own
  explicit, narrowly-scoped design (a real Trip ID would need to be proven
  to belong to a verified child's own history, not just any trip).
- Push notifications (SMS/email/native push) remain entirely unbuilt —
  this phase's realtime channel is a live *view* while the app is open, not
  a notification system. That is Phase 1 Step 9.
