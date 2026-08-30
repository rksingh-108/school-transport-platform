# ADR 0020: Geofencing and Operational Safety Rules

Status: Accepted
Date: 2026-08-30

## Context

Phase 2 Step 13 connects the GPS telemetry pipeline (Phase 1 Step 8) to
deterministic, configurable operational safety rules — geofence entry/exit,
route-deviation, excessive speed, and unexpected-stop detection — surfaced
through the existing SafetyEvent/Notification/realtime infrastructure built
in Step 12. Explicitly out of scope: PostGIS, a second GPS ingestion
pipeline, a general-purpose rules engine, automatic Emergency creation, any
AI/computer-vision detection (Steps 14-15), and legally-defined speed
limits — any speed threshold configured here is an operational policy, not
a legal one.

## Decision 1: Pure-JS Haversine + local-projection distance math, no PostGIS

`geo.util.ts` implements `haversineDistanceMeters` (great-circle distance
between two points) and `distanceToSegmentMeters`/`distanceToPolylineMeters`
(minimum distance from a point to a line segment/polyline, via a local
equirectangular projection around the segment's midpoint). This is a
deliberate approximation, not true geodesic segment distance — at
bus-route scale (segments of a few hundred meters to a few kilometers) the
error is on the order of 0.1-0.5%, well within the tolerance of a
100-5000m threshold. PostGIS was considered and rejected: it would add a
new database extension dependency for a problem pure arithmetic already
solves at the precision this feature needs.

## Decision 2: `RouteStop` already models "stop geofence" — no `STOP` geofence type

`RouteStop.latitude`/`longitude`/`radiusMeters` (Phase 1 Step 4) already
fully represents a stop's zone. Adding a `STOP` value to the new
`GeofenceType` enum (`SCHOOL`/`DEPOT`/`CUSTOM`) would duplicate those
coordinates in a second table and create a synchronization problem the
first time a stop moved. `Geofence` is therefore reserved for
*standalone* zones not already modeled elsewhere (a school's premises, a
depot, or any ad-hoc custom zone); route-deviation and unexpected-stop
rules read `TripStop` coordinates directly instead of requiring a
`Geofence` row per stop.

## Decision 3: One generic debounce/cooldown state machine, not four bespoke ones

`OperationalSafetyService.debounceAndMaybeFire()` is the single mechanism
behind all four rule types, parameterized by `suppressFirstObservation`:

- **GEOFENCE** (`true`) is bidirectional — `INSIDE`/`OUTSIDE` — and a
  freshly-enabled rule must not immediately fire based on wherever the bus
  already happens to be. The first *confirmed* state (reached only after
  `minConsecutivePoints` consecutive agreeing observations) is treated as
  a baseline, not a transition; only a later confirmed change from that
  baseline fires.
- **ROUTE_DEVIATION / SPEED / STOP** (`false`) are unidirectional —
  `OK`/`VIOLATING` — with an implicit `OK` baseline, so the first confirmed
  `VIOLATING` state is itself a genuine, reportable event.

Cooldown (`lastAlertAt`) is **one shared clock per (rule, bus)**,
regardless of direction. A `GEOFENCE_EXIT` immediately following a
`GEOFENCE_ENTRY` within the same cooldown window is deliberately
suppressed — this prevents a bus oscillating at a zone boundary from
producing an alert storm, at the cost of a rare missed exit notification
during that window, which is an accepted, documented trade-off.

State is a small JSON blob in Redis keyed
`school:{id}:bus:{id}:rule:{id}:state`
(`confirmedState`, `candidateState`, `candidateCount`, `lastAlertAt`),
TTL'd at 24 hours purely for hygiene. **Redis is transient working state
only, never the record of truth.** If a key disappears (restart, eviction,
manual flush), evaluation simply restarts from a clean baseline on the
next GPS point — a brief detection gap, never a false event, and never a
permanently broken rule. The persisted `SafetyEvent` row remains the sole
authoritative operational record; this was verified directly in the e2e
suite by deleting a rule's Redis key mid-test and confirming the system
recovers cleanly from the next telemetry point rather than replaying or
losing history.

## Decision 4: Rule evaluation lives inside `GpsService.ingest()` — no second pipeline

`OperationalSafetyService.evaluate()` is called from the existing GPS
ingestion path, only when a fix genuinely **advances** the bus's current-
location snapshot (never for an out-of-order, duplicate, or buffered
point — `GpsPoint`'s existing `@@unique([deviceId, deviceTime])` dedup
means a retried/duplicate point never even reaches evaluation). The call
is `await`ed, but wrapped in its own `try`/`catch`: a malformed rule
configuration, a Redis outage, or a downstream notification failure can
never fail the GPS ingestion request itself, per the step's explicit
requirement that GPS must remain operational regardless of safety-rule
health. It was initially implemented as fire-and-forget
(`.catch()` without `await`), which caused non-deterministic e2e failures
because the HTTP response could return before the resulting SafetyEvent
was actually written — awaiting it (still isolated by `try`/`catch`)
fixed this and is also the more correct behavior for callers/tests that
expect the ingestion response to reflect a fully-processed point.

## Decision 5: `SafetyRule` is a typed table, not a generic JSON rules engine

`SafetyRule` has explicit typed columns
(`thresholdMeters`, `thresholdSpeedKmh`, `minConsecutivePoints`,
`cooldownSeconds`, `geofenceId`/`routeId`/`busId`) rather than an
arbitrary `config: Json` blob interpreted by a generic evaluator. This
keeps validation in Zod (`packages/shared-schemas/src/safety-rules.ts`,
with `.refine()` chains enforcing which fields each `SafetyRuleType`
requires) and keeps `OperationalSafetyService`'s per-type branches simple
and auditable, at the cost of a schema migration if a genuinely new rule
shape is ever needed — an accepted trade-off given the step's explicit
instruction to avoid "a giant generic rules engine."

A rule's scope is exactly one of: unset (school-wide, watches every bus),
a specific `routeId`, or a specific `busId` — never more than one, enforced
by the create schema. `SafetyRulesService.assertOwnership()` re-verifies
any supplied `geofenceId`/`routeId`/`busId` against the caller's own
tenant server-side; none of `schoolId`/`createdBy`/`updatedBy` is ever
accepted from the client on any endpoint.

## Decision 6: Lifecycle endpoints, not a generic PATCH, for `enabled`

`SafetyRule.enabled` is toggled only through dedicated
`POST /safety-rules/:id/enable` and `.../disable` endpoints — `PATCH
/safety-rules/:id` structurally excludes both `type` and `enabled` from
its schema. This mirrors `Geofence.status`'s lifecycle discipline
(`ACTIVE → INACTIVE/ARCHIVED`, `archive()` is the only exit from
`ACTIVE`/`INACTIVE`, never a hard delete) and makes every enable/disable a
distinctly audited action (`SAFETY_RULE_ENABLED`/`SAFETY_RULE_DISABLED`)
rather than an incidental field change buried in a generic update.
Archiving a `Geofence` cascades to disable (not delete) any `SafetyRule`
still watching it, in the same transaction, so a rule is never left
silently referencing a zone that no longer exists.

## Decision 7: Only four rule types implemented — no `MISSED_STOP`/`UNAUTHORIZED_ZONE`

The step's own spec listed `MISSED_STOP` and `UNAUTHORIZED_ZONE` as
*possible* categories, conditioned on "only implement rules that can be
reliably determined from current GPS/route/stop data." Both were
deliberately not implemented:

- **MISSED_STOP** would require comparing an actual stop event against a
  schedule/attendance expectation — that comparison belongs to the
  attendance domain (Phase 1 Step 6), not raw GPS, and conflating them
  here would either duplicate attendance logic or produce false positives
  whenever a stop is legitimately skipped (no students boarding that day).
- **UNAUTHORIZED_ZONE** would require a notion of "authorized" areas
  beyond simple geofence membership (e.g., an allow-list of routes/zones
  per bus with real business rules around exceptions) that doesn't exist
  yet and would be invented, not derived.

What GPS *can* reliably determine today — zone membership, distance from
a planned route, reported speed, and "stationary away from any known
stop" — is exactly the four implemented types
(`GEOFENCE_ENTRY`/`GEOFENCE_EXIT` via `GEOFENCE`, `ROUTE_DEVIATION`,
`EXCESSIVE_SPEED` via `SPEED`, `UNEXPECTED_STOP` via `STOP`).

## Decision 8: Reuses Step 12's SafetyEvent/Notification/realtime — no new alert channel

Every rule firing calls the same `SafetyEventsService.createSystemEvent()`
(new in this step: a `SafetyEvent` with `source: 'SYSTEM'` and
`createdBy: null`, using the already-reserved `ActorType.SYSTEM` audit
value rather than inventing a synthetic system user — `SafetyEvent.
createdBy` was relaxed from `NOT NULL` to nullable for exactly this case).
This flows through the *existing* CRITICAL-severity notification trigger
and the *existing* `/realtime/safety` staff gateway from Step 12
unchanged — there is no second alert system, and a rule firing never
automatically creates an `Emergency`; escalation from a system-generated
SafetyEvent follows the identical explicit, human-triggered
`POST /safety-events/:id/escalate` path as any operator-created one.

## Decision 9: Debounce parameters exist specifically to prevent alert storms

`minConsecutivePoints` (default 3) and `cooldownSeconds` (default 300) are
per-rule, bounded (1-20 and 30-86400 respectively) configuration, not
hardcoded constants — different rule types and physical contexts (a tight
school-gate geofence vs. a loose depot zone) warrant different noise
tolerance. Combined with the accuracy filter
(`SAFETY_RULES_MAX_ACCURACY_M`, default 100m — a point less precise than
this is skipped entirely, still stored normally, just not trusted for
rule math) and the shared per-(rule,bus) cooldown clock (Decision 3), this
directly satisfies the step's explicit anti-storm requirement: a single
noisy point, a momentarily-imprecise fix, or a bus oscillating at a
boundary cannot each independently produce a notification.

## Decision 10: Same singular-permission convention as prior steps

`geofences.read`/`geofences.manage` and `safety_rules.read`/
`safety_rules.manage` follow Steps 11-12's established
singular-permission-per-domain naming, not the spec's suggested plural
scheme. Full read+manage is granted to `SCHOOL_ADMIN`/`TRANSPORT_ADMIN`;
read-only to `TRANSPORT_MANAGER`/`PRINCIPAL`/`SECURITY`. `DRIVER`/
`BUS_ATTENDANT`/`PARENT` receive neither permission — geofence and
safety-rule *configuration* is staff-only in both directions (no
driver/attendant creation capability, exactly as for cameras); a
driver/attendant still sees any resulting `SafetyEvent` through the
existing Step 12 own-trip scoping, unchanged.

## Decision 11: No parent-facing surface at all

There is no parent-audience route on `GeofencesController` or
`SafetyRulesController` (both `@RequireAudience('STAFF')` only), no
geofence/rule field on any parent DTO, and no geofence/rule event on the
parent realtime channel. A system-generated `SafetyEvent` (e.g.
`GEOFENCE_EXIT`) is subject to the exact same zero-parent-visibility rule
already established for every other `SafetyEvent` in Step 12 — parent
transport tracking continues to show only the pre-existing safe location
summary, unchanged by this step. See [privacy.md](../privacy.md).

## Consequences

- One migration (`20260830181836_phase2_step13_geofencing_safety_rules`)
  creates `geofences`/`safety_rules`, their RLS policies, and the five new
  `SafetyEventType` enum values in the same file — unlike Step 12's
  notification-enum change, nothing in this migration uses the new enum
  values in a DML statement within the same transaction, so a second
  migration file was not required.
- `GpsModule` now imports `GeofencingModule`, and `GeofencingModule`
  imports `SafetyModule` (which now exports `SafetyEventsService`) — a
  clean one-way dependency chain (`Gps → Geofencing → Safety`), no import
  cycle.
- No existing rule-free behavior changed: a school with zero enabled
  `SafetyRule` rows pays only the cost of one extra (empty-result) query
  per GPS point.
- Explicitly out of scope and not attempted: PostGIS/true geodesic corridor
  math, `MISSED_STOP`/`UNAUTHORIZED_ZONE` rule types, automatic Emergency
  creation from a fired rule, a map-based configuration UI (plain
  coordinate/radius number inputs only, matching existing route/stop/
  camera UI conventions), and any AI/computer-vision detection (Phase 3 /
  Steps 14-15).
