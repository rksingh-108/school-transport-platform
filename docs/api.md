# API Design

Status: Draft v1
Base path: `/api/v1`
Spec format: OpenAPI 3.1, generated from NestJS decorators (`@nestjs/swagger`) and
published at `/api/v1/docs` in non-production environments (disabled or auth-gated
in production).

## 1. Conventions

- **Auth**: `Authorization: Bearer <access_token>` for mobile/API clients, secure
  httpOnly session cookie for the web app. Both resolve to the same
  `AuthenticatedRequest` context. See [authentication.md](authentication.md)
  (to be written alongside auth module implementation).
- **Tenant scoping**: implicit from the authenticated principal — clients never pass
  a `schoolId` to scope a query. `SUPER_ADMIN` platform tools use an explicit
  `X-Target-School-Id` header, validated against a distinct, narrowly-granted
  permission (`platform.impersonate_school`), fully audit-logged.
- **Pagination**: cursor-based — `?limit=25&cursor=<opaque>` — response includes
  `nextCursor: string | null`. Offset pagination is not used (avoids skip/limit
  performance and consistency issues at scale).
- **Filtering/sorting**: flat query params per endpoint (e.g. `?status=ACTIVE&search=...`),
  not a generic `filter[x]`/`sort` envelope — see each endpoint's query schema in
  `packages/shared-schemas/src/`. Sorting is fixed per list endpoint (e.g. newest
  first) rather than client-specified, since none of the implemented list views
  need it yet.
- **Idempotency**: all unsafe `POST` endpoints that create a resource with real-world
  side effects (trip start, emergency raise, notification dispatch) accept an
  `Idempotency-Key` header; the server deduplicates within a 24h window.
- **Request ID**: server generates/propagates `X-Request-Id`; always present in
  error responses and logs.
- **Errors**: uniform shape —
  ```json
  { "error": { "code": "STUDENT_NOT_FOUND", "message": "Student not found.",
      "requestId": "...", "details": {} } }
  ```
  HTTP status is set conventionally (400/401/403/404/409/422/429/500); `code` is a
  stable machine-readable string clients can branch on, `message` is safe to display.

## 2. Endpoint Groups (MVP)

All routes below are prefixed `/api/v1` and require the listed permission unless
marked public. Full parameter/response schemas live in the generated OpenAPI doc —
this table is the contract summary for planning and review.

### Auth

