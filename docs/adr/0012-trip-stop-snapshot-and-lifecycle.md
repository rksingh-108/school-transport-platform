# ADR 0012: Trip/Route Separation, Stop Snapshotting, and Trip Lifecycle

Status: Accepted
Date: 2026-08-30

## Context

Phase 1 Step 5 introduces the Trip domain — one scheduled/actual execution
of a Route, with a bus/driver/attendant assignment and a student manifest.
Three design questions needed a real decision, not just an implementation:

1. A Route can be edited after Trips already exist against it. How does an
   existing Trip stay historically accurate if its Route's stops change or
   are deleted later?
2. How should a Trip's scheduled time be stored, given the explicit
   instruction to avoid UTC/server/browser timezone bugs?
3. What does "the manifest" mean, distinct from Step 6's attendance
   tracking, which this phase must not implement yet?

## Decisions

### 1. TripStop: a full, immutable snapshot — not a live reference

When a Trip is created, every currently-`ACTIVE` `RouteStop` on its Route is
copied into a new `TripStop` row (own name/address/latitude/longitude/
`expectedOffsetMinutes`/`mode`), inside the same transaction as the Trip
insert. `TripStop.sourceRouteStopId` keeps a traceability pointer back to
the originating `RouteStop`, set to `NULL` (`onDelete: SetNull`) if that
`RouteStop` is later edited into non-existence — but the snapshot's own
data is never touched by that. `TripStudent.pickupTripStopId`/
`dropoffTripStopId` reference `TripStop`, **never** `RouteStop`.

