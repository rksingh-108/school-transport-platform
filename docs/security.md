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
emergency.create, emergency.read, emergency.manage
safety_events.create, safety_events.read, safety_events.manage
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
| camera.read/manage | – | ✓ | ✓ | read | read | – | – | read | never |
| ai_events.review | – | – | ✓ | – | read | – | – | ✓ | never |
| incidents.* | – | ✓ | ✓ | – | ✓ | – | – | ✓ | never |
| emergency.create | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| emergency.read | – | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | never |
| emergency.manage | – | ✓ | ✓ | ✓ | ✓ | – | – | – | never |
| safety_events.create | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | never |
| safety_events.read/manage | – | ✓ | ✓ | ✓ | ✓ | – | – | read | never |
| geofences.read/manage | – | ✓ | ✓ | read | read | – | – | read | never |
| safety_rules.read/manage | – | ✓ | ✓ | read | read | – | – | read | never |
| reports.read | – | ✓ | ✓ | ✓ | ✓ | – | – | – | never |
| audit_logs.read | platform | ✓ | – | – | ✓ | – | – | – | never |

`camera.read`/`camera.manage` for `SCHOOL_ADMIN` and `camera.read` for
`PRINCIPAL` were added in Phase 2 Step 11 — these permission keys existed in
seed data since before any camera module was built (see database.md's
"Phase 2/3 permissions... included here even though those modules are not
implemented yet" note), but had never actually been granted to either role,
the same class of gap previously found and fixed for `TRANSPORT_MANAGER`
(`buses.read`, Step 3) and `TRANSPORT_ADMIN` (`notifications.read`,
Step 9). `DRIVER`/`BUS_ATTENDANT` remain deliberately ungranted — operating
a bus is not, by itself, a reason to see its camera inventory.

`emergency.create` for `SCHOOL_ADMIN`/`PRINCIPAL`/`TRANSPORT_ADMIN`/
`TRANSPORT_MANAGER`, `emergency.manage` (new), and
`safety_events.create`/`.read`/`.manage` (new) were all added in Phase 2
Step 12 — see [ADR 0019](adr/0019-safety-events-and-emergency-management.md)
Decision 4 for the full reasoning, including the specific gap this closed
(`emergency.create` had never been granted to any operational staff role,
despite the step's own spec listing "authorized staff" alongside
driver/attendant as able to trigger an emergency directly).
`safety_events.create`/`emergency.create` are the narrow permissions
DRIVER/BUS_ATTENDANT hold — own currently-assigned trip/bus only, enforced
in `SafetyEventsService`/`EmergenciesService`, never by the permission
grant alone (the same "gate by the shared weak permission, authorize for
real in the service" pattern already used for `trips.read` on
`/trips/:id/start`). Neither role ever holds `.read`/`.manage` for either
domain — triggering an alert is not the same capability as browsing or
triaging every other one in the school.

`geofences.read`/`geofences.manage` and `safety_rules.read`/
`safety_rules.manage` were added in Phase 2 Step 13, following the same
singular-permission-per-domain convention as cameras/safety-events — see
[ADR 0020](adr/0020-geofencing-and-operational-safety-rules.md) Decision
10. Full read+manage for `SCHOOL_ADMIN`/`TRANSPORT_ADMIN`, read-only for
`TRANSPORT_MANAGER`/`PRINCIPAL`/`SECURITY`. `DRIVER`/`BUS_ATTENDANT` hold
neither — unlike safety-events/emergencies, there is no create-only grant
here at all, since drivers/attendants never configure geofences or rules
in either direction; they only ever see the resulting `SafetyEvent` rows
through their existing own-trip scope.

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
   `@RequireVerifiedChild('studentId')`, used by `GET /parent/children/:studentId`
   (§2.2, Phase 1 Step 2) and, since Phase 1 Step 8,
   `GET /parent/children/:studentId/transport` (§5.7). Failure returns `404`, never
   `403` — indistinguishable from the student not existing at all, matching
   §3's cross-tenant 404 convention applied to the parent-child boundary. The
   link itself is always staff-initiated (`POST /parents/:id/children`,
   `parents.manage_relationships`) and separately staff-verified
   (`POST /parent-students/:id/verify`) — a parent can never claim an
   arbitrary student by supplying an ID, by construction (no such endpoint
   exists in the parent namespace). `GET /parent/children` (list) and
   `/auth/me`'s `linkedChildrenCount` both filter to `verified = true` only.
3. **Field-level shaping**: parent-facing DTOs are hand-written response shapes
   (`ParentLinkedChildDto`, `ParentChildWithTransportDto`, `ParentTransportDto`,
   `ParentChildTransportUpdatedEvent` — see §5.7) that only ever include fields
   explicitly meant for parents — they are not the internal entity serialized
   with fields hidden by convention. This means adding an internal field to
   `Trip`/`Bus`/`GpsPoint` can never accidentally leak to a parent response; a
   new DTO field is a deliberate, reviewed addition.

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

### 5.1a Camera Device Security (Phase 2 Step 11)

A camera's device identity/credential reuses `BusDevice` exactly as GPS
does (`deviceType: 'CAMERA_CONTROLLER'`) — same `credentialHash` column,
same `TokenService` generate/hash mechanics, same "raw token shown exactly
once, never retrievable again" rule, same one-way rotation. It is a
**separate** guard/resolver from GPS's (`CameraDeviceAuthGuard` /
`CamerasService.resolveDeviceByCredential`, filtered to
`deviceType: 'CAMERA_CONTROLLER'`) rather than a shared one — a GPS
tracker's credential must never authenticate a camera heartbeat, or vice
versa, and threading a `deviceType` parameter through one shared guard was
judged more coupling than the ~10 duplicated lines avoid. Archiving a
camera (`POST /cameras/:id/archive`) sets the underlying device to
`INACTIVE` in the same transaction; since credential resolution only ever
matches `ACTIVE` devices, a retired camera's credential silently stops
authenticating with no separate revocation step. The heartbeat endpoint
(`POST /camera-devices/heartbeat`) carries no client-asserted "online"
status and no `schoolId`/`busId`/`cameraId` field — identity is resolved
entirely from the credential, and arrival of the authenticated request
(recorded as `lastSeenAt`) is the only signal a device is live. See
[ADR 0018](adr/0018-camera-device-management-foundation.md).

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

