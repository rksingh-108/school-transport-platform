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
response ever includes a credential/secret field; none exists on the model
(§5.1 of the same doc).

### Routes / Stops
| Method | Path | Permission |
|---|---|---|
| GET/POST | `/routes` | `routes.read` / `routes.manage` |
| PATCH/DELETE | `/routes/:id` | `routes.manage` |
| GET/POST | `/routes/:id/stops` | `routes.read` / `routes.manage` |

### Trips
| Method | Path | Permission |
|---|---|---|
| GET | `/trips` | `trips.read` (filtered to assigned trip for DRIVER/ATTENDANT) |
| POST | `/trips` | `trips.manage` (create/schedule) |
| GET | `/trips/:id` | `trips.read` |
| POST | `/trips/:id/start` | `trips.manage` (DRIVER: own trip only) |
| POST | `/trips/:id/end` | `trips.manage` (DRIVER: own trip only) |
| GET | `/trips/:id/manifest` | `attendance.read` |

### Attendance
| Method | Path | Permission |
|---|---|---|
| POST | `/trips/:tripId/students/:studentId/events` | `attendance.manage` (ATTENDANT: own trip only) — body: `{eventType, source, metadata?}` |
| GET | `/trips/:tripId/students/:studentId/events` | `attendance.read` |

### GPS / Tracking
| Method | Path | Permission |
|---|---|---|
| POST | `/telemetry/gps` | device credential (see below) — ingestion endpoint, not a user-facing one |
| GET | `/buses/:id/location` | `gps.read` (staff) |
| GET | `/parent/children/:studentId/bus-location` | parent, own child only |
| WS | `/ws/tracking` | staff: subscribe by school/bus; parent: subscribe by own-child's-bus only, server-enforced |

Device ingestion uses a distinct auth mechanism (per-device signed credential /
mTLS client cert in production), never a user session token — see
[gps.md](gps.md) (to be written) and [security.md](security.md).

### Parent Endpoints (dedicated namespace, minimal surface)

`ParentSelfController` (`@RequireAudience('PARENT')`, no `@RequirePermission` at
all by design — parent access is relationship-based, not RBAC-based; see
[security.md §4](security.md#4-parent-data-access-boundary)).

| Method | Path | Notes | Status |
|---|---|---|---|
| GET | `/parent/children` | List own linked+**verified** children only (`ParentLinkedChildDto`: id, fullName, grade, section — never contact/admission/status fields). | Implemented, Phase 1 Step 2 |
| GET | `/parent/children/:studentId` | Same shape, single child; `404` (not `403`) if the id isn't a verified link of the caller's, via `@RequireVerifiedChild('studentId')`. | Implemented, Phase 1 Step 2 |
| GET | `/parent/children/:studentId/status` | current trip status + timeline | Phase 2 (not built) |
| GET | `/parent/children/:studentId/bus-location` | live location + ETA | Phase 2 (not built) |
| GET | `/parent/notifications` | own notifications | Phase 2 (not built) |
| PATCH | `/parent/notification-preferences` | own preferences only | Phase 2 (not built) |

No parent endpoint ever accepts a `busId`, `cameraId`, or `driverId` as a queryable
resource — parents reach bus/location data only transitively through their own
`studentId`, which the backend resolves server-side to the current authorized
bus/trip. This is enforced structurally (the route doesn't exist), not just by a
permission check, per [product-requirements.md](product-requirements.md#5-parent-experience-contract).

### Notifications / Reports / Audit
| Method | Path | Permission |
|---|---|---|
| GET | `/notifications` | `notifications.read` (own school) |
| GET | `/reports/attendance` | `reports.read` |
| GET | `/reports/punctuality` | `reports.read` |
| GET | `/audit-logs` | `audit_logs.read` (PRINCIPAL/SCHOOL_ADMIN/SUPER_ADMIN only) |

### System
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/health/ready` | readiness (DB/Redis reachable) |

## 3. Phase 2/3 Endpoint Groups (outlined, not built yet)

- `/cameras`, `/cameras/:id/health` — `camera.read` / `camera.manage`
- `/ai-events`, `/ai-events/:id/review` — `ai_events.read` / `ai_events.review`
- `/incidents`, `/incidents/:id/resolve` — `incidents.read` / `incidents.create` / `incidents.resolve`
- `/geofences`, `/speed-events` — Phase 2
- `/emergency` (POST, from driver/attendant app) — highest-priority notification fanout

None of these are exposed to the parent namespace, ever (see
[privacy.md](privacy.md)).

## 4. Realtime Contracts

- `/ws/ops` (staff): server pushes `trip.status_changed`, `bus.location_updated`,
  `attendance.exception`, `device.offline`, `ai_event.created` (Phase 3),
  `emergency.raised`.
- `/ws/tracking` (parent, scoped to their child's active trip): server pushes only
  `bus.location_updated` and `trip_student.status_changed` for that student's
  bus/trip — the server computes the subscription scope from the authenticated
  parent's verified relationships, the client cannot request a different scope.

## 5. Versioning

`/api/v1` is additive-evolution: new optional fields and endpoints are added
without a version bump; breaking changes require `/api/v2` with a documented
deprecation window for `/api/v1`, per school contract terms (to be defined by
product/legal, not engineering).
