# ADR 0010: Credential Resolution Uses the Platform-Admin RLS Bypass, Narrowly

Status: Accepted
Date: 2026-08-30
Trigger: encountered while implementing Phase 1 Step 1 (authentication) — a gap
in the Phase 0 RLS design that only becomes visible once a real login flow is
built.

## Context

[database.md](../database.md#5-row-level-security) requires `app.current_school_id`
to be set before any tenant-scoped table is readable. But login is, by
definition, the moment the system does **not yet know** which tenant a caller
belongs to — a staff member authenticates with an email and password, not an
email *and a school*. The same is true for:

- Parent login (phone + password, no school given).
- Refresh-token redemption (the caller presents an opaque token; the system
  must look it up to discover which tenant issued it).
- Password-reset request/confirm (same shape as refresh redemption).

`users.email` and `parents.phone` are unique per `(schoolId, email|phone)`, not
globally — so even the identifier alone doesn't imply a tenant. Under the
Phase 0 RLS policies exactly as written, an `app_user`-scoped query for
`WHERE email = $1` with no `app.current_school_id` set would correctly return
zero rows regardless of whether a match exists elsewhere — login would never
work at all.

## Decision

These specific lookups — by a login identifier, or by a token's hash — are
narrow, single-purpose, audited exceptions that run through
`PrismaService.runAsPlatformAdmin()`, the same escape hatch
[ADR 0002](0002-multi-tenancy-strategy.md) already reserved for genuine
SUPER_ADMIN platform operations. Concretely, in `apps/api/src/auth`:

- Staff/parent login looks up the identifier (email/phone) across all tenants.
  If more than one account shares the identifier across schools (a same-email
  reused at a different school — the schema permits this since the uniqueness
  constraint is per-school), the login fails closed with the same generic
  "invalid credentials" response used for a genuine no-match, rather than
  guessing which account was intended. This is a known, documented limitation
  (see [security.md](../security.md)) — resolving it properly means asking the
  user which school they mean, which is out of scope for this phase.
- Refresh-token and password-reset-token lookups are always by the token's
  unique hash (`WHERE token_hash = $1`), never a broader scan.

Once any of these lookups succeeds, every subsequent operation in the same
request — reading the full user/parent row, writing new tokens, updating
`lastLoginAt`, writing audit log entries — switches to the normal
`runInTenantContext(schoolId, ...)` path using the schoolId the lookup just
established. The platform-admin bypass is used for the minimum possible
surface: resolving *which* tenant a credential belongs to, nothing else.

## Consequences

- RLS is not weakened for any *authenticated* request — only the credential-
  resolution step itself, which is inherently pre-tenant by definition, uses
  the bypass. `refresh_tokens` and `password_reset_tokens` still carry the
  standard tenant-isolation RLS policy (see the migration in
  `prisma/migrations/20260829204445_add_authentication/`), which protects
  every access path other than this one narrow lookup.
- Every use of `runAsPlatformAdmin` in the auth module is commented at the
  call site explaining why it's necessary there, so it doesn't read as an
  unexplained RLS bypass to a future reviewer.
- The same-email-different-school ambiguity is accepted as a known limitation
  for this phase rather than solved with a school-selector UI, which is a
  product decision, not just an engineering one — flagged in
  [security.md](../security.md) for product/legal follow-up alongside the
  other ⚠️-marked items in [privacy.md](../privacy.md).

## Implementation correction (found via e2e testing, same phase)

The first implementation of this decision added the `is_platform_admin`
OR-clause only to `schools` and `audit_logs` — `users`, `parents`,
`refresh_tokens`, and `password_reset_tokens` (the tables `runAsPlatformAdmin`
actually queries for credential resolution) were left with only the plain
`current_school_id` check. Since `FORCE ROW LEVEL SECURITY` means a policy
applies regardless of which session variables happen to be set, and
`is_platform_admin` has no effect on a policy that never references it, every
`runAsPlatformAdmin` query against those four tables silently returned zero
rows — every login, refresh, and password-reset attempt failed with a generic
"invalid credentials"/"invalid token" response, indistinguishable at the API
layer from genuinely wrong input. This was caught by the auth e2e suite (not
by manual testing, which would have seen the same generic error either way and
could easily have been misread as "credentials are wrong somewhere in the test
fixture" rather than a policy bug) and fixed by adding the same OR-clause to
`users` and `parents` (via a later migration altering the policy the initial
migration created) and to `refresh_tokens`/`password_reset_tokens` (corrected
before that migration was ever applied elsewhere). See
[database.md](../database.md#5-row-level-security) for the corrected policy
shape and the resulting rule: **every table a call site passes to
`runAsPlatformAdmin` must carry this clause, and no other table should.**

## Extension (Phase 1 Step 7): `bus_devices`

GPS device authentication (`GpsService.resolveDeviceByCredential`) is the
same shape as login: a device presents an opaque bearer credential, and the
system must find out which device — and therefore which school — it
belongs to *before* any tenant context exists. This is looked up via
`runAsPlatformAdmin` against `bus_devices.credential_hash`, exactly like a
refresh/reset token lookup. `bus_devices` was created in Phase 1 Step 3 with
only the plain tenant-scoped policy (no pre-tenant lookup existed against it
until now), so the rule above applied again: the first implementation hit
the identical zero-rows-always bug this ADR already describes, caught
immediately by the GPS e2e suite (every ingestion test failed 401), and
fixed the same way — adding the `OR is_platform_admin` clause to
`bus_devices`' policy (in
`prisma/migrations/20260830110000_gps_telemetry_and_device_credentials/`).
See [ADR 0014](0014-gps-telemetry-and-realtime-tracking.md).