**Cameras are the one exception to this pattern.** Even though a `Camera`
row is, structurally, a `BusDevice` extension exactly like a GPS tracker,
its endpoints are deliberately gated by `camera.read`/`camera.manage` —
pre-existing permission keys reserved for this module since before it was
built (§2.3) — never by `buses.read`/`buses.manage`. Camera access is
intentionally a narrower, separately-grantable capability than generic
fleet-device visibility: `SECURITY` has `camera.read` with no
`buses.read`/`buses.manage` at all, and `DRIVER`/`BUS_ATTENDANT` have
neither `camera.read` nor `camera.manage` despite already having
`gps.read` (§2.3's note on why "operates the bus" isn't a reason to see its
cameras). Reusing `buses.*` here would have made every `buses.read` grant
silently double as camera visibility, which is exactly the unreviewed
widening this project's RBAC changes are supposed to avoid.

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
parents have no access to *this* namespace, ever; their own separate
live-tracking channel is `/realtime/parent` (§5.7). The room a socket joins
is always computed server-side from `resolveGpsScope`; there is no code
path where a client can request or discover a room name, closing the
"arbitrary room" class of IDOR by construction rather than by checking it
at emit time.

### 5.7 Parent Transport Authorization

Parent transport reads (Phase 1 Step 8 — `GET /parent/children`'s
`transport` summary, `GET /parent/children/:studentId/transport`, and the
`/realtime/parent` WebSocket) are relationship-based, not RBAC-based, same
as every other parent endpoint (§4) — no `gps.*`/`trips.*`/`attendance.*`
permission is ever granted to a parent, and none was added for this phase.
Every read is reached only through
`ParentTransportService.resolveActiveTripStudent(schoolId, studentId)`,
which never accepts a bus/trip/device id — only a `studentId` already
verified by `ParentChildAccessGuard` before the service runs (§4). This
means there is no parameter anywhere in this phase's parent-facing surface
that could reference another tenant's, another parent's, or an unrelated
student's data — the IDOR classes the spec calls out (arbitrary trip,
arbitrary bus, arbitrary device) don't have a corresponding input to
supply, structurally, the same technique GPS ingestion (§5.6) and
attendance's stop-derivation (§5.5) already use.

