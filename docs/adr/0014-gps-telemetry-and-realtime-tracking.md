# ADR 0014: GPS Telemetry Ingestion, Current-Location State, and Realtime Bus Tracking

Status: Accepted
Date: 2026-08-30

## Context

Phase 1 Step 7 takes a GPS fix from a bus device and makes the bus's current
position available to authorized school staff in real time. Several
Phase 0 scaffolds already existed for this (`GpsPoint` model, `gps.read`
permission already seeded to most roles, ADR 0005's ingestion/realtime
architecture) but nothing was wired up yet. Six decisions needed making.

## Decisions

### 1. Reuse the existing `GpsPoint` model — no new `GpsTelemetry` table

Phase 0 already scaffolded `GpsPoint` (`schoolId`, `busId`, `deviceId`,
`tripId`, `latitude`, `longitude`, `speedKmh`, `heading`, `deviceTime`,
`receivedAt`) with RLS already enabled via the generic tenant-isolation loop
in the initial migration. Creating a second, parallel `GpsTelemetry` model
would duplicate this for no reason. This phase only *adds* what was
genuinely missing:

- `accuracyM` — useful operational GPS data, matching the spec's "may be
  included" guidance for speed/heading/accuracy.
- `@@unique([deviceId, deviceTime])` — the retry-safe dedup key (see
  decision 3).
- `@@index([schoolId, deviceTime(sort: Desc)])` — the school-wide fleet
  query's access pattern.

`ignitionOn`/`networkState` (also Phase 0 scaffold fields) remain unused by
any ingestion path this phase — the same "don't wire a field just because a
column already exists" discipline as `AttendanceEventType`'s
`ARRIVED_AT_SCHOOL` value staying unused since Phase 1 Step 6.

### 2. Current location is Redis-backed, not a live query over history

`GpsPoint` is the durable historical log; "where is this bus right now" is
answered from Redis (`school:{schoolId}:bus:{busId}:location`, one JSON
snapshot per bus) so the live dashboard never does an `ORDER BY ... LIMIT 1`
scan per bus per poll. No separate `CurrentBusLocation` Postgres table was
introduced — after a cold start (Redis flushed/restarted), `GpsService`
falls back to the latest `GpsPoint` row for that bus and repopulates Redis,
so Postgres genuinely remains the durable source of truth without needing a
second table that could drift from it. The Redis key carries a long (30-day)
TTL purely as storage hygiene for decommissioned buses — freshness itself
(LIVE/STALE/UNKNOWN) is always computed dynamically from `deviceTime` vs.
now, never from whether the key still exists.

### 3. Dedup key is `(deviceId, deviceTime)`, not a client-supplied event ID

A GPS tracker resending the same fix (identical device clock reading) after
a network retry hits the same `@@unique([deviceId, deviceTime])` constraint
and is treated as a no-op (`{ deduplicated: true }`), not an error and not a
second row. This is the opposite choice from attendance's Step 6
"reject-not-idempotent" rule for boarding/drop-off — deliberately: a
double-tapped boarding button indicates a human mistake worth surfacing,
while a device retrying an unacknowledged HTTP POST is normal, expected
network behavior that should be absorbed silently. No client-supplied event
ID field was added: for a polling-interval GPS tracker, device+timestamp is
already a natural idempotency key, and inventing a synthetic ID nothing
currently needs would be exactly the kind of speculative field the project
avoids.

### 4. Monotonic-forward-only current location

A fix only becomes the new "current location" if its `deviceTime` is
strictly newer than whatever Redis already holds for that bus — an
out-of-order or duplicate-timestamp packet is still persisted to Postgres
history (nothing is dropped) but never regresses the live dashboard.
Timestamps are further bounded at ingestion: `recordedAt` more than
`GPS_MAX_FUTURE_SKEW_SECONDS` (default 120s) ahead of the server clock, or
more than `GPS_MAX_PAST_AGE_DAYS` (default 7 days) behind it, is rejected
outright as "obviously impossible" telemetry rather than stored — these are
config values (`apps/api/src/config/env.schema.ts`), not scattered magic
numbers.

