# Security Model

Status: Draft v1

## 1. Authentication

**Implemented in Phase 1 Step 1** — `apps/api/src/auth/`. See
[api.md](api.md#auth) for the exact endpoints and
[ADR 0010](adr/0010-credential-resolution-rls-bypass.md) for how login/refresh/
reset resolve a tenant before it's known.

- Passwords hashed with **argon2id** (memory-hard, OWASP-recommended over bcrypt for
  new systems), never reversible, never logged.
- Web sessions: short-lived JWT access token (15 min, configurable via
  `ACCESS_TOKEN_TTL_SECONDS`) + rotating refresh token stored in an `httpOnly`,
  `Secure` (production)/`SameSite=Lax` cookie scoped to `/api/v1/auth`. Refresh
  tokens are opaque random secrets; only their SHA-256 hash is persisted
  (`refresh_tokens.token_hash`, unique), so a single session can be revoked
  individually. **Rotation with reuse detection**: every refresh both issues a new
  token and revokes the old one (`revoked_reason = ROTATED`,
  `replaced_by_token_id` set); presenting an already-revoked token for any reason
  revokes the entire session family (`session_id`) and is logged as
  `REFRESH_TOKEN_REUSE_DETECTED` — the standard OAuth2 rotation-reuse pattern.
- No mobile/native client exists yet (driver/attendant/parent surfaces are all
  the same responsive Next.js app per [architecture.md](architecture.md#5-frontend-composition)),
  so the body-delivered-token path described in earlier drafts of this doc is not
  built — only the cookie-based web flow. Revisit if/when a non-browser client
  is actually added.
- **Onboarding (Phase 1 Step 2)**: both staff and parent accounts are created
  up front by a school admin with `status: 'INVITED'` and `password_hash: null`,
  then activated via a single-use, time-limited, hashed opaque token
  (`invitations.token_hash`, same SHA-256 mechanism as refresh/reset tokens;
  default TTL `INVITATION_TOKEN_TTL_DAYS=7`) delivered through the same
  `AuthNotificationAdapter` abstraction used elsewhere (console-logged in dev,
  never a fake "email sent" success in place of real delivery). Acceptance
  (`POST /invitations/accept`, public) sets the password and flips status to
  `ACTIVE` atomically; see [database.md](database.md#invitations).
- MFA-ready, not implemented: `users.mfa_enabled` + encrypted TOTP secret exist,
  and login returns `{status:'MFA_REQUIRED'}` (issuing no tokens) when set — but
  no TOTP enrollment/verification endpoint exists yet, so no current account can
  reach that state through any real flow. The check itself is real and tested
  (with a synthetic `mfaEnabled` account), not a stub.
- Parent auth is a **separate login endpoint, separate token audience, and
  separate signing secret** from staff auth (`/auth/parent/login` vs
  `/auth/staff/login`, `JWT_PARENT_SECRET` vs `JWT_STAFF_SECRET`) — a parent's
  token cannot be verified as a staff token even if `@RequireAudience` were
  somehow skipped, because the signature itself won't validate against the other
  secret. Three layers, not one: distinct secret, distinct `aud` claim +
  `AudienceGuard`, and distinct login endpoints.
- **Request-scoped principal, not just decoded claims.** `JwtAuthGuard` re-reads
  the principal from the database (tenant-scoped, by the token's `schoolId`
  claim) on every request rather than trusting the JWT payload for identity —
  this is what makes a suspended/disabled account stop working within one
  access-token lifetime (≤15 min) rather than only at its next login/refresh, and
  it doubles as a defense-in-depth check: a token whose `schoolId` claim doesn't
  match where its subject actually lives finds no row under that tenant's RLS
  scope and is rejected, even though the signature itself is valid.
- Device (GPS/camera) authentication is **not** user authentication: each device
  gets a provisioned credential (API key in MVP; mTLS client certificate once
  volume/security requirements justify it) scoped to exactly one `bus_device_id`,
  never a user session token. Not yet built (Phase 2).
- Rate limiting: a stricter per-route throttle (5/min/IP; refresh at 20/min/IP) on
  `staff/login`, `parent/login`, `refresh`, `change-password`, and both
  `password-reset/*` endpoints, layered on top of the app-wide default
  (100/min/IP) — see `apps/api/src/auth/auth.controller.ts`. Separately, a
  **Redis-backed failed-login counter keyed by the raw submitted identifier**
  (not a resolved account) locks out further attempts after
  `FAILED_LOGIN_MAX_ATTEMPTS` (default 10) within `FAILED_LOGIN_WINDOW_MINUTES`
  (default 15) — keying by the raw identifier, not "does this account exist,"
  means a nonexistent identifier locks out identically to a real one, so the
  lockout behavior itself cannot be used to enumerate accounts.

### 1.1 Account States

`AccountStatus` (`ACTIVE | INVITED | SUSPENDED | DISABLED`) applies to both
`users` and `parents`. Exact semantics:

| State | Can log in? | Can refresh an existing session? | Reversible? |
|---|---|---|---|
| `ACTIVE` | Yes | Yes | — |
| `INVITED` | No | No | Yes — accepting the invitation (`POST /invitations/accept`) sets a password and flips status to `ACTIVE`; see §1's Onboarding note and [database.md](database.md#invitations) |
| `SUSPENDED` | No | No | Yes, by an admin (`POST /users/:id/activate` / `POST /users/:id/suspend`) |
| `DISABLED` | No | No | Not by ordinary admin action (distinguished from `SUSPENDED` for audit/reporting clarity) |

Both login and refresh check `status === 'ACTIVE'` explicitly — anything else is
rejected with the same generic response used for wrong credentials (no status
leaked). A status change while a refresh token is still valid takes effect on
that token's *next* use (refresh checks status fresh every time); a still-valid
*access* token continues to work until it naturally expires (≤15 min) — see
§1's note on request-scoped principal re-validation. Shortening the access-token
TTL further, or adding a token blacklist, would close that residual window if a
future security review decides ≤15 min isn't tight enough.

### 1.2 School Status (Phase 1 Step 2)

`SchoolStatus` (`ACTIVE | TRIAL | SUSPENDED | INACTIVE`) gates login/refresh at
the tenant level, independent of individual account status —
`AuthService.isSchoolOperational()` is checked in `loginStaff`, `loginParent`,
and `refresh`, so suspending a school immediately blocks **every** user's and
parent's session regardless of their own `ACTIVE` status. Status changes require
`platform.schools.manage` (SUPER_ADMIN only) — deliberately separate from
`schools.update` (routine profile edits a SCHOOL_ADMIN already has), since
suspending a school is a platform-level lifecycle action, not school
self-service. See [ADR 0011](adr/0011-school-status-platform-managed.md).

## 2. Authorization (RBAC + Permissions)

### 2.1 Model

`users` ──*user_roles*──▶ `roles` ──*role_permissions*──▶ `permissions`

Permissions are fine-grained strings, `resource.action` (see the full seed list in
[database.md](database.md#roles-permissions-role_permissions-user_roles)):

```
schools.read, schools.update
users.read, users.create, users.update, users.delete, users.manage_roles
students.read, students.create, students.update, students.delete
parents.read, parents.create, parents.update, parents.manage_relationships
buses.read, buses.manage
drivers.read, drivers.manage
attendants.read, attendants.manage
routes.read, routes.manage
trips.read, trips.manage
attendance.read, attendance.manage
gps.read
camera.read, camera.manage
ai_events.read, ai_events.review
incidents.create, incidents.read, incidents.resolve
emergency.create, emergency.read
notifications.read, notifications.manage
reports.read
audit_logs.read
device_health.read
platform.schools.read, platform.schools.create, platform.schools.manage, platform.impersonate_school
```

### 2.2 Enforcement — centralized, not scattered

**Implemented** — `apps/api/src/auth/guards/`, `apps/api/src/auth/decorators/`.

- `@RequirePermission('students.read')` + `PermissionsGuard` is the only
  sanctioned way to gate a staff endpoint. There is no code path that checks
  `user.role === 'SCHOOL_ADMIN'` directly in a controller or service — that
  couples business logic to a specific role and breaks the moment a school wants
  a custom role composed differently.
- `PermissionsGuard`, `AudienceGuard`, `JwtAuthGuard`, and `ParentChildAccessGuard`
  are all registered **globally** (`APP_GUARD` in `AuthModule`), not per-controller
  `@UseGuards(...)`. Each one no-ops (`return true`) when its corresponding
  decorator (`@RequirePermission`, `@RequireAudience`, `@Public`,
  `@RequireVerifiedChild`) is absent from a route. This is a deliberate choice
  over per-controller opt-in: a future module can enforce a check with the
  decorator *alone* — forgetting an accompanying `@UseGuards()` can no longer
  silently disable it.
- `RbacService.getRolesAndPermissions()` resolves a staff principal's roles/
  permissions fresh from the database on **every** call (no request-scoped
  cache yet) — a revoked role therefore takes effect on the very next request,
  not just after the access token expires. This is a deliberate correctness-
  over-latency tradeoff for now; a request-scoped cache is a reasonable future
  optimization if the extra query proves costly at scale.
- The one resource-scoping check that exists so far — "is this parent verified
  for this specific student" — is `ParentChildAccessGuard` +
  `@RequireVerifiedChild('studentId')` (see §4). As of Phase 1 Step 2 it has its
  first real production consumer: `GET /parent/children/:studentId`
  (`ParentSelfController`) — a parent requesting a sibling's or another
  family's student ID gets `404`, verified by e2e test. Future analogous checks
  (e.g. "is this trip assigned to this driver") follow the same pattern: a
  dedicated guard + decorator per relationship, not a generic one-size-fits-all
  policy function.

### 2.3 Default Role → Permission Matrix (MVP scope; Phase 2/3 permissions granted
when those modules ship)

| Permission | SUPER_ADMIN | SCHOOL_ADMIN | TRANSPORT_ADMIN | TRANSPORT_MANAGER | PRINCIPAL | DRIVER | ATTENDANT | SECURITY | PARENT |
|---|---|---|---|---|---|---|---|---|---|
| students.read/write | platform only | ✓ | – | – | read | – | – | – | own child, read-only via parent endpoints |
| buses.manage | platform only | ✓ | ✓ | read | read | – | – | – | – |
| drivers/attendants.manage | – | ✓ | ✓ | read | read | – | – | – | – |
| routes/stops.manage | – | ✓ | ✓ | read | read | – | – | – | – |
| trips.manage | – | ✓ | ✓ | ✓ | read | own trip start/end | own trip read | – | – |
| attendance.manage | – | read | read | ✓ | read | – | own trip only | – | – |
| gps.read | – | ✓ | ✓ | ✓ | ✓ | own bus only | own bus only | ✓ | own child's bus only, via dedicated endpoint |
| camera.read/manage | – | – | ✓ | ✓ | – | – | – | ✓ | never |
| ai_events.review | – | – | ✓ | – | read | – | – | ✓ | never |
| incidents.* | – | ✓ | ✓ | – | ✓ | – | – | ✓ | never |
| emergency.create | – | – | – | – | – | ✓ | ✓ | – | – |
| emergency.read | – | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | never |
| reports.read | – | ✓ | ✓ | ✓ | ✓ | – | – | – | never |
| audit_logs.read | platform | ✓ | – | – | ✓ | – | – | – | never |

"Never" entries above are not merely unassigned permissions — the parent namespace's
controllers (`/parent/*`) do not accept a permission grant for camera/ai/incident
scopes at all; there is no configuration that could accidentally expose them. See
[api.md](api.md#parent-endpoints-dedicated-namespace-minimal-surface).

This matrix is seed data (`prisma/seed.ts`), not hardcoded `if` statements, so a
future custom-role feature is additive.

## 3. Tenant Isolation

Two independent layers, because relying on either alone is a known failure mode:

1. **Application layer (primary).** Every repository method's signature requires a
   `schoolId` derived from `TenantContext`, never from client input. A code-review
   / lint rule flags any Prisma query in a module's repository that omits a
   `where: { schoolId }` clause on a tenant-scoped model.
2. **Database layer (defense-in-depth).** PostgreSQL RLS policies (see
   [database.md](database.md#5-row-level-security)) reject any row read/write
   outside `current_setting('app.current_school_id')`, set once per request
   transaction by middleware. If a future engineer forgets layer 1, layer 2 still
   holds. `SUPER_ADMIN` cross-tenant operations use a distinct, explicitly audited
   database role/bypass — never a blanket RLS-disabled connection for the whole app.

**Tested explicitly** (see [testing section below](#6-testing-requirements)): a
user authenticated for School A must receive `404` (not `403`, to avoid confirming
the resource's existence across tenants) for any School B resource ID, at both the
service-layer and raw-HTTP e2e level.

## 4. Parent Data-Access Boundary

Enforced at three independent points (belt-and-braces, given this is the highest
child-privacy-sensitivity path in the product):

1. **Route existence**: parent-callable routes are a physically separate controller
   namespace (`/parent/*`) that never imports camera/AI/incident services.
2. **Relationship check**: every parent query resolves `studentId` through a
   `verified = true` row in `parent_students` scoped to the authenticated parent —
   never a raw `studentId` lookup, and never one the parent supplies to create
   the link themselves. **Implemented** as `ParentAccessService`
   (`apps/api/src/auth/services/parent-access.service.ts`, `getVerifiedChildIds`/
   `isVerifiedChild`) and `ParentChildAccessGuard` +
   `@RequireVerifiedChild('studentId')`, now used by
   `GET /parent/children/:studentId` (§2.2). Failure returns `404`, never
   `403` — indistinguishable from the student not existing at all, matching
   §3's cross-tenant 404 convention applied to the parent-child boundary. The
   link itself is always staff-initiated (`POST /parents/:id/children`,
   `parents.manage_relationships`) and separately staff-verified
   (`POST /parent-students/:id/verify`) — a parent can never claim an
   arbitrary student by supplying an ID, by construction (no such endpoint
   exists in the parent namespace). `GET /parent/children` (list) and
   `/auth/me`'s `linkedChildrenCount` both filter to `verified = true` only.
3. **Field-level shaping**: parent-facing DTOs are hand-written response shapes
   (e.g., `ParentTripStatusDto`) that only ever include fields explicitly meant for
   parents — they are not the internal entity serialized with fields hidden by
   convention. This means adding an internal field to `Trip` can never accidentally
   leak to a parent response; a new DTO field is a deliberate, reviewed addition.

## 5. Other Controls

- Input validation: Zod/class-validator DTOs on every endpoint; unknown fields
  rejected (`forbidNonWhitelisted`).
- Output: no ORM entity is ever returned directly from a controller — always mapped
  to a DTO, closing the same "accidental field leak" gap as above for every module,
  not just parent-facing ones.
- Security headers via `helmet` (HSTS, X-Content-Type-Options, frame-ancestors deny,
  CSP for the web app).
- CSRF: double-submit or `SameSite=Lax` cookie strategy for the web session flow
  (mobile/API bearer-token flow is not cookie-based and is not CSRF-exposed).
- Secrets: `.env` for local dev only, never committed (`.gitignore` from repo
  creation); production secrets via the deployment platform's secret manager —
  never baked into images.
- File access: see [privacy.md](privacy.md#file-access) — signed, short-lived URLs
  only, minted after an authorization check, never a public bucket.
- Dependency scanning: `npm audit`/`pnpm audit` and a SAST/dependency step
  (e.g., GitHub CodeQL + Dependabot) in CI — see [roadmap.md](roadmap.md) for when
  this is wired into the pipeline.
- Structured logs: request ID, tenant ID, user ID (not parent/student PII), route,
  status, latency, error code. Explicit deny-list in the logger serializer for
  `password`, `password_hash`, `token`, `mfa_secret`, and any field named `*ssn*`,
  `*aadhaar*` if ever introduced.

### 5.1 Device Security

`BusDevice` (Phase 1 Step 3) originally shipped with **no credential/secret
column** at all, reasoning that a column nothing issues, reads, or rotates
would be a fake security control. Phase 1 Step 7's GPS ingestion is the
first capability that genuinely needs device identity, so it adds the
minimum real mechanism: `BusDevice.credentialHash` stores the SHA-256 hash
of an opaque bearer token, generated via the same
`TokenService.generateOpaqueToken()`/`hashOpaqueToken()` already used for
refresh/reset/invitation tokens — never a plaintext secret at rest, never
logged. `POST /devices/:id/credential` (`buses.manage`) issues/rotates it
and returns the raw token exactly once; no read endpoint (`GET`/`PATCH
/devices/:id`) ever includes it, only `credentialSetAt` (a timestamp — was
one ever issued, and when). Rotating overwrites the previous hash outright:
the old token stops authenticating immediately, with no overlap window.

This is deliberately not a claim that real hardware provisioning now
exists — no mTLS, no per-device certificate, no field-deployment tooling.
`externalDeviceId` (the device's serial/IMEI) remains not treated as a
secret — it identifies a device the way a license plate identifies a car —
but it is no longer the *only* thing distinguishing one device from
another: the credential is what actually authenticates a GPS ingestion
request, so `externalDeviceId` being non-secret no longer implies anything
about impersonation risk. See
[ADR 0014](adr/0014-gps-telemetry-and-realtime-tracking.md).

### 5.2 Device / Fleet Authorization

Bus, driver, attendant, and device management share the existing
`buses.read`/`buses.manage`/`drivers.read`/`drivers.manage`/
`attendants.read`/`attendants.manage` permissions from the seeded matrix
(§2.3) — no new `devices.*` permission was introduced. A `BusDevice` has no
lifecycle independent of the bus it's attached to, so its endpoints are
gated by the owning bus's permissions (`buses.read` to view a bus's devices,
`buses.manage` to register/update/deactivate one); introducing a parallel
`devices.*` permission would duplicate a distinction that doesn't exist in
the data model. `TRANSPORT_MANAGER` was given read-only fleet visibility
(`buses.read`/`drivers.read`/`attendants.read`) in Phase 1 Step 3 — a
pre-existing gap found while reviewing the seeded matrix before adding
anything new (a manager who schedules trips/attendance needs to see the
fleet, but has no business editing it).

### 5.3 Route / Stop Authorization

Route and stop management (Phase 1 Step 4) share the existing
`routes.read`/`routes.manage` permissions — no `stops.*` permission was
introduced, same reasoning as §5.2: a stop has no lifecycle independent of
the route it belongs to. The seeded matrix already granted
`TRANSPORT_MANAGER` and `PRINCIPAL` read-only route access (§2.3) before
this phase started, so no permission-grant changes were needed here (unlike
the buses/drivers/attendants gap found in Phase 1 Step 3). `DRIVER`,
`BUS_ATTENDANT`, and `PARENT` receive no route/stop permissions at all —
route *management* is a staff-planning concern, distinct from a future
parent-facing "where is my child's bus on their route today" view, which
will be a separate, narrowly-scoped parent endpoint once Trips exist, never
this management API.

### 5.4 Trip Authorization

Trip and manifest management (Phase 1 Step 5) reuse `trips.read`/
`trips.manage` — no `trips.students.*` permission was introduced, same
reasoning as §5.2/§5.3: a manifest entry has no lifecycle independent of
its trip. Two things go beyond a flat permission check, both enforced in
`TripsService`, not the route guard:

- **Own-trip scoping for read access.** `DRIVER`/`BUS_ATTENDANT` hold
  `trips.read` but never `trips.manage` (see below), so every
  `GET /trips`/`GET /trips/:id` they make is scoped to only trips where
  they are the assigned driver/attendant — resolved by looking up their own
  `Driver`/`Attendant` profile, never a client-supplied filter. A trip that
  exists but isn't theirs returns `404`, matching the codebase's general
  "authorization boundary looks like resource-not-found" convention.
- **Driver-only start/complete.** `POST /trips/:id/start` and `/complete`
  are gated at the route level by the weaker `trips.read` (so a `DRIVER`
  can reach them at all), and `TripsService` then checks "`trips.manage`
  OR the caller is this specific trip's assigned driver" before proceeding
  — the same pattern already used for `UsersService`'s "you cannot suspend
  your own account" check (a permission grant plus an identity check the
  permission system alone can't express). `BUS_ATTENDANT` never passes
  this check for a trip that isn't theirs to drive, since attendants don't
  start/end trips.

Phase 0's seed had granted `DRIVER` a blanket `trips.manage`, which — if
left in place — would have let any driver create, reassign, or cancel
*every* trip in the school, not just start/complete their own. This was
removed while reviewing existing grants for this phase (§2.3's matrix
already documented the narrower "own trip start/end" intent for `DRIVER`;
the seed data had simply drifted from it) — the same kind of gap found and
fixed for `TRANSPORT_MANAGER`'s fleet visibility in Phase 1 Step 3.

### 5.5 Attendance Authorization

Boarding/drop-off/absence/correction (Phase 1 Step 6) reuse `attendance.read`/
`attendance.manage` — no new permission was introduced. Per §2.3's matrix
(unchanged from Phase 0, and already correct — no seed drift this time),
`SCHOOL_ADMIN`/`TRANSPORT_ADMIN`/`PRINCIPAL` hold `attendance.read` only
(oversight, not personally recording attendance — a deliberate
separation-of-duties choice, not a gap), `TRANSPORT_MANAGER` holds
unscoped `attendance.manage`, and `BUS_ATTENDANT` holds it scoped to "own
trip only." `DRIVER` holds neither — drivers don't record boarding.

Because `TRANSPORT_MANAGER` and `BUS_ATTENDANT` hold the *identical*
`attendance.manage` permission string, the permission-level trick used for
`DRIVER` in §5.4 doesn't distinguish them. Instead, `AttendanceService`
resolves scope by checking whether the caller has an `Attendant` **profile**
at all: if so, every action is restricted to trips where
`trip.attendantId` matches that profile (regardless of which permission
grant let them reach the endpoint); if not, no restriction applies. See
[ADR 0013](adr/0013-attendance-event-model.md) for the full reasoning and
its accepted edge case (someone who is both an attendant profile-holder and
a `TRANSPORT_MANAGER` is still scoped down).

`attendance.read` was missing from `BUS_ATTENDANT`'s seeded grants — a
Phase 0 gap (they had `attendance.manage` but not the separate read
permission the manifest/history endpoints also check) — fixed while
reviewing existing grants, the same pattern as §5.4's `DRIVER` fix and
Phase 1 Step 3's `TRANSPORT_MANAGER` fleet-visibility fix.

`recordedBy` on every event is always the authenticated principal's id;
no request schema in this module has a client-suppliable actor field at
all, so there is nothing to spoof, by construction.

### 5.6 GPS Authorization (Device + Staff)

Two separate identities can reach the GPS module, authenticated two
different ways, and neither trusts the other's input:

- **Device identity** (`POST /telemetry/gps`) is established by
  `DeviceAuthGuard` from the bearer credential described in §5.1 — never a
  staff/parent JWT, and the route is marked `@Public()` precisely so the
  global `JwtAuthGuard` doesn't demand one. The resolved device's
  `schoolId`/`busId` are the *only* source of truth for where a fix is
  written; the request payload (`gpsTelemetrySchema`) has no
  `schoolId`/`busId`/`deviceId`/`tripId` field at all, so there is nothing
  for a malicious device to spoof — the same "eliminate the input rather
  than validate it" technique attendance used for `tripStopId` in Step 6.
  `tripId` is likewise never accepted from the device: it's resolved
  server-side as "whichever trip is currently `IN_PROGRESS` for this
  device's own bus."
- **Staff identity** (every other GPS endpoint, plus the `/realtime/fleet`
  WebSocket) reuses the existing `gps.read` permission — no new permission
  was introduced, and per §2.3's matrix (already correct since Phase 0, no
  seed drift found this time) `SCHOOL_ADMIN`/`TRANSPORT_ADMIN`/
  `TRANSPORT_MANAGER`/`PRINCIPAL`/`SECURITY` hold it unscoped while
  `DRIVER`/`BUS_ATTENDANT` hold it scoped to "own bus only." Neither role
  has a permanent bus assignment in the schema, so `GpsService.resolveGpsScope`
  resolves "own bus" the same profile-based way `AttendanceService` resolves
  "own trip" (§5.5): does the caller have a `Driver`/`Attendant` profile,
  and if so, what bus is their own currently `IN_PROGRESS` trip on. No
  current trip means no accessible bus (the safe default), not "every bus."
  This one method is shared by REST authorization checks and the WebSocket
  gateway's room-join logic, so the rule lives in exactly one place. See
  [ADR 0014](adr/0014-gps-telemetry-and-realtime-tracking.md).

The `/realtime/fleet` WebSocket authenticates its handshake with the same
access token used for REST (`auth.token`), verified with the existing
`TokenService`/`AuthService`, then gated by the same `gps.read` check via
`RbacService`. A parent token is rejected identically to no token at all —
parents have no live-tracking access in this phase (Step 8). The room a
socket joins is always computed server-side from `resolveGpsScope`; there
is no code path where a client can request or discover a room name, closing
the "arbitrary room" class of IDOR by construction rather than by checking
it at emit time.

## 6. Testing Requirements

Mandatory automated coverage before a module is considered done (ties to
[Definition of Done] in the top-level brief):

- Unit tests per policy function (allow/deny matrix).
- Integration tests hitting a real (test) Postgres with RLS enabled.
- E2E/API tests specifically for:
  - Cross-tenant access → 404, for every tenant-scoped resource type.
  - Parent can read own child, cannot read sibling-of-a-different-parent, cannot
    read camera/AI/incident routes (route-level 404, not just 403).
  - Driver can only start/end their own assigned trip.
  - Attendant can only mark attendance on their own assigned trip.
  - `SECURITY` role cannot read student academic/contact fields not relevant to
    safety review (field-level assertion on the DTO, not just status-code).
  - AI event review never auto-creates a `CONFIRMED_INCIDENT` without a human actor
    (Phase 3 — but the invariant is recorded here now since it's foundational).

**Covered as of Phase 1 Step 1** (`apps/api/test/auth.e2e-spec.ts`, plus unit specs
under `apps/api/src/auth/`): staff/parent login success and failure (wrong
password, unknown identifier, suspended account — with an enumeration-safety
equality check across those failure modes); access-token validation (missing,
expired, forged/mismatched `schoolId` claim); `/auth/me` for both audiences;
audience separation in both directions via a test-only guarded controller;
staff RBAC allow/deny; parent-child allow/deny/cross-tenant-404; refresh
rotation, reuse detection killing the whole session family, and revoked-token
rejection; logout and logout-all; change-password (wrong current password,
session revocation on success); password-reset request (enumeration-safety),
confirm, single-use enforcement, and expiry; per-route rate limiting (isolated
app instance, real Redis-backed `ThrottlerStorage` — not mocked); and a direct
audit-log-content check that no raw password or token ever appears in
`audit_logs.metadata`. RLS itself is additionally re-verified independently of
the application in this phase via direct `psql` checks as the actual restricted
`app_user` role (not the superuser) — see
[ADR 0010](adr/0010-credential-resolution-rls-bypass.md)'s implementation-
correction note for why that mattered here specifically.

**Covered as of Phase 1 Step 2** (`apps/api/test/core-domain.e2e-spec.ts`):
two full schools (A, B) with distinct admins, a driver with no `students.*`
grants, and multiple students/parents per school, specifically to exercise
cross-tenant scenarios. Explicit IDOR coverage: `GET`/`PATCH` a School B
student ID while authenticated as School A → `404`; `GET` a School B parent
while authenticated as School A → `404`; a `schoolId` field supplied in a
create/update body can never escape the caller's own tenant (the DTOs
structurally omit the field, so this is verified by confirming the created
resource always lands in the caller's tenant, not by trying to smuggle the
field past validation); `GET /parent/children/:studentId` for a
different parent's or a sibling's student → `404` via
`ParentChildAccessGuard`. Also covered: staff invite → accept → activate →
login end-to-end; the SUPER_ADMIN-only escalation guard on
`POST /users/:id/roles` and `POST /users/invite` (a SCHOOL_ADMIN attempting to
grant `SUPER_ADMIN` gets `403`, even to themselves); school-status blocking
login/refresh for every account under a `SUSPENDED`/`INACTIVE` school; and a
direct `psql`-as-`app_user` re-verification that `invitations` enforces RLS
with the platform-admin bypass clause, mirroring the Step 1 RLS
re-verification described above.

## 7. Threats Explicitly Considered

- Cross-tenant enumeration via sequential/guessable IDs → mitigated by UUIDv4 PKs
  (see [database.md](database.md#1-conventions)) plus RLS/404 behavior above.
- Parent self-linking to an arbitrary child → mitigated by the `verified` gate in
  `parent_students`.
- Device credential compromise → scoped to a single `bus_device_id`; revocable
  independently; cannot authenticate as a user.
- Insider over-access (staff browsing beyond their remit) → permission matrix +
  audit logging of all read access to `students`, `ai_events`, `incidents`, and
  `files` of type `INCIDENT_CLIP`.
