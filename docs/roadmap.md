# Implementation Roadmap

Status: Draft v1

Phase boundaries match [product-requirements.md](product-requirements.md#6-out-of-scope-for-mvp).
Within Phase 1 (MVP), the sequence below is the order of implementation — each step
ends with tests, lint, typecheck, and a docs update before moving to the next, per
the project's Definition of Done.

## Phase 0 — Foundations (no product features yet)
1. Monorepo scaffold: pnpm workspaces, Turborepo, TypeScript strict config, ESLint/
   Prettier presets, `packages/config`.
2. `docker-compose.yml`: Postgres, Redis, MinIO.
3. NestJS app skeleton: health endpoints, structured logging (pino), global
   exception filter, request-id middleware, config module (env validation via Zod).
4. Next.js app skeleton: base layout, design tokens, auth-aware shell, empty/loading/
   error state components.
5. Prisma schema for MVP tables (§3 of [database.md](database.md)) + initial
   migration + seed script (roles/permissions + demo school).
6. CI pipeline: install, lint, typecheck, unit tests, build (see
   [adr](adr/) for tooling choices already made so this isn't re-litigated per PR).

## Phase 1 — MVP
Order chosen so every step is independently testable and each builds on a working
predecessor (auth → tenancy → static data → operational flow → realtime → parent
surface):

1. **Auth module**: login (staff + parent), JWT/refresh, MFA scaffolding, password
   reset. Tests: login success/failure, token refresh, rate limiting.
2. **RBAC module**: roles/permissions seed, `PermissionsGuard`, policy layer
   scaffold. Tests: permission matrix from [security.md](security.md).
3. **Schools module** (+ tenant context middleware + RLS policies wired for every
   table added from here on). Tests: cross-tenant 404 pattern established here and
   reused by every subsequent module's tests.
4. **Users module** (staff accounts, role assignment).
5. **Students, Parents, Parent-Students** (incl. verification workflow). Tests:
   parent cannot see unverified/other students. **Done** — see
   [ADR 0011](adr/0011-school-status-platform-managed.md) and the
   `feat(core)` commit.
6. **Buses, Drivers, Attendants**. **Done** — `BusesModule`/`DriversModule`/
   `AttendantsModule`/`BusDevicesModule`. Driver/attendant are profiles
   layered onto the existing `User` (never a duplicate identity/credential —
   see [database.md](database.md#8-data-model-principle-fleet-domain)).
   No separate bus/driver/attendant assignment entity was built: the
   already-scaffolded `Trip` model (Phase 0's schema, not yet exposed via
   API) is the time-bound assignment record trips/routes/attendance will use
   — building a second assignment concept now would duplicate it before
   anything uses either. Device credentials are deliberately unmodeled (no
   secret/credential field exists) since no real provisioning flow exists
   yet — see [security.md](security.md#device-security).
7. **Routes, Stops**. **Done** — `RoutesModule`/`RouteStopsModule`. A Route
   is a reusable planned path with no `busId`/`driverId`/`attendantId`
   column, same separation principle as Step 6 — the future Trip model
   (already scaffolded) is the one place a route gets bound to an actual
   bus/driver/attendant on a given day. Stops are route-owned (no separate
   reusable "physical stop" entity — see
   [database.md §3](database.md#3-core-tables-mvp)'s routes/route_stops
   entry for why). Reordering stops is atomic (two-phase sequence-number
   shift inside one transaction) to respect the DB-enforced
   `unique(routeId, sequenceNo)` constraint without ever colliding
   mid-write.
8. **Trips, Trip-Students**. **Done** — `TripsModule` (trip lifecycle +
   read-only `trip_stops`) and `TripStudentsController` (manifest). See
   [ADR 0012](adr/0012-trip-stop-snapshot-and-lifecycle.md) for the
   lifecycle graph, the `trip_stops` immutable-snapshot design, wall-clock
   scheduled times, and the driver-own-trip authorization mechanism.
   Backend conflict detection prevents double-booking a bus/driver/attendant
   into overlapping trips on the same service date. Tests: driver/attendant
   scoped to own trip only — confirmed both in e2e tests and live against
   the running server.
9. **Attendance**. **Done** — `AttendanceService`/`AttendanceController`
   (housed in the existing `trips/` module). Immutable `AttendanceEvent` log
   (`BOARDING_CONFIRMED`/`DROPPED_OFF`/`MARKED_ABSENT`) with
   `TripStudent.currentStatus`/`boardedAt`/`droppedOffAt` as a derived
   projection; corrections are new events (`correctsEventId`), never edits.
   See [ADR 0013](adr/0013-attendance-event-model.md) for the event model,
   the correction-as-new-row design, and the profile-based own-trip
   scoping mechanism reused for `BUS_ATTENDANT`. Tests: full boarding/
   drop-off/absence/correction transition matrix, correction events
   preserve history, cross-tenant IDOR, RLS enforcement — confirmed both
   in e2e tests and live against the running server.
10. **GPS ingestion (HTTP, MVP) + live tracking module** + `/realtime/fleet`.
    **Done (staff-side)** — `GpsModule` (`apps/api/src/gps/`): device-credential
    ingestion (`POST /telemetry/gps`), Redis-backed current location with a
    Postgres cold-start fallback, bounded history reads, and a Socket.IO
    fleet-tracking gateway. See
    [ADR 0014](adr/0014-gps-telemetry-and-realtime-tracking.md) for the
    device-authentication mechanism, own-bus scoping for `DRIVER`/
    `BUS_ATTENDANT`, and the deliberate deviations from ADR 0005 (no
    separate `apps/ingestion` process yet, no Redis Socket.IO adapter yet —
    both tracked here as follow-ups once real device/scale requirements
    justify them). Tests: coordinate/timestamp validation, monotonic
    current-location rule, retry dedup, device tenant security, cross-tenant
    IDOR, RLS enforcement, and WebSocket tenant/role isolation with a real
    socket.io-client — confirmed both in e2e tests and live against the
    running server. Parent-facing location access shipped in Phase 1
    Step 8 (item 13 below), reusing this module's `GpsService`/`GpsGateway`
    rather than duplicating them. **Not done**: MQTT ingestion,
    camera/edge-AI telemetry, geofencing, speed monitoring, GPS data
    retention/purge job (config placeholder only — see
    [privacy.md](privacy.md)).
11. **Notifications** (in-app + one real channel, e.g. push via a provider adapter;
    SMS/email adapters stubbed with a local dev implementation per the "never fake
    an integration silently" rule — the adapter clearly logs "not configured"
    rather than pretending to send).
12. **Reports (attendance, punctuality) + Audit logs** (audit logging is actually
    wired into every module above retroactively verified here, not bolted on last).
13. **Parent web/mobile UI** (`(parent)` route group). **Done (transport
    tracking slice)** — `/parent` (My Children, with a per-child transport
    summary) and `/parent/children/:studentId` (trip status, simplified
    attendance, live location while `IN_PROGRESS`), realtime via
    `/realtime/parent`. See
    [ADR 0015](adr/0015-parent-transport-tracking.md) for the parent-safe
    DTO design, active-trip resolution, and realtime isolation. Reuses
    `GpsService`/`GpsGateway` (Step 7), `ParentChildAccessGuard`/
    `ParentAccessService` (Step 2), and `TripStudent.currentStatus` (Step 6)
    — no new domain model, no new migration. Tests: active-trip-resolution
    priority (in-progress/scheduled/completed/cancelled/none), parent-safe
    DTO field exclusion, multi-child parent, cross-parent and cross-tenant
    IDOR, RLS enforcement, and WebSocket child-isolation with a real
    socket.io-client — confirmed both in e2e tests and live against the
    running server. **Not done**: a real map provider (no vendor
    configured — see [ADR 0007](adr/0007-map-and-storage-provider-abstraction.md)),
    a historical/past-trips view (only the current/active trip is
    resolved), and timeline/notifications-preferences UI (notifications
    themselves are Step 9, not started).
14. **School control center UI** (`(school)` route group): live map, trip board,
    exceptions, device health placeholder.
15. **Driver/Attendant UI**: assigned trips, start/end, manifest, boarding
    confirmation, basic emergency stub button (records an `emergency_events`-shaped
    row even though the full emergency module is Phase 2, since the UI affordance
    and audit trail are cheap to build correctly now — confirm scope with product
    before building; default is to defer the button too if it implies unbuilt
    escalation logic).
16. **End-to-end test pass** across the full MVP user journeys in
    [product-requirements.md](product-requirements.md#7-success-criteria-for-mvp).
17. **Docs pass**: [development.md](development.md), [deployment.md](deployment.md),
    [authentication.md](authentication.md), [authorization.md](authorization.md),
    [gps.md](gps.md), [notifications.md](notifications.md) written against the
    as-built system (not speculative).

## Phase 2 — Operational Safety
1. Bus hardware integration hardening (real device protocol, MQTT ingestion
   adapter replacing/augmenting HTTP).
2. Camera management module (inventory, health, heartbeat) — no AI yet.
3. Emergency system (real escalation: staff notification fanout, status tracking).
4. Geofencing (school zone, route corridor) + violation events.
5. Speed monitoring + violation events.
6. Incident management module (manual incidents first, independent of AI — a
   security/staff-reported incident doesn't require Phase 3 to exist).

## Phase 3 — Edge AI
1. `apps/ai-service` implementation against the `AIInferenceProvider` /
   `SafetyEventDetector` interfaces defined in [ai-safety.md](ai-safety.md).
2. `ai_events` module + human review workflow + linkage into `incidents`.
3. Model registry + per-school severity mapping configuration.
4. Edge deployment path (on-bus inference box) as an alternative to centralized
   inference, validated against real hardware partners.

## Phase 4 — Enterprise/Scale
1. Advanced analytics/reporting.
2. Fleet management enhancements (maintenance scheduling, fuel, etc. — scope TBD
   with product).
3. Billing/subscription management for the SaaS commercial model.
4. Public/partner APIs (versioned, rate-limited, API-key based, separate from the
   internal `/api/v1` used by our own clients).
5. Extraction of any module into a standalone service, **only** if a measured
   scaling or team-ownership need justifies it — not speculatively.

## Immediate Next Step

Phase 0, step 1: scaffold the monorepo. This is the first step that produces code,
and it directly implements the repository structure proposed in
[architecture.md](architecture.md#2-repository-structure-proposed).