Bus location for a parent is read via
`GpsService.getLocationSnapshotForBus(schoolId, busId)` — a public method
with no RBAC/scope check of its own, callable only because
`ParentTransportService` has already established the `busId` through the
child's own verified, active trip. This is deliberate: the check that
matters (does this parent have a right to see this bus) happened one layer
up, at the trip-resolution step, not by teaching `GpsService` about
parents.

`/realtime/parent` (`ParentGateway`) authenticates its handshake exactly
like `/realtime/fleet` (same `TokenService`/`AuthService`), but requires
`claims.type === 'PARENT'` (a staff token is rejected identically to no
token) and has no permission check at all, matching the RBAC-free posture
of every other parent route. Room membership is resolved from
`ParentAccessService.getVerifiedChildIds` — the identical service the REST
side and `/auth/me`'s `linkedChildrenCount` already use — so a parent's
realtime scope can never drift from their REST-visible scope. There is no
`@SubscribeMessage` handler on this gateway, so there is no mechanism at
all for a client to join, request, or discover any room, including another
child's room or a staff fleet/bus room. See
[ADR 0015](adr/0015-parent-transport-tracking.md).

### 5.8 Notification Authorization

Notifications (Phase 1 Step 9) split cleanly along the same two authz
postures already established for every other domain: parent access is
relationship-based, staff access is RBAC-based.

- **Parent** (`/parent/notifications*`): no `@RequirePermission` at all,
  matching every other parent endpoint (§4). The recipient is always
  `principal.id` — there is no route parameter or request body field
  anywhere in this controller that could name a different parent, so
  there is nothing to forge. `POST /parent/notifications` (creating one)
  does not exist at all; notifications are produced only by
  `NotificationsService` reacting to a domain event.