Implemented in Phase 1 Step 1 — see [security.md](security.md#1-authentication),
[ADR 0004](adr/0004-auth-strategy.md), and
[ADR 0010](adr/0010-credential-resolution-rls-bypass.md). Endpoint paths below are
the actual implementation, not the earlier draft (`/auth/login` →
`/auth/staff/login`, `/auth/password/forgot` → `/auth/password-reset/request`,
etc., for symmetry with `/auth/parent/login` and clearer naming).

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/staff/login` | public | `{email, password}`. `200 {status:'OK', accessToken, accessTokenExpiresAt, principal}` + sets `staff_refresh_token` cookie. `200 {status:'MFA_REQUIRED'}` (no tokens issued) if `mfaEnabled` — see [ai-safety.md](ai-safety.md)-style note: no TOTP verify endpoint exists yet, this branch is unreachable by any current account. 401 generic on any failure (not found / wrong password / inactive) — identical body regardless of cause. Throttled 5/min/IP. |
| POST | `/auth/parent/login` | public | `{phone, password}`. Same response/failure shape as staff login; sets `parent_refresh_token` cookie instead. Throttled 5/min/IP. |
| POST | `/auth/refresh` | public* | Reads whichever refresh cookie is present. Rotates it (old token revoked, new one issued+cookied) and returns a new access token. Reused/revoked/expired token → `401`, and reuse additionally revokes the entire session family. Throttled 20/min/IP. *"Public" means no `Authorization` header is required — the refresh cookie itself is the credential. |
| POST | `/auth/logout` | public* | Revokes the session identified by whichever refresh cookie is present (idempotent — no error if absent/already revoked) and clears it. Same "public" caveat as refresh. |
| POST | `/auth/logout-all` | authenticated | Revokes every non-revoked session for the calling principal (all devices), clears the current cookie. |
| GET | `/auth/me` | authenticated | Returns a `StaffMeResponse` or `ParentMeResponse` (see `packages/shared-types/src/auth.ts`) depending on the token's audience. Parent shape includes `linkedChildrenCount` only — never child identities. |
| POST | `/auth/change-password` | authenticated | `{currentPassword, newPassword}`. Revokes **all** sessions (including the current one) on success — the client must re-login. Throttled 5/min/IP. |
| POST | `/auth/password-reset/request` | public | `{audience:'STAFF'\|'PARENT', identifier}`. Always `200 {message}` with an identical generic message regardless of whether a match was found — see [security.md](security.md#6-password-security). Throttled 5/min/IP. |
| POST | `/auth/password-reset/confirm` | public | `{token, newPassword}`. Single-use, time-limited token. `400` generic on invalid/used/expired — no distinction. Revokes all sessions on success. Throttled 5/min/IP. |

**Audiences.** Staff and parent access tokens are signed with different secrets and
carry different `aud` claims (`school-transport-staff` / `school-transport-parent`,
both configurable via env) — a token for one audience is structurally rejected on
routes gated to the other via `@RequireAudience(...)`, independent of any
permission check. **Cookies.** The refresh token is delivered exclusively via an
httpOnly, `SameSite=Lax` cookie scoped to `/api/v1/auth` — never in a JSON
response body, and never readable by client-side JS. **Errors** from this module
follow the standard shape (§1) with codes such as `UNAUTHORIZED`, `FORBIDDEN`,
`BAD_REQUEST`.

### Schools

Implemented in Phase 1 Step 2 — see [security.md](security.md#12-school-status-phase-1-step-2)
and [ADR 0011](adr/0011-school-status-platform-managed.md). There is no
school-creation or school-listing endpoint in this phase (schools are seeded;
platform-level provisioning is out of scope until it's actually needed).

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/schools/:id` | `schools.read` (own school) or `platform.schools.read` (any school, SUPER_ADMIN, audited as `PLATFORM_SCHOOL_ACCESSED`) | Cross-tenant access via the platform path is explicit and logged, never a silent bypass. |
| PATCH | `/schools/:id` | `schools.update` (own school only) | Routine profile fields (`name`, `contactEmail`, `contactPhone`, `timezone`, `address`) — the DTO has no `status` field, so it cannot change lifecycle state. |
| PATCH | `/schools/:id/status` | `platform.schools.manage` (SUPER_ADMIN only) | The *only* way to change `status` (`ACTIVE\|TRIAL\|SUSPENDED\|INACTIVE`); audited as `SCHOOL_STATUS_CHANGED`. |

### Staff / Users & RBAC

Implemented in Phase 1 Step 2 — `apps/api/src/users/`. `@RequireAudience('STAFF')`
on every route in this group.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/users` | `users.read` | Cursor-paginated; `?search`, `?status`. |
| GET | `/users/:id` | `users.read` | |
| POST | `/users/invite` | `users.create` | `{email, fullName, roleKeys}`. Creates the `User` row as `INVITED` (no password) and issues an invitation — see [Invitations](#invitations) below. `roleKeys` including `SUPER_ADMIN` requires the caller to already hold `SUPER_ADMIN`, regardless of their other permissions (hardcoded rule, not a permission grant — see [security.md §2.2](security.md#22-enforcement--centralized-not-scattered)). `PARENT` is rejected (`400`) — parents are never `User` rows. |
| POST | `/users/:id/resend-invitation` | `users.create` | Reissues the token (same row, fresh expiry) for a still-`INVITED` account. |
| PATCH | `/users/:id` | `users.update` | `fullName`/`email` only — no status or role changes here. |
| POST | `/users/:id/roles` | `users.manage_roles` | Replaces the full role set; same `SUPER_ADMIN`-escalation and `PARENT`-rejection rules as invite. |
| POST | `/users/:id/suspend` | `users.update` | Blocks login/refresh immediately (see [security.md §1.1](security.md#11-account-states)); rejected if the target is still `INVITED` or already `DISABLED`, or is the caller's own account. |
| POST | `/users/:id/activate` | `users.update` | Reverses `suspend`. |

### Students

Implemented in Phase 1 Step 2 — `apps/api/src/students/`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/students` | `students.read` | Cursor-paginated; `?search`, `?grade`, `?section`, `?status`. |
| GET | `/students/:id` | `students.read` | |
| POST | `/students` | `students.create` | `{admissionNumber, fullName, dateOfBirth?, grade?, section?}` — deliberately no `schoolId` field; the student's tenant is fixed from the caller's own context and can never be supplied or changed. |
| PATCH | `/students/:id` | `students.update` | Same field set as create, all optional; no `schoolId` field, so a tenant transfer is not just rejected but structurally impossible. |
| POST | `/students/:id/archive` | `students.delete` | Soft-archives (`status: 'INACTIVE'`) — never a hard delete. |

### Parents

Implemented in Phase 1 Step 2 — `apps/api/src/parents/`
(`ParentsController`/`ParentStudentLinksController`, staff-facing;
`ParentSelfController`, parent-facing — see below).

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/parents` | `parents.read` | Cursor-paginated; `?search`. |
| GET | `/parents/:id` | `parents.read` | |
| POST | `/parents` | `parents.create` | `{phone, fullName, email?}`. Creates the `Parent` row as `INVITED` and issues an invitation, same mechanism as staff invite. |
| PATCH | `/parents/:id` | `parents.update` | `fullName`/`email` only. |
| GET | `/parents/:id/children` | `parents.read` | Lists all `parent_students` links (verified and unverified) for staff review. |
| POST | `/parents/:id/children` | `parents.manage_relationships` | `{studentId, relationship?}`. Creates an **unverified** link — the parent gains no access until a separate verify call. Rejects if the link already exists. |
| POST | `/parent-students/:id/verify` | `parents.manage_relationships` | Staff confirms the relationship; only after this does the parent's own endpoints (below) expose the student. |
| DELETE | `/parent-students/:id` | `parents.manage_relationships` | Unlinks (hard-deletes the relationship row — the underlying `Parent`/`Student` records are untouched). |

None of the above ever accepts a *parent-supplied* `studentId` to self-link — see
[security.md §4](security.md#4-parent-data-access-boundary).

### Invitations

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/invitations/accept` | public | `{token, password}`. The one audience-agnostic invitation endpoint — accepting isn't a staff or parent action until *after* it succeeds. `400` generic on invalid/expired/already-accepted/revoked token (no distinction). Throttled 5/min/60s. Sets the target `User`/`Parent`'s password and status atomically; see [database.md](database.md#invitations). |

### Buses / Drivers / Attendants / Devices

Implemented in Phase 1 Step 3 — `apps/api/src/buses/`, `drivers/`,
`attendants/`, `bus-devices/`. Driver/attendant `POST` attaches a profile to
an already-existing staff user (`userId`); it never creates one — see
[database.md §8](database.md#8-data-model-principle-fleet-domain). No
`schoolId` field exists on any create/update DTO in this group — same
structural tenant lock as students/parents.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/buses` | `buses.read` | Cursor-paginated; `?search`, `?status`, `?minCapacity`. |
| GET | `/buses/:id` | `buses.read` | |
| POST | `/buses` | `buses.manage` | `{registrationNumber, capacity, fleetNumber?, make?, model?, manufactureYear?, permitExpiry?, insuranceExpiry?, fitnessExpiry?, notes?}`. |
| PATCH | `/buses/:id` | `buses.manage` | Same fields, all optional, plus `status` restricted to `ACTIVE`/`INACTIVE`/`MAINTENANCE` — `RETIRED` is rejected (400) with a pointer to the archive endpoint. |
| POST | `/buses/:id/archive` | `buses.manage` | Sets `status: 'RETIRED'` (terminal). 400 if already retired. |
| GET | `/drivers` | `drivers.read` | Cursor-paginated; `?search`, `?status`. |
| GET | `/drivers/:id` | `drivers.read` | |
| POST | `/drivers` | `drivers.manage` | `{userId, licenseNumber, licenseExpiry?}`. 404 if `userId` isn't an existing staff user in the caller's own school; 400 if that user already has a driver profile. |
| PATCH | `/drivers/:id` | `drivers.manage` | `{licenseNumber?, licenseExpiry?}` — transport-profile fields only; identity fields (name/email) go through `PATCH /users/:id`. |
| POST | `/drivers/:id/activate` \| `/deactivate` | `drivers.manage` | Transport-operational status only — never affects the underlying `User.status`/login. |
| GET | `/attendants` | `attendants.read` | Cursor-paginated; `?search`, `?status`. |
| GET | `/attendants/:id` | `attendants.read` | |
| POST | `/attendants` | `attendants.manage` | `{userId}`. Same existing-user/no-duplicate rules as drivers. |
| POST | `/attendants/:id/activate` \| `/deactivate` | `attendants.manage` | Same operational-only semantics as drivers. |
| GET | `/buses/:busId/devices` | `buses.read` | Not paginated — a bus has few devices. 404 if `busId` isn't the caller's own bus. |
| POST | `/buses/:busId/devices` | `buses.manage` | `{deviceType, externalDeviceId, firmwareVersion?, metadata?}`. `deviceType` is fixed at registration, never updatable. |
| GET | `/devices/:id` | `buses.read` | |
| PATCH | `/devices/:id` | `buses.manage` | `{externalDeviceId?, firmwareVersion?, metadata?, status?}` — `status` restricted to `ACTIVE`/`FAULTY`; `INACTIVE` is rejected (400), same archive-only-via-dedicated-endpoint pattern as buses. |
| POST | `/devices/:id/deactivate` | `buses.manage` | Sets `status: 'INACTIVE'`. |

Device endpoints are gated by `buses.read`/`buses.manage`, not a separate
`devices.*` permission — see
[security.md §5.2](security.md#52-device--fleet-authorization). No device
*read* response ever includes the credential (only `credentialSetAt`, a
timestamp) — the raw bearer token is returned exactly once, by
`POST /devices/:id/credential` (see the GPS / Tracking section below), never
by `GET`/`PATCH`.

### Routes / Stops

Implemented in Phase 1 Step 4 — `apps/api/src/routes/`, `route-stops/`. A
Route is a reusable planned path, never a specific day's execution (that's
the future Trip) — see [database.md §8](database.md#8-data-model-principle-fleet-domain).
No `schoolId`/`busId`/`driverId`/`attendantId` field exists on any
create/update DTO in this group.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/routes` | `routes.read` | Cursor-paginated; `?search`, `?status`, `?direction`. Each row includes `stopCount` (a single query via Prisma's `_count`, no N+1). |
| GET | `/routes/:id` | `routes.read` | |
| POST | `/routes` | `routes.manage` | `{code?, name, direction, shift, description?}`. `direction`: `HOME_TO_SCHOOL`/`SCHOOL_TO_HOME`. |
| PATCH | `/routes/:id` | `routes.manage` | Same fields, all optional, plus `status` restricted to `ACTIVE`/`INACTIVE` — `ARCHIVED` is rejected (400) with a pointer to the archive endpoint. |
| POST | `/routes/:id/archive` | `routes.manage` | Sets `status: 'ARCHIVED'` (terminal, never a physical delete). 400 if already archived. |
| GET | `/routes/:routeId/stops` | `routes.read` | Not paginated — ordered by `sequenceNo` ascending, always. 404 if `routeId` isn't the caller's own route. |
| POST | `/routes/:routeId/stops` | `routes.manage` | `{name, address?, latitude, longitude, sequenceNo, expectedOffsetMinutes, radiusMeters?, mode?}`. 400 on out-of-range coordinates or a `sequenceNo` already used on this route. |
| GET | `/stops/:id` | `routes.read` | |
| PATCH | `/stops/:id` | `routes.manage` | Same fields except `sequenceNo` — sequence is never edited here, only through the reorder endpoint below. |
| POST | `/routes/:routeId/stops/reorder` | `routes.manage` | `{stopIds: string[]}` — every stop id currently on the route, in its new order. Atomic: sequence numbers are shifted out of range and back inside one transaction so the write can never collide with the unique `(routeId, sequenceNo)` constraint. 400 if the set of ids doesn't exactly match the route's current stops. |
| DELETE | `/stops/:id` | `routes.manage` | Hard-deletes only if no `trip_students` row references it yet; otherwise 400 telling the caller to deactivate instead (`PATCH` with `status: 'INACTIVE'`). |

Stop endpoints are gated by `routes.read`/`routes.manage`, not a separate
`stops.*` permission — same reasoning as bus devices reusing
`buses.read`/`buses.manage` (§5.2 of security.md): a stop has no lifecycle
independent of its route.

### Trips

Implemented in Phase 1 Step 5 — `apps/api/src/trips/` (`TripsController`,
`TripStudentsController`). A Trip is one scheduled/actual execution of a
Route — see [database.md](database.md#trips-trip_stops-trip_students) and
[ADR 0012](adr/0012-trip-stop-snapshot-and-lifecycle.md) for the full
lifecycle, the `trip_stops` immutable-snapshot strategy, and why scheduled
times are `"HH:mm"` strings rather than `DateTime`. No `schoolId` field
exists on any create/update DTO. `routeId` is fixed at creation (a
different route is a different trip, not an edit of this one).

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/trips` | `trips.read` | Cursor-paginated; `?serviceDate`, `?routeId`, `?status`, `?busId`, `?driverId`. `DRIVER`/`BUS_ATTENDANT` (who hold `trips.read` but never `trips.manage`) see only trips where they are the assigned driver/attendant — resolved from their own `Driver`/`Attendant` profile, not a client-supplied filter. |
| GET | `/trips/:id` | `trips.read` | Same own-trip scoping as the list; 404 (not 403) if the trip exists but isn't theirs. |
| GET | `/trips/:id/stops` | `trips.read` | The immutable snapshot taken at creation — never the route's current stops. |
| POST | `/trips` | `trips.manage` | `{routeId, busId, driverId, attendantId?, serviceDate, scheduledStartTime, scheduledEndTime, notes?}`. Validates the route is `ACTIVE` with ≥1 active stop, the bus is `ACTIVE`, the driver/attendant are operationally active with an active underlying staff account, and that none of bus/driver/attendant already has an overlapping trip that service date (409 on conflict). Snapshots the route's active stops into `trip_stops` in the same transaction. |
| PATCH | `/trips/:id` | `trips.manage` | Same fields except `routeId`, all optional. Only while `SCHEDULED`/`READY` (400 otherwise). Re-validates and re-checks conflicts for whatever changed; reassigning anything while `READY` resets status to `SCHEDULED`. |
| POST | `/trips/:id/ready` | `trips.manage` | `SCHEDULED` → `READY` only. Re-validates route/bus/driver/attendant against their *current* state, not their state at creation. |
| POST | `/trips/:id/start` | `trips.read` (see note) | `READY` → `IN_PROGRESS` only. Sets `startedAt`; bulk-promotes every `PLANNED` manifest entry to `ACTIVE`. Gated by the weaker `trips.read` at the route level — the real check ("`trips.manage` OR the trip's own assigned driver") happens inside `TripsService`, the same pattern as `UsersService`'s "can't suspend your own account" check. |
| POST | `/trips/:id/complete` | `trips.read` (see note) | `IN_PROGRESS` → `COMPLETED` only. Sets `endedAt`. Same driver-or-manage authorization as `/start`. |
| POST | `/trips/:id/cancel` | `trips.manage` | `{reason}` (required). From `SCHEDULED`/`READY`/`IN_PROGRESS` only (400 if already terminal). |
| POST | `/trips/:id/no-show` | `trips.manage` | `{reason}` (required). From `SCHEDULED`/`READY` only — never `IN_PROGRESS` (once started, it's not a no-show). |
| GET | `/trips/:tripId/students` | `trips.read` | The manifest, excluding soft-removed entries. Since Phase 1 Step 6, each entry also carries `currentStatus`/`boardedAt`/`droppedOffAt` — the derived attendance projection, in the same query (no N+1) — see the Attendance section below. |
| POST | `/trips/:tripId/students` | `trips.manage` | `{studentId, pickupTripStopId?, dropoffTripStopId?, notes?}` — at least one of pickup/dropoff required; either may be omitted/null to mean "the school itself" (a route's implicit terminus, never modeled as a stop). Any non-null stop id must belong to *this* trip's own `trip_stops` (400 otherwise) — a stop from another trip or the live route is rejected. 400 on a duplicate (non-removed) student; re-adding a previously-removed student revives that same row instead of erroring. |
| PATCH | `/trips/:tripId/students/:tripStudentId` | `trips.manage` | `{pickupTripStopId?, dropoffTripStopId?, notes?}` — never `membershipStatus` directly (that only changes via add/remove/trip-start). |
| DELETE | `/trips/:tripId/students/:tripStudentId` | `trips.manage` | Soft-removal only (`membershipStatus: 'REMOVED'`) — never a hard delete, so a trip's historical manifest stays auditable. |

### Attendance

Implemented in Phase 1 Step 6 — `apps/api/src/trips/attendance.{controller,service}.ts`.
Boarding/drop-off/absence are real fact-log events (`AttendanceEvent`),
never confused with the Step 5 manifest membership concept — see
[ADR 0013](adr/0013-attendance-event-model.md). None of these endpoints
accept a stop id, an actor id, or (except `/correct`) a timestamp from the
client — the stop is always the student's own planned pickup/dropoff stop,
the actor is always the authenticated principal, and the time is always
"now" for normal events.

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/trips/:tripId/students/:tripStudentId/board` | `attendance.manage` | `{notes?}`. Only while the trip is `IN_PROGRESS`; 400 if already boarded or dropped off. |
| POST | `/trips/:tripId/students/:tripStudentId/dropoff` | `attendance.manage` | `{notes?}`. Only while `IN_PROGRESS` and currently `BOARDED` — 400 for "drop-off before boarding" or a duplicate. |
| POST | `/trips/:tripId/students/:tripStudentId/absent` | `attendance.manage` | `{notes?}`. Only from `EXPECTED` (never once boarded/dropped off — use a correction for that), and only while the trip is `SCHEDULED`/`READY`/`IN_PROGRESS`. |
| POST | `/trips/:tripId/students/:tripStudentId/attendance/:eventId/correct` | `attendance.manage` | `{eventType, occurredAt?, notes?}` — `eventType` is one of `BOARDING_CONFIRMED`/`DROPPED_OFF`/`MARKED_ABSENT`, i.e. the *actual* corrected fact. Creates a new event referencing the one it corrects; the original is never edited. Allowed regardless of trip status. |
| GET | `/trips/:tripId/students/:tripStudentId/attendance` | `attendance.read` | Full event history, oldest first, including corrections. |

`BUS_ATTENDANT` holds `attendance.manage`/`attendance.read` scoped to "own
trip only" (§2.3 of security.md) — resolved by the caller's own `Attendant`
profile against the trip's assigned attendant, not by the permission grant
alone; see [security.md §5.5](security.md). The enriched
`GET /trips/:tripId/students` response (Step 5's manifest endpoint) already
carries `currentStatus`/`boardedAt`/`droppedOffAt` for every entry in the
same query — no separate "attendance list" endpoint was added.

### GPS / Tracking

Implemented in Phase 1 Step 7 — `apps/api/src/gps/`. See
[ADR 0014](adr/0014-gps-telemetry-and-realtime-tracking.md) for the full
design (raw-vs-current-location split, device authentication, own-bus
scoping, realtime architecture). No parent-facing location endpoint exists
yet — that boundary is Phase 1 Step 8.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/telemetry/gps` | Device bearer credential (see below) — **not** a staff/parent session | `{latitude, longitude, speedKmh?, heading?, accuracyM?, recordedAt}`. No `schoolId`/`busId`/`deviceId`/`tripId` field exists in this schema — all four are always resolved server-side from the authenticated device and its bus's current `IN_PROGRESS` trip. Returns `{deduplicated: boolean}`; a resend of the exact same `(device, recordedAt)` is a safe no-op, not an error. |
| POST | `/devices/:id/credential` | `buses.manage` | Issues/rotates the device's bearer credential. Returns `{deviceId, token, issuedAt}` — `token` is shown exactly once and never retrievable again; rotating immediately invalidates the previous token. |
| GET | `/gps/fleet` | `gps.read` | Current location for every bus in the caller's scope (own bus only for `DRIVER`/`BUS_ATTENDANT`; every bus for other `gps.read` roles) — one call, no per-bus round trip. |
| GET | `/buses/:busId/location` | `gps.read` | Current location — Redis-backed, falls back to the latest history row after a cold start. `freshness: 'LIVE'\|'STALE'\|'UNKNOWN'`, computed from configurable thresholds (`GPS_LIVE_THRESHOLD_SECONDS`/`GPS_STALE_THRESHOLD_SECONDS`), never from a TTL. |
| GET | `/buses/:busId/telemetry` | `gps.read` | Bounded history; `?from`, `?to`, `?limit` (default 200, max 500) — never unbounded. |
| GET | `/trips/:tripId/telemetry` | `gps.read` | Same as above, scoped to one trip's bus. |
| POST | `/dev/gps-simulator/buses/:busId/tick` | `buses.manage`, **dev/test only** | Pushes one synthetic fix through the real ingestion path for manual verification without hardware. Refuses outright when `NODE_ENV=production`, regardless of caller. |

`DRIVER`/`BUS_ATTENDANT` are scoped to their own currently-`IN_PROGRESS`
trip's bus on every read above (§2.3 of security.md's "own bus only" row) —
a request for any other bus in the same school is `403`; a bus in another
school is `404`. Device credential authentication and its cross-tenant
guarantees are covered in [security.md §5.1](security.md).

### Cameras (Phase 2 Step 11)

Implemented — `apps/api/src/cameras/`. Camera inventory, bus association,
lifecycle, and device authentication only — no streaming, recording, AI, or
parent access. See
[ADR 0018](adr/0018-camera-device-management-foundation.md). Gated by
`camera.read`/`camera.manage`, never `buses.read`/`buses.manage` — a
deliberately narrower-access domain than generic fleet devices (`DRIVER`/
`BUS_ATTENDANT` have neither permission, unlike `buses.read`).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/buses/:busId/cameras` | `camera.read` | Not paginated — a bus has few cameras. 404 if `busId` isn't the caller's own bus. |
| POST | `/buses/:busId/cameras` | `camera.manage` | `{cameraCode, name, position, customPositionLabel?, manufacturer?, model?, serialNumber, firmwareVersion?, streamType?}`. `customPositionLabel` required only when `position: 'CUSTOM'`. Creates the camera's underlying `bus_devices` row (`CAMERA_CONTROLLER`) in the same transaction — no separate device-registration call needed. |
| GET | `/cameras` | `camera.read` | School-wide, cursor-paginated; `?busId`, `?status`, `?search`. |
| GET | `/cameras/:id` | `camera.read` | |
| PATCH | `/cameras/:id` | `camera.manage` | `{cameraCode?, name?, position?, customPositionLabel?, manufacturer?, model?, firmwareVersion?, streamType?, status?, busId?}` — `status` restricted to `ACTIVE`/`INACTIVE`/`FAULT`; `RETIRED` is rejected (400), same archive-only pattern as buses/devices. `busId` reassigns to a different bus in the same tenant (404 if not); audited separately as a reassignment. Rejected (400) once the camera is `RETIRED`. |
| POST | `/cameras/:id/archive` | `camera.manage` | Terminal — sets `status: 'RETIRED'` and deactivates the underlying device in the same transaction, so its credential stops authenticating immediately. 400 if already retired. |
| POST | `/cameras/:id/credential` | `camera.manage` | Issues/rotates the camera's device bearer credential — delegates to the same mechanism as `POST /devices/:id/credential`. Returns `{deviceId, token, issuedAt}`; `token` shown exactly once. 400 for a retired camera. |
| GET | `/cameras/:id/stream` | `camera.read` | Returns `{status: 'NOT_CONFIGURED'\|'SIMULATED', message}` — never a real playback URL, vendor token, or stream credential. `SIMULATED` only appears if `CAMERA_STREAM_PROVIDER=MOCK` is explicitly set (rejected in production — see security.md's configuration-hardening note). |
| POST | `/camera-devices/heartbeat` | Device bearer credential — **not** a staff/parent session | No `schoolId`/`busId`/`cameraId` field exists — identity resolved entirely from the credential, same IDOR-by-construction pattern as GPS ingestion. Optional `{firmwareVersion?, health?}`; carries no client-asserted "online" status — arrival of the authenticated request, recorded as `lastSeenAt`, is the only signal. Not rate-limited as tightly as GPS ingestion (`CAMERA_HEARTBEAT_RATE_LIMIT_PER_MINUTE`, default 20/min) — a realistic heartbeat cadence is far lower. |

There is no parent-facing camera endpoint anywhere in this codebase, and
none is planned for this phase — see
[security.md §4](security.md#4-parent-data-access-boundary) and
[privacy.md](privacy.md).

### Safety Events & Emergencies (Phase 2 Step 12)

Implemented — `apps/api/src/safety/`. Human/operator-generated safety
observations and a real emergency-response workflow; no AI, no camera
detection, no geofencing. See
[ADR 0019](adr/0019-safety-events-and-emergency-management.md) for the
SafetyEvent-vs-Emergency separation, the state machines, and the
DRIVER/BUS_ATTENDANT own-trip scoping.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/safety-events` | `safety_events.read` | Cursor-paginated; `?status`, `?severity`, `?type`, `?busId`, `?tripId`, `?from`, `?to`. |
| GET | `/safety-events/:id` | `safety_events.read` | |
| POST | `/safety-events` | `safety_events.create` | `{busId?, tripId?, cameraId?, type, severity, description?, occurredAt?, metadata?}`. Gated by the narrowest shared permission; DRIVER/BUS_ATTENDANT are scoped to their own current trip inside the service (400 with no active trip and nothing supplied; 403 if a supplied busId/tripId doesn't match it), staff may reference any bus/trip/camera in their own tenant or none at all. `createdBy`/`source`/`schoolId` are never accepted from the client. |
| POST | `/safety-events/:id/acknowledge` | `safety_events.manage` | `NEW → ACKNOWLEDGED` only. |
| POST | `/safety-events/:id/dismiss` | `safety_events.manage` | `NEW`/`ACKNOWLEDGED → DISMISSED` (terminal). `{resolutionNote?}`. |
| POST | `/safety-events/:id/escalate` | `safety_events.manage` | `NEW`/`ACKNOWLEDGED → ESCALATED` (terminal for this endpoint). Creates a linked, `ACTIVE` `Emergency` in the same transaction and returns the updated event with `emergencyId` set. |
| POST | `/safety-events/:id/resolve` | `safety_events.manage` | `NEW`/`ACKNOWLEDGED → RESOLVED` (terminal). `{resolutionNote?}`. Rejected once `ESCALATED` — see the emergency-resolution note below. |
| GET | `/emergencies` | `emergency.read` | Cursor-paginated; `?status`, `?busId`, `?tripId`. |
| GET | `/emergencies/:id` | `emergency.read` | Includes the full, append-only `actions` response history. |
| POST | `/emergencies` | `emergency.create` | The emergency-button path. `{busId?, tripId?, severity?, reason?}` — `severity` defaults `CRITICAL`. Same own-trip scoping as safety-event creation for DRIVER/BUS_ATTENDANT; staff may trigger with no bus/trip at all (an on-campus emergency). `initiatedBy`/`schoolId` are never accepted from the client. |
| POST | `/emergencies/:id/acknowledge` | `emergency.manage` | `ACTIVE → ACKNOWLEDGED` only. |
| POST | `/emergencies/:id/actions` | `emergency.manage` | `{actionType, note?}` — append-only; rejected (400) once `RESOLVED`/`CANCELLED`. `CONTACTED_EMERGENCY_SERVICE` records only that an operator logged the action themselves — never a real external call (ADR 0019). |
| POST | `/emergencies/:id/resolve` | `emergency.manage` | `ACTIVE`/`ACKNOWLEDGED → RESOLVED` (terminal). If this emergency has a `sourceSafetyEventId`, that event is also flipped `ESCALATED → RESOLVED` in the same transaction. |
| POST | `/emergencies/:id/cancel` | `emergency.manage` | `ACTIVE`/`ACKNOWLEDGED → CANCELLED` (terminal) — a false alarm, distinct from `RESOLVED`. |

There is no parent-facing safety-event or emergency endpoint anywhere in
this codebase — see [privacy.md](privacy.md). Realtime updates
(`safety.event.created`/`.updated`, `emergency.created`/`.updated`) are
pushed via a dedicated staff-only `/realtime/safety` Socket.IO namespace
(§4 below) — no polling is required for the dashboard to stay current.

### Parent Endpoints (dedicated namespace, minimal surface)

`ParentSelfController`/`ParentTransportController` (`@RequireAudience('PARENT')`,
no `@RequirePermission` at all by design — parent access is relationship-based,
not RBAC-based; see [security.md §4](security.md#4-parent-data-access-boundary)).
`@RequireVerifiedChild('studentId')` (`ParentChildAccessGuard`, global) gates
every route that takes a `studentId` — `404`, never `403`, for anything the
caller doesn't have a verified link to, so the response never confirms
whether the id even exists.

| Method | Path | Notes | Status |
|---|---|---|---|
| GET | `/parent/children` | List own linked+**verified** children (`ParentChildWithTransportDto`: id, fullName, grade, section, plus a `transport` summary — trip/attendance status text, bus display name, freshness, no coordinates). One call, no per-child follow-up request. | Implemented, Phase 1 Step 2 (identity fields); enriched with `transport` in Phase 1 Step 8 |
| GET | `/parent/children/:studentId` | Plain identity only (`ParentLinkedChildDto`) — unrelated to transport, unchanged since Step 2. | Implemented, Phase 1 Step 2 |
| GET | `/parent/children/:studentId/transport` | The full parent-safe transport view (`ParentTransportDto`) for one child — trip, simplified attendance, bus display name, and (only while the trip is `IN_PROGRESS`) live location + freshness. See [ADR 0015](adr/0015-parent-transport-tracking.md). | Implemented, Phase 1 Step 8 |
| GET | `/parent/notifications` | Own notifications, newest first (`NotificationDto`: eventType, title, body, payload, readAt, createdAt — never who recorded it, never a correction record, never an internal id). Cursor-paginated. | Implemented, Phase 1 Step 9 |
| GET | `/parent/notifications/unread-count` | `{count}` — one indexed COUNT query, never a full list scan. | Implemented, Phase 1 Step 9 |
| POST | `/parent/notifications/:id/read` | Marks one of the caller's own notifications read; `404` (not the caller's) if it belongs to another parent. | Implemented, Phase 1 Step 9 |
| POST | `/parent/notifications/read-all` | Marks every unread notification of the caller's read. | Implemented, Phase 1 Step 9 |
| PATCH | `/parent/notification-preferences` | own preferences only | Phase 2 (not built — see [ADR 0016](adr/0016-notifications-and-alerts.md); preferences exist in the data model but have no dedicated read/write endpoint yet, only the internal delivery path honors them) |

`POST /parent/notifications` (creating one) does not exist — notifications
are a backend/domain operation, generated only from `NotificationsService`
reacting to a domain event, never a client-callable one.

No parent endpoint ever accepts a `busId`, `tripId`, `deviceId`, `cameraId`, or
`driverId` as a queryable resource — parents reach bus/location data only
transitively through their own `studentId`, which the backend resolves
server-side to the child's current active trip and, from there, its bus
(`ParentTransportService.resolveActiveTripStudent` →
`GpsService.getLocationSnapshotForBus`). This is enforced structurally (the
route doesn't exist, the parameter doesn't exist), not just by a permission
check, per [product-requirements.md](product-requirements.md#5-parent-experience-contract).
A parent token is rejected by every internal staff endpoint (`/gps/fleet`,
`/buses/:id/location`, `/buses/:id/telemetry`, `/students`, etc.) at the
`@RequireAudience('STAFF')` guard, and a staff token is equally rejected by
the parent transport endpoints above.

### Notifications (staff operational alerts)

Implemented in Phase 1 Step 9 — `apps/api/src/notifications/`. Gated by
`notifications.read` (SCHOOL_ADMIN since Phase 0; PRINCIPAL/
TRANSPORT_ADMIN/TRANSPORT_MANAGER added while reviewing existing grants
this phase — see [ADR 0016](adr/0016-notifications-and-alerts.md)). Always
scoped to `recipientId = principal.id` — a School A administrator sees only
their own alerts, never another admin's.

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications` | Own operational alerts (`TRIP_CANCELLED`/`TRIP_NO_SHOW`/`GPS_STALE`/`GPS_OFFLINE`), newest first. Cursor-paginated. |
| GET | `/notifications/unread-count` | `{count}`. |
| POST | `/notifications/:id/read` | Marks one of the caller's own alerts read. |
| POST | `/notifications/read-all` | Marks every unread alert of the caller's read. |

### Reports / Audit
| Method | Path | Permission |
|---|---|---|
| GET | `/reports/attendance` | `reports.read` |
| GET | `/reports/punctuality` | `reports.read` |
| GET | `/audit-logs` | `audit_logs.read` (PRINCIPAL/SCHOOL_ADMIN/SUPER_ADMIN only) |

### System
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/health/ready` | readiness (DB/Redis reachable) |

## 3. Phase 2/3 Endpoint Groups (outlined, not built yet)

`/cameras` (§2, Phase 2 Step 11) and `/safety-events`+`/emergencies` (§2,
Phase 2 Step 12) are now built. Streaming/recording playback,
camera-triggered events, AI-produced safety events, and everything below
remain outlined only:

- `/ai-events`, `/ai-events/:id/review` — `ai_events.read` / `ai_events.review`
- `/incidents`, `/incidents/:id/resolve` — `incidents.read` / `incidents.create` / `incidents.resolve` — a distinct, still-unbuilt concept from `/safety-events` (see database.md §4)
- `/geofences`, `/speed-events` — Phase 2

None of these are exposed to the parent namespace, ever (see
[privacy.md](privacy.md)).

## 4. Realtime Contracts

- **`/realtime/fleet` (Socket.IO namespace, staff only — implemented Phase 1
  Step 7)**: the connection handshake carries `auth: { token }` (the same
  in-memory access token used for REST calls); a missing/invalid/parent
  token is disconnected immediately, no room joined. On success the server
  — never the client — joins the socket into `school:{schoolId}:fleet`
  (unscoped `gps.read` roles) or `school:{schoolId}:bus:{busId}` (`DRIVER`/
  `BUS_ATTENDANT`, their own current trip's bus only, or no room at all if
  they have no current trip). The client cannot request or discover a room
  name. Server pushes `bus.location.updated`:
  ```
  { busId, tripId, latitude, longitude, speedKmh, heading, accuracyM, recordedAt, receivedAt, freshness }
  ```
  emitted only after a fix is accepted AND advances that bus's current
  location (the monotonic rule — an out-of-order fix is stored but never
  emitted as "current"). See
  [ADR 0014](adr/0014-gps-telemetry-and-realtime-tracking.md).
- **`/realtime/parent` (Socket.IO namespace, parent only — implemented
  Phase 1 Step 8)**: a completely separate namespace from `/realtime/fleet`
  above — a parent socket never connects to the fleet namespace, and a
  staff token is rejected here the same way a parent token is rejected
  there. The handshake carries the same `auth: { token }` shape. On
  success the server joins the socket into `parent:child:{studentId}` for
  every one of the caller's own verified linked children — never a
  bus/school room, and never a client-supplied room name (there is no
  `@SubscribeMessage` handler on this gateway at all). Server pushes
  `parent.child.transport.updated`:
  ```
  { childId, tripStatus, attendanceStatus, busDisplayName, location: { latitude, longitude, speedKmh, heading, freshness }, lastUpdatedAt }
  ```
  triggered by the same GPS-ingestion pipeline as `bus.location.updated`
  (an in-process hook, not a duplicated current-location calculation) — see
  [ADR 0015](adr/0015-parent-transport-tracking.md) for the exact trigger
  and its one documented limitation (a boarding/drop-off change with no
  accompanying GPS fix won't independently push; the REST endpoint always
  has the true current state on load/reconnect). The same namespace also
  pushes `parent.notification.created` (Phase 1 Step 9), into the same
  `parent:child:{studentId}` room, for `CHILD_BOARDED`/`CHILD_DROPPED_OFF`
  only:
  ```
  { id, eventType, title, body, payload, readAt, createdAt }
  ```
  Trip-level parent notifications (`TRIP_CANCELLED`/`TRIP_NO_SHOW`) and all
  staff notifications are in-app + REST poll only this phase — an accepted
  MVP scope cut, not an oversight; see
  [ADR 0016](adr/0016-notifications-and-alerts.md).
- **`/realtime/safety` (Socket.IO namespace, staff only — implemented
  Phase 2 Step 12)**: a separate namespace from `/realtime/fleet` — the
  authorization check differs (`safety_events.read` or `emergency.read`,
  not `gps.read`), so conflating them would grant fleet visibility to
  `SECURITY` and vice versa. Same handshake shape (`auth: { token }`); a
  missing/invalid/parent token, or a staff token lacking both permissions
  (e.g. `DRIVER`/`BUS_ATTENDANT`, who hold neither), is disconnected
  immediately. On success the server joins the socket into the single
  whole-school room `school:{schoolId}:safety` — no per-bus granularity
  (unlike `/realtime/fleet`'s fleet-vs-bus split), since every role that
  can see this dashboard at all is meant to see every event in their
  school. No `@SubscribeMessage` handler exists, so there is no mechanism
  for a client to request a different room. Server pushes:
  ```
  safety.event.created   — a SafetyEventDto, on POST /safety-events
  safety.event.updated   — a SafetyEventDto, on any lifecycle transition
  emergency.created      — an EmergencyDto, on POST /emergencies or an escalation
  emergency.updated      — an EmergencyDto, on any lifecycle transition or a new response action
  ```
  See [ADR 0019](adr/0019-safety-events-and-emergency-management.md).
- `/ws/ops` and `/ws/tracking` above were this doc's original Phase 0
  outline names; the implemented namespace/event names differ
  (`/realtime/fleet`, `/realtime/parent`, `/realtime/safety`) and this
  section now reflects what actually ships.

## 5. Versioning

`/api/v1` is additive-evolution: new optional fields and endpoints are added
without a version bump; breaking changes require `/api/v2` with a documented
deprecation window for `/api/v1`, per school contract terms (to be defined by
product/legal, not engineering).
