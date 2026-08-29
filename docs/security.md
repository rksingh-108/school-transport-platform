# Security Model

Status: Draft v1

## 1. Authentication

- Passwords hashed with **argon2id** (memory-hard, OWASP-recommended over bcrypt for
  new systems), never reversible, never logged.
- Web sessions: short-lived JWT access token (15 min) + rotating refresh token
  stored in a `httpOnly`, `Secure`, `SameSite=Lax` cookie; refresh tokens are
  persisted (hashed) server-side so a single refresh token can be revoked
  individually (logout-everywhere, compromised-device revocation).
- Mobile/API clients: same access/refresh token pair, delivered in response body
  instead of a cookie (no browser CSRF surface to protect there), stored in secure
  device storage (Keychain/Keystore) by the client.
- MFA-ready: `users.mfa_enabled` + encrypted TOTP secret from day one; login flow
  has a `MFA_REQUIRED` intermediate state even before MFA enrollment is mandatory
  for any role, so turning it on later (e.g., mandatory for `SCHOOL_ADMIN`/
  `SUPER_ADMIN`) requires no auth-flow redesign.
- Parent auth is a **separate login endpoint and separate token audience** from
  staff auth (`/auth/parent/login` vs `/auth/login`) — a parent's token is never
  structurally valid against a staff-only endpoint's guard, independent of the
  permission check also failing. Two layers, not one.
- Device (GPS/camera) authentication is **not** user authentication: each device
  gets a provisioned credential (API key in MVP; mTLS client certificate once
  volume/security requirements justify it) scoped to exactly one `bus_device_id`,
  never a user session token.
- Rate limiting on all auth endpoints (`login`, `password/forgot`, `mfa/verify`) via
  Redis-backed throttling, keyed by IP + identifier.

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
platform.schools.read, platform.schools.create, platform.impersonate_school
```

### 2.2 Enforcement — centralized, not scattered

- A single `@RequirePermission('students.read')` decorator + `PermissionsGuard`
  runs on every controller method. There is no code path that checks
  `user.role === 'SCHOOL_ADMIN'` directly in a controller or service — that couples
  business logic to a specific role and breaks the moment a school wants a custom
  role composed differently.
- The guard resolves the current user's permissions (via their roles) **once per
  request**, cached in the request context, and additionally consults a
  **resource-scoping policy function** registered per module (e.g., "is this trip
  assigned to this driver?", "is this student linked+verified to this parent?").
  Permission = "can this role ever do this"; policy = "can this specific principal
  do this to this specific row." Both must pass.
- Policies live in `apps/api/src/policies/`, one file per module, unit-tested in
  isolation from HTTP.

### 2.3 Default Role → Permission Matrix (MVP scope; Phase 2/3 permissions granted
when those modules ship)

| Permission | SUPER_ADMIN | SCHOOL_ADMIN | TRANSPORT_ADMIN | TRANSPORT_MANAGER | PRINCIPAL | DRIVER | ATTENDANT | SECURITY | PARENT |
|---|---|---|---|---|---|---|---|---|---|
| students.read/write | platform only | ✓ | – | – | read | – | – | – | own child, read-only via parent endpoints |
| buses.manage | platform only | ✓ | ✓ | – | read | – | – | – | – |
| drivers/attendants.manage | – | ✓ | ✓ | – | read | – | – | – | – |
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
   never a raw `studentId` lookup.
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