- **Staff** (`/notifications*`): gated by the existing `notifications.read`
  permission — `SCHOOL_ADMIN` held it since Phase 0; `PRINCIPAL`/
  `TRANSPORT_ADMIN`/`TRANSPORT_MANAGER` were missing it despite being
  exactly the roles this phase's operational-staff-alert recipient list
  names, fixed while reviewing existing grants (the same class of
  correction as `TRANSPORT_MANAGER`'s fleet-visibility gap in Phase 1
  Step 3 and `bus_devices`' RLS gap in Phase 1 Step 7). The recipient is
  always `principal.id` regardless of permission — a School A
  administrator can only ever see their own alerts, never another
  admin's, and there is no endpoint that lists another user's
  notifications.

**Recipient resolution never trusts client input.** Every notification is
created by `NotificationsService` from a `DomainEvent` payload that
originates entirely server-side (the authenticated principal who triggered
the underlying board/dropoff/trip-lifecycle action, or the system's own
GPS freshness check) — no domain event field, and therefore no
notification's `recipientId`, is ever taken from a request body. Recipient
sets are computed from existing, already-verified relationships:
`ParentStudent.verified = true` rows for child-scoped events, and role-key
membership (`SCHOOL_ADMIN`/`PRINCIPAL`/`TRANSPORT_ADMIN`/
`TRANSPORT_MANAGER`) for operational staff alerts — never "every user in
the school." See [ADR 0016](adr/0016-notifications-and-alerts.md).

### 5.9 Camera Authorization (Phase 2 Step 11)

`CamerasController` is staff-only (`@RequireAudience('STAFF')`) and gated
entirely by `camera.read`/`camera.manage` (§5.2) — there is no parent
audience on this controller, and no route on it accepts an audience other
than `STAFF` at all. Ownership checks mirror `BusDevicesController`
exactly: every bus-scoped operation first confirms the bus belongs to the
caller's own tenant (`assertBusInTenant`) before touching anything, and
every camera lookup is tenant-scoped via `runInTenantContext`, so a
cross-tenant camera id is `404`, never `403` (existence is not revealed).
Reassigning a camera to a different bus (`PATCH .../busId`) re-verifies the
*target* bus against the same tenant check — a School A admin cannot
attach their own camera to a School B bus, or vice versa, by supplying a
foreign `busId`. See §6 for the specific IDOR/RBAC test scenarios and
[ADR 0018](adr/0018-camera-device-management-foundation.md) for why no
parent-facing camera capability exists anywhere in this codebase.

### 5.10 Safety Event / Emergency Authorization (Phase 2 Step 12)

Both `SafetyEventsController` and `EmergenciesController` are staff-only
(`@RequireAudience('STAFF')`) — there is no parent audience on either
controller, no safety/emergency field on any parent DTO, and no
safety/emergency event on the parent realtime channel (§5.7's
`ParentGateway` was not touched by this step at all). `POST` (create/
trigger) on both is gated by the narrowest permission every eligible
caller holds (`safety_events.create`/`emergency.create` — see §2.3); every
lifecycle transition requires the stronger `.manage` permission, which
DRIVER/BUS_ATTENDANT never hold.

Ownership resolution is profile-based, reusing `GpsService.resolveGpsScope`/
`TripsService.assertCanOperate`'s exact pattern (§5.4/§5.6): if the
authenticated principal has a `Driver` or `Attendant` profile, they are
*always* scoped to their own currently-`IN_PROGRESS` trip inside
`SafetyEventsService`/`EmergenciesService` — a supplied `busId`/`tripId`
that doesn't match it is `403`; having no current trip and supplying
neither is `400`, never a guess. A staff principal with no such profile may
reference any bus/trip/camera in their own tenant (verified, `404` if
foreign) or none at all. Every lookup by id is tenant-scoped via
`runInTenantContext`, so a cross-tenant safety-event/emergency id is `404`,
never `403`. `createdBy`/`initiatedBy`/`schoolId`/`source` are never
accepted from the client on any route. See §6 for the specific IDOR/RBAC/
state-machine test scenarios and
[ADR 0019](adr/0019-safety-events-and-emergency-management.md).

### 5.11 Geofencing / Safety Rule Authorization (Phase 2 Step 13)

Both `GeofencesController` and `SafetyRulesController` are staff-only
(`@RequireAudience('STAFF')`) — no parent audience exists on either, no
geofence/rule field exists on any parent DTO, and no geofence/rule event
is ever pushed on the parent realtime channel. Unlike safety-events/
emergencies (§5.10), there is no create-only grant for DRIVER/
BUS_ATTENDANT here at all — both roles hold neither `.read` nor `.manage`
for either domain (§2.3); a driver/attendant only ever sees the resulting
system-generated `SafetyEvent` through their existing own-trip scope, and
has no path to view or configure the rule/geofence that produced it.

Every geofence/rule lookup by id is tenant-scoped via
`runInTenantContext`, so a cross-tenant id is `404`, never `403`.
`SafetyRulesService.assertOwnership()` re-verifies any supplied
`geofenceId`/`routeId`/`busId` against the caller's own tenant before a
rule can be created or updated referencing it — a School A admin cannot
create a rule watching a School B geofence/route/bus by supplying its id;
the response is `404` (existence not revealed), the same pattern as
camera/bus reassignment checks (§5.9). `schoolId`/`createdBy`/`updatedBy`
are never accepted from the client on any route.

GPS-derived rule *evaluation* itself requires no additional authorization
check of its own — it runs inside the existing device-credential-
authenticated `GpsService.ingest()` path (§5.6), never a client-facing
endpoint, and only ever reads/writes rule state for the bus the ingesting
device already belongs to. A rule-evaluation failure (a malformed
configuration, a Redis outage) is caught and logged inside
`OperationalSafetyService.evaluate()`'s own per-rule `try`/`catch` and
never propagates to fail the GPS ingestion request — see
[ADR 0020](adr/0020-geofencing-and-operational-safety-rules.md) Decision
4. See §6 for the specific IDOR/RBAC/GPS-integration test scenarios.

## 6. Testing Requirements

Mandatory automated coverage before a module is considered done (ties to
[Definition of Done] in the top-level brief):

- Unit tests per policy function (allow/deny matrix).
- Integration tests hitting a real (test) Postgres with RLS enabled.
- E2E/API tests specifically for:
  - Cross-tenant access → 404, for every tenant-scoped resource type.
  - Parent can read own child, cannot read sibling-of-a-different-parent, cannot
    read camera/AI/incident routes — no such route exists in the parent
    namespace at all, and a parent JWT presented to the staff-audience
    camera routes is rejected by `AudienceGuard` (403), same as every other
    staff-only controller (verified for cameras in Phase 2 Step 11 —
    `apps/api/test/cameras.e2e-spec.ts`).
  - Driver can only start/end their own assigned trip.
  - Attendant can only mark attendance on their own assigned trip.
  - `SECURITY` role cannot read student academic/contact fields not relevant to
    safety review (field-level assertion on the DTO, not just status-code).
  - AI event review never auto-creates a `CONFIRMED_INCIDENT` without a human actor
    (Phase 3 — but the invariant is recorded here now since it's foundational).

**Covered as of Phase 2 Step 13** (`apps/api/src/geofencing/geo.util.spec.ts`,
11 unit tests, plus `apps/api/test/geofencing.e2e-spec.ts`, 21 e2e tests):
unit coverage for the Haversine/point-to-segment/point-to-polyline distance
math (including a real-world two-coordinate sanity check and relative-error
tolerance around the local-projection approximation's known, documented
precision limits — see [ADR 0020](adr/0020-geofencing-and-operational-safety-rules.md)
Decision 1). E2E coverage: Geofence CRUD/lifecycle (create, bounds
validation, update, `TRANSPORT_MANAGER` read-only, `DRIVER`/parent denied,
archive cascades to disable any rule watching it); SafetyRule CRUD/
validation (type-specific required-field rejection, cross-tenant `busId`
rejected on create, enable/disable as the only way to toggle `enabled`,
`DRIVER`/parent denied); cross-tenant IDOR (404 for cross-school geofence/
rule read and update); real GPS integration via simulated device telemetry
(GEOFENCE entry/exit with debounce + cooldown + Redis-state-loss recovery,
SPEED rule triggering a notification, GPS points below the configured
accuracy threshold skipped, a duplicate GPS point never re-evaluated);
`/realtime/safety` receiving a system-generated event from a confirmed
violation; and a direct-`psql`-as-`app_user` RLS re-verification for both
`geofences` and `safety_rules` (no context → zero rows, School A/B mutual
exclusion).

**Covered as of Phase 2 Step 12** (`apps/api/test/safety.e2e-spec.ts`, 35
tests): full SafetyEvent CRUD/lifecycle (create with full staff scope,
driver/attendant auto-scoped-to-own-trip creation, 400 with no active trip
and nothing supplied, 403 for a foreign bus/trip, acknowledge/dismiss/
resolve with their exact allowed-from-status sets, rejecting a repeat
transition); escalation (creates a linked `ACTIVE` emergency, the source
event becomes terminal `ESCALATED`, direct acknowledge/resolve on the
escalated event both rejected, and — the one system-driven transition —
resolving the resulting emergency flips the source event to `RESOLVED`
automatically, verified via a fresh `GET`); Emergency trigger/lifecycle
(default `CRITICAL` severity, driver auto-scope and 400/403 mirrors of the
above, staff triggering with no bus/trip at all, full ACTIVE→ACKNOWLEDGED→
action-added→RESOLVED with history preserved afterward, `CANCELLED` as a
distinct terminal state, rejecting any transition out of a terminal state);
RBAC (`DRIVER`/`BUS_ATTENDANT` denied every management action despite
holding `.create`, parent denied every route on both controllers);
cross-tenant IDOR (404 for cross-school read/acknowledge/escalate on
safety events, cross-school bus reference on creation, cross-school
read/acknowledge on emergencies); audit (`SAFETY_EVENT_CREATED`/
`_ESCALATED`, `EMERGENCY_CREATED`/`_RESOLVED`); notification integration
(a `CRITICAL` safety event notifies staff, a `LOW` one does not; triggering
an emergency notifies staff); a direct-`psql`-as-`app_user` RLS
re-verification for both tables; and `/realtime/safety` Socket.IO
authorization with a real `socket.io-client` (authorized staff receives
both event types live, a parent/no-token/`DRIVER` connection is rejected,
a School B socket never receives School A's events).

**Covered as of Phase 2 Step 11** (`apps/api/test/cameras.e2e-spec.ts` — no
separate unit specs were added for the camera module itself; the
guard/service logic is thin enough that e2e coverage was judged
sufficient, the same call already made for GPS's device-auth guard in
Phase 1 Step 7): full CRUD/lifecycle
(create, duplicate `cameraCode`/serial-number rejection as 400 not 500,
update, `CUSTOM` position requiring a label, reassignment to a different
bus, archive-is-terminal, `PATCH status: 'RETIRED'` rejected); RBAC
(`SCHOOL_ADMIN`/`TRANSPORT_ADMIN` allowed, `DRIVER`/`BUS_ATTENDANT` denied
despite holding `gps.read`, parent denied at every route including
`/stream`); cross-tenant IDOR (404 for cross-school read/update/archive/
credential/stream, cross-school bus association, cross-school camera list);
device authentication (no heartbeat without an issued credential, valid
credential accepted, invalid/garbage credential rejected, a GPS tracker's
own credential specifically rejected for a camera heartbeat, rotation
invalidates the old credential immediately, an archived camera's credential
stops working and cannot be reissued, the stored hash is a SHA-256 digest
never the raw token); stream availability always `NOT_CONFIGURED` and never
a real URL/token/credential; audit rows for create/reassign/archive but
never one per heartbeat (five heartbeats sent, verified not five audit
rows); and a direct-`psql`-as-`app_user` RLS re-verification (no tenant
context → zero rows, School A/B mutual exclusion).

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
  independently; cannot authenticate as a user. Applies identically to camera
  controller credentials (Phase 2 Step 11) — a compromised camera credential
  can only send heartbeats (`lastSeenAt`/`firmwareVersion`/a small bounded
  health blob), never read or write anything else, and never grants stream
  access (no real stream provider exists this phase to compromise).
- Insider over-access (staff browsing beyond their remit) → permission matrix +
  audit logging of all read access to `students`, `ai_events`, `incidents`, and
  `files` of type `INCIDENT_CLIP`.
- A frontend claiming a camera stream is "live" when none exists → structurally
  prevented, not just a UI convention: `CameraStreamAvailabilityDto.status` has
  no value meaning "a real, live feed is available" (only `NOT_CONFIGURED` and
  the explicitly-dev/test-only `SIMULATED`) — there is no real stream provider
  in this phase for a compromised or buggy frontend to misrepresent.
- A false "emergency service was contacted" record (Phase 2 Step 12) →
  `EmergencyAction.actionType = 'CONTACTED_EMERGENCY_SERVICE'` can only ever
  mean an operator logged having made contact themselves; there is no
  external emergency-service integration anywhere in this codebase for a
  compromised or buggy client to falsely claim was invoked automatically.
- A driver/attendant abusing the emergency-button/safety-event endpoints to
  affect another bus/trip or browse the school-wide dashboard → structurally
  prevented, not just a permission check: neither role is ever granted
  `safety_events.read`/`.manage` or `emergency.read`/`.manage`, and their
  `.create` grant is scoped inside the service to their own currently
  in-progress trip only (§5.10) — there is no code path, correct or buggy,
  by which holding `.create` alone could reach another bus's data.
- A flood of GPS-derived alerts (alert storm) from noisy/oscillating GPS
  fixes (Phase 2 Step 13) → mitigated structurally, not by rate limiting:
  per-rule `minConsecutivePoints` debouncing, a shared per-(rule,bus)
  cooldown clock regardless of transition direction, and an accuracy
  filter (`SAFETY_RULES_MAX_ACCURACY_M`) that skips imprecise fixes for
  rule math entirely — see
  [ADR 0020](adr/0020-geofencing-and-operational-safety-rules.md)
  Decisions 3 and 9. Verified directly in the e2e suite (a burst of
  oscillating-boundary GPS points produces at most one alert per cooldown
  window, never one per point).
- A malformed or misconfigured safety rule breaking live GPS tracking
  (Phase 2 Step 13) → structurally prevented: `OperationalSafetyService`'s
  per-rule evaluation is wrapped in its own `try`/`catch` inside
  `GpsService.ingest()`'s own `try`/`catch`, so one bad rule can neither
  block other rules nor fail the ingestion request itself — see
  [ADR 0020](adr/0020-geofencing-and-operational-safety-rules.md)
  Decision 4.

## 8. Rate Limiting

Reviewed and consolidated in Phase 1 Step 10 (previously scattered across
per-phase comments only, with a dangling cross-reference to this section
from `auth.controller.ts` before it existed). Two layers:

1. **A conservative global default** — `ThrottlerModule.forRoot([{ name:
   'default', ttl: 60_000, limit: 100 }])` (`app.module.ts`), keyed by IP,
   applied to every route via the global `ThrottlerGuard`. In-memory
   storage (single API instance; not Redis-backed) — sufficient at this
   phase's scale, matching the "no premature horizontal-scaling
   infrastructure" posture already documented for the realtime gateways
   (ADR 0014).
2. **Tighter per-route overrides** for endpoints that are meaningfully
   abusable, applied via `@Throttle(...)`:
   - Staff/parent login, password-reset request/confirm: `5/min`
     (`SENSITIVE_AUTH_THROTTLE`, `auth.controller.ts`) — credential-guessing
     and reset-spam resistance. Invitation acceptance
     (`invitations.controller.ts`) uses the same `5/min` value, defined
     locally rather than importing the auth module's constant.
   - Refresh-token redemption: `20/min` (`REFRESH_THROTTLE`) — looser than
     login since a legitimate client refreshes routinely (roughly once per
     access-token lifetime), but still bounded.
   - GPS ingestion (`POST /telemetry/gps`): configurable via
     `GPS_INGEST_RATE_LIMIT_PER_MINUTE` (default 120/min), read directly
     from `process.env` at module-load time since `@Throttle`'s metadata
     is resolved before Nest's DI container exists (same constraint as
     `@WebSocketGateway`'s CORS option — see ADR 0014). Keyed by IP, not
     device identity — a real limitation if multiple devices share one
     NAT/IP, accepted for this phase and noted for revisit with real
     fleet traffic data.
   - Camera heartbeat (`POST /camera-devices/heartbeat`, Phase 2 Step 11):
     configurable via `CAMERA_HEARTBEAT_RATE_LIMIT_PER_MINUTE` (default
     20/min) — much lower than GPS's, since a realistic camera-controller
     heartbeat cadence is on the order of a minute, not a few seconds.
     Same IP-keyed limitation as GPS ingestion above.

Device credential rotation, notification read/mark-read, and other
staff-authenticated management actions rely on the global default only —
they already require a valid session and (for credential rotation)
`buses.manage`, so the abuse surface is materially smaller than an
unauthenticated endpoint; a dedicated tighter limit was not judged
necessary and would be over-engineering without an observed need.