### 5. Device authentication: a real, minimal bearer credential — not a fake one

`docs/security.md §5.1` (Phase 1 Step 3) deliberately left `BusDevice` with
no credential column, reasoning that a column nothing issues or reads would
be a fake security control. Step 7 changes that reasoning's premise: GPS
ingestion is a genuinely new, real capability that *needs* device identity
to enforce "Device A cannot submit telemetry for Bus B." So this phase adds
the minimum real mechanism, reusing infrastructure that already exists
rather than inventing new crypto: `BusDevice.credentialHash` stores the
SHA-256 hash of an opaque bearer token, generated via the exact same
`TokenService.generateOpaqueToken()`/`hashOpaqueToken()` already used for
refresh/reset/invitation tokens. `POST /devices/:id/credential`
(`buses.manage`) issues/rotates it and returns the raw token exactly once;
rotating overwrites the old hash outright (no overlap window). This is
deliberately *not* a claim that real hardware provisioning now exists — no
mTLS, no per-device certificate, no HSM, no field-deployment tooling. It is
the smallest mechanism that makes "a device's identity determines which bus
it can write to" actually true, sufficient for a pilot of HTTP-polling GPS
trackers; a hardware-integration phase can layer stronger provisioning on
top of the same `credentialHash` column later.

Resolving a device by credential hash is a pre-tenant lookup (the whole
point — the credential is what reveals the tenant), so it goes through
`PrismaService.runAsPlatformAdmin`, the same pattern ADR 0010 already
established for login/refresh/reset. `bus_devices`' RLS policy needed the
same `OR is_platform_admin` clause added to `users`/`parents`/
`refresh_tokens`/`password_reset_tokens` for exactly the same reason — see
ADR 0010's "Extension" section for the (again) e2e-caught fix.

### 6. Nothing identifying is ever accepted from the device payload

The ingestion payload (`gpsTelemetrySchema`) contains only
`latitude`/`longitude`/`speedKmh`/`heading`/`accuracyM`/`recordedAt` — no
`schoolId`/`busId`/`deviceId`/`tripId` field exists in the schema at all.
`schoolId`/`busId`/`deviceId` come from the authenticated device
(`DeviceAuthGuard` → `request.device`); `tripId` is server-derived from
"whichever trip is currently `IN_PROGRESS` for this device's bus" (at most
one, by `TripsService`'s existing conflict detection from Phase 1 Step 5).
This closes the "wrong trip"/device-impersonation IDOR classes by
construction, the same technique attendance used in Step 6 for
`tripStopId`: eliminate the input rather than validate it.

### 7. "Own bus only" scoping is resolved once, shared by REST and the gateway

`docs/security.md §2.3`'s `gps.read` row already documented `DRIVER`/
`BUS_ATTENDANT` as "own bus only" (unlike attendance/trips, no seed grant
was missing here — `gps.read` was already correctly assigned to every role
the matrix specifies). Neither role has a permanent bus assignment in the
schema (a `Driver`/`Attendant` reaches a bus only via a `Trip`), so
`GpsService.resolveGpsScope(principal)` resolves it the same profile-based
way `AttendanceService` resolves "own trip only": does the caller have a
`Driver`/`Attendant` profile, and if so, what bus is their own currently
`IN_PROGRESS` trip on. A profile-holder with no current trip is scoped to
*nothing* (not "every bus") — the safe default. Everyone else (SCHOOL_ADMIN,
TRANSPORT_ADMIN, TRANSPORT_MANAGER, PRINCIPAL, SECURITY) is unscoped. This
single method is called both by REST endpoints' authorization check and by
`GpsGateway`'s WebSocket connection handler, so the scoping rule exists in
exactly one place.

### 8. Realtime fan-out: a new Socket.IO gateway, STAFF-only, server-computed rooms

`@nestjs/websockets` + `@nestjs/platform-socket.io` (matching ADR 0005's
choice) power a `/realtime/fleet` namespace. The connection handshake
carries an access token (`auth.token`, the same in-memory token used for
REST calls); `GpsGateway.handleConnection` verifies it with the existing
`TokenService`/`AuthService`/`RbacService` (`gps.read`), rejects anything
that isn't a valid, permitted `STAFF` token (a parent token is rejected
identically to no token at all — parents get no live tracking in this
phase, full stop), then joins the socket into a room computed entirely
server-side from `resolveGpsScope`: `school:{id}:fleet` for unscoped staff,
`school:{id}:bus:{busId}` for a scoped driver/attendant. **The client never
supplies a room name** — there is no code path where one could, closing the
"arbitrary room" IDOR class by construction rather than by checking it.
`GpsService` calls `GpsGateway.emitLocationUpdate` after any ingest that
advances the current location (decision 4); the two classes have a
necessary circular reference (`forwardRef`), since the gateway needs the
service's scope resolution at connect time and the service needs the
gateway to emit.