**Rejected alternative**: keep `TripStudent` pointing at the live
`RouteStop` (Phase 0's original scaffold) and rely on "don't let anyone
edit a Route with active trips" as the safety rule. Rejected because it's
strictly weaker — it either blocks legitimate route maintenance work
indefinitely (a route needed for one lingering old trip could never be
corrected) or it silently rewrites history the moment someone does edit it.
A snapshot has no such tension: the route stays freely editable, and no
existing trip's plan can ever change underneath it.

**Rejected alternative**: a reusable `PhysicalStop` entity shared across
routes (and, by extension, across trips). Rejected for the same reason
`RouteStop` didn't get one in Phase 1 Step 4 — nothing yet needs to query
"every trip that used this physical location," and the schema can adopt it
later without disrupting `TripStop`, which would just gain a
`physicalStopId` column pointing at the new table.

**Consequence**: `RouteStopsService.remove()` (Step 4) no longer needs to
block a hard delete on historical trip references — that check existed
specifically because the old design let a live `RouteStop` deletion corrupt
a trip's plan. With the snapshot in place, deleting a `RouteStop` is always
safe (see the updated comment in `apps/api/src/route-stops/route-stops.service.ts`).

### 2. Scheduled times are "HH:mm" wall-clock strings, not `DateTime`

`Trip.scheduledStartTime`/`scheduledEndTime` are validated `"HH:mm"`
strings (24-hour), stored alongside the existing `serviceDate` (a plain
`@db.Date`, no time component). They are **never** converted to an absolute
UTC instant at write time.

**Why**: a scheduled time is a fact about the school's local clock ("this
route leaves at 7am, whatever the calendar date"), not a specific instant
until a specific `serviceDate` and the school's timezone rules for that
exact date are both applied. Pre-computing and storing a UTC instant at
creation time would bake in whatever timezone/DST interpretation happened
to be current then; reading it back naively (e.g., a process assuming
server-local time, or a browser applying its own timezone) is exactly the
"UTC conversion / browser timezone / server timezone / DST" bug class this
phase was told to avoid. Keeping the value as an uninterpreted wall-clock
string sidesteps the whole problem: nothing is ever converted, so nothing
can be converted wrong. `School.timezone` (already on the schema since
Phase 0) is the only piece needed to interpret it, applied fresh wherever
display or comparison actually happens.

`startedAt`/`endedAt`, by contrast, ARE real `DateTime` (timestamptz)
columns — they record a single instant that actually occurred, which is
unambiguous in UTC the moment it happens, unlike a still-future scheduled
time.

**Rejected alternative**: Postgres native `time` (no timezone) via Prisma's
`@db.Time`. Rejected because Prisma represents `Time`-only values as JS
`Date` objects anchored to the 1970-01-01 epoch, and reading the hour/minute
back out correctly requires consistently using UTC-based accessors
(`getUTCHours`, never `getHours`) — a well-documented Prisma footgun. A
validated string sidesteps the ambiguity entirely and is trivially
serializable to a DTO with no accessor to get wrong.

**Conflict detection follows from this**: two trips can only conflict if
they belong to the same school (a resource — bus/driver/attendant — is
always tenant-scoped to exactly one school), so every value being compared
is already in the same school-local wall-clock frame. Overlap is computed
as plain integer minutes-since-midnight arithmetic
(`start1 < end2 && start2 < end1`) on the same `serviceDate` — no timezone
conversion is ever needed for the comparison itself.

**Known limitation**: conflict detection is a check-then-write inside a
single transaction under Postgres's default READ COMMITTED isolation, not
a `SERIALIZABLE` transaction or a database exclusion constraint. Two
concurrent requests booking the same bus into overlapping slots could both
pass the check before either commits. This is the same class of trade-off
already accepted elsewhere in this codebase (e.g. the duplicate-driver-
profile and duplicate-stop-sequence pre-checks) rather than a new one
introduced here — flagged explicitly rather than silently glossed over.

### 3. `MembershipStatus` is a new, separate enum — not a reuse of `TripStudentStatus`

`TripStudent` already had a Phase-0-scaffolded `currentStatus` field typed
`TripStudentStatus` (`EXPECTED`/`BOARDING_PENDING`/`BOARDED`/`ABSENT`/
`DROPPED_OFF`/`ARRIVED_AT_SCHOOL`) — that is Step 6 Attendance's concept
("what happened to this student during the trip") and this phase must not
implement it. Step 5 adds a distinct field, `membershipStatus`, typed by a
new `MembershipStatus` enum (`PLANNED`/`ACTIVE`/`REMOVED`), answering a
different question: "is this student even supposed to be on this trip."
`PLANNED` is the state on creation; `POST /trips/:id/start` bulk-promotes
every `PLANNED` entry on that trip to `ACTIVE` (the confirmed roster for
the run actually happening); `REMOVED` is a soft-removal, set by
`DELETE /trips/:id/students/:tripStudentId`, never a hard delete, so a
trip's historical manifest stays auditable. `currentStatus` is left
completely untouched by every Step 5 code path, reserved for Step 6.

### 4. Trip lifecycle

```
SCHEDULED --ready()--> READY --start()--> IN_PROGRESS --complete()--> COMPLETED
SCHEDULED --cancel()-------------------------------------------------> CANCELLED
SCHEDULED --noShow()--------------------------------------------------> NO_SHOW
READY     --cancel()-------------------------------------------------> CANCELLED
READY     --noShow()-------------------------------------------------> NO_SHOW
IN_PROGRESS --cancel()------------------------------------------------> CANCELLED
```

- **SCHEDULED**: created with a full bus/driver/attendant assignment
  (there is no lesser "draft" trip state without one — `busId`/`driverId`
  are `NOT NULL` at the database level, matching Phase 0's original
  constraint; `attendantId` stays optional). Assignments and the route are
  validated once, at creation.
- **READY**: a mandatory manual checkpoint — `POST /trips/:id/ready`
  re-validates the route/bus/driver/attendant against their **current**
  state (not the state at creation time), because days can pass between
  scheduling and execution during which a bus could go to maintenance or a
  driver could be deactivated. `IN_PROGRESS` is only reachable from
  `READY`, never directly from `SCHEDULED`.
- **IN_PROGRESS**: `startedAt` set; every `PLANNED` manifest entry becomes
  `ACTIVE`.
- **COMPLETED**: `endedAt` set. Terminal.
- **CANCELLED**: reachable from `SCHEDULED`, `READY`, or `IN_PROGRESS` (a
  trip can be aborted mid-run, e.g. a breakdown) — always requires a
  `cancellationReason`. Terminal.
- **NO_SHOW**: reachable only from `SCHEDULED`/`READY` — once a trip has
  actually started, "no show" no longer describes what happened. Reuses the
  same `cancellationReason` column (the same underlying fact: "why didn't
  this run as planned"). Terminal.

No trip is ever physically deleted, in any state — the same
soft-state-only convention as every other domain in this codebase.

**Authorization**: `trips.manage` (staff-only management) gates
create/edit/ready/cancel/no-show and every manifest write.
`trips.read`-only holders (`DRIVER`, `BUS_ATTENDANT`) can list/view trips —
scoped to only trips where they are the assigned driver/attendant, resolved
by looking up their own `Driver`/`Attendant` profile — and `POST
/trips/:id/start` / `/complete` specifically also accept the trip's own
assigned driver even without `trips.manage`, checked inside
`TripsService`, not the route guard (the same pattern already used for
"you cannot suspend your own account" in `UsersService`). Phase 0's seed
had granted `DRIVER` a blanket `trips.manage`, which would have let any
driver manage or reassign every trip in the school — removed while
reviewing existing grants for this phase, the same kind of gap fixed for
`TRANSPORT_MANAGER`'s fleet visibility in Phase 1 Step 3. See
docs/security.md's trips authorization note.

## Consequences

- A Route can be edited or have stops reordered/removed at any time without
  ever affecting an existing Trip's plan.
- Displaying a scheduled time correctly requires combining
  `scheduledStartTime`/`scheduledEndTime` with `serviceDate` and
  `School.timezone` at read time — there is no shortcut DateTime field to
  reach for instead, by design.
- A future Attendance module (Step 6) can start recording real events
  against `TripStudent.currentStatus` without touching `membershipStatus`
  or anything built in this phase.
- The accepted concurrency limitation on conflict detection should be
  revisited if trip creation volume ever makes the race practically likely
  (e.g., a `SERIALIZABLE` transaction or a Postgres exclusion constraint on
  `(bus_id, service_date)`/`(driver_id, service_date)`/
  `(attendant_id, service_date)` time ranges) — not addressed now because
  nothing in this phase's scale makes it a real risk yet.