**Deviation from ADR 0005**: no Redis Socket.IO adapter yet, despite that
ADR committing to one "from day one" for horizontal scaling. This MVP runs
a single API instance; adding `@socket.io/redis-adapter` now (a dedicated,
non-multiplexing Redis pub/sub connection pair, separate from
`RedisService`'s existing client) is real upfront complexity with nothing
to validate it against yet — exactly what this phase's instructions say to
avoid. The gateway's `emitLocationUpdate`/room-join methods are the only
places that would need to change to add it later; tracked in
[roadmap.md](../roadmap.md).

**Deviation from ADR 0005 (ingestion adapter)**: ADR 0005 also describes a
separate `apps/ingestion` process as the only thing that speaks the
device-facing protocol. This phase implements ingestion as a controller
inside the existing `apps/api` monolith (`GpsIngestionController`) instead —
the current phase's explicit instruction is "do not introduce microservices
yet," and a real process boundary would be exactly that. The `gps` module's
internal shape (a device-auth guard in front of a service with a stable
internal contract) is deliberately the same seam ADR 0005 anticipated, so
extracting a real `apps/ingestion` adapter later — once device protocol
diversity or volume actually justifies it — changes deployment topology,
not this module's design.

### 9. Retention is a documented placeholder, not an invented policy

`GPS_TELEMETRY_RETENTION_DAYS` (default 90) exists in config as the value a
future purge job would read; no purge job runs yet. Exact retention is
correctly an operational/legal decision (data volume, any regulatory
requirement, product's own policy), not something to invent here — see
[privacy.md](../privacy.md) and [roadmap.md](../roadmap.md).

### 10. Dev/test-only simulator, not a production feature

`POST /dev/gps-simulator/buses/:busId/tick` lets a staff member (already
authenticated, `buses.manage`) push one synthetic fix through the *real*
ingestion code path (`GpsService.ingest`), for manual verification and e2e
tests without real hardware. `GpsService.simulateIngest` refuses outright
when `NODE_ENV=production`, regardless of caller — the primary safeguard is
structural (the code path is inert in production), the permission gate is
defense in depth on top of it.

## Consequences

- Ingestion, current-location, and realtime paths are unit/e2e-tested
  against real PostgreSQL and Redis (`apps/api/test/gps.e2e-spec.ts`) —
  including RLS verified directly (bypassing the API), cross-tenant IDOR on
  every REST read, and WebSocket tenant/role isolation verified with a real
  `socket.io-client` connection, not mocked.
- A future real device-provisioning flow (mTLS, per-vendor onboarding
  tooling, credential expiry/rotation policy) only needs to populate the
  same `credentialHash` column through a different issuance path — the
  ingestion guard and RLS boundary do not need to change.
- Parent-facing location (Phase 1 Step 8) will need its own narrowly-scoped
  DTO/endpoint/room design — nothing here exposes device IDs, raw history,
  or internal telemetry to a parent-authenticated session, and no parent
  code path exists yet to accidentally do so.
