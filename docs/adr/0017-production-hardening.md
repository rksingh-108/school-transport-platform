# ADR 0017: Phase 1 Step 10 Production Hardening — Audit Findings and Fixes

Status: Accepted
Date: 2026-08-30

## Context

Phase 1 Step 10 is a systematic audit of everything built in Phase 0 and
Steps 1–9 against `docs/{architecture,security,privacy,database,api,roadmap}.md`,
every ADR, the Prisma schema, and the CI/Docker configuration — looking for
real bugs, security gaps, and missing operational controls, not a rewrite
or a new feature. This ADR records what was actually found and fixed
(genuine gaps only) and, separately, what was reviewed and confirmed
already sound (so the audit trail is honest about what changed vs. what
was already correct).

## Genuine Gaps Found and Fixed

### 1. No production-specific configuration validation

`validateEnv` (`apps/api/src/config/env.schema.ts`) validated shape and
presence uniformly across environments, but nothing stopped
`NODE_ENV=production` from booting with development secrets/credentials
copied forward unchanged — a `JWT_STAFF_SECRET` of
`dev_only_staff_secret_change_me_to_something_random_and_long` passes the
"≥32 characters" length check just as well as a real secret. Fixed: when
`NODE_ENV=production`, `validateEnv` now additionally rejects a narrow,
exact-match set of known dev/CI-only values — the well-known JWT secret
placeholders, identical staff/parent secrets, the MinIO default
credentials (`minioadmin`), and a wildcard `CORS_ORIGIN`. Deliberately an
exact-match blocklist, not a broad heuristic (e.g., "contains localhost")
— a false positive here would block a legitimate production deploy, which
is worse than the narrow gap a heuristic might additionally catch. See
[`env.schema.spec.ts`](../../apps/api/src/config/env.schema.spec.ts) for
the regression tests.

### 2. `CORS_ORIGIN` silently defaulted to `localhost` if unset

The schema's `.default('http://localhost:3000')` meant a deploy that
forgot to set `CORS_ORIGIN` at all would boot "successfully" in production
with a CORS policy that only works for local development — a
misconfiguration the new production-only wildcard check (item 1) would not
catch, since `localhost` isn't a wildcard. Fixed: `CORS_ORIGIN` has no
schema default and is now required in every environment, the same as
`API_DATABASE_URL`/`REDIS_URL` already were. CI's workflow env block
(previously relying on the removed default) now sets it explicitly.

### 3. Structured-log redaction was silently ineffective for object messages

`PinoLoggerService`'s `redact` config (`password`, `token`, etc.) only
inspects the structured fields of a pino log *record* — but the service's
`log`/`warn`/`error`/`debug` methods pre-serialized any non-string message
into a single JSON *string* via `JSON.stringify()` before ever handing it
to pino, so a hypothetical future call site that logs an object containing
a sensitive field (`logger.log({ password: '...' })`) would have that
field embedded as plain text inside the `msg` string, which pino's
`redact` never inspects. No current call site actually does this (every
existing `logger.*()` call already passes a string), so this was a latent
gap, not an active leak — but the comment directly above the `redact`
config claimed a guarantee ("Never log secrets: the redact list below
covers...") that the implementation didn't actually deliver for that case.
Fixed: a non-string message is now spread into the log record's own
top-level fields instead of being pre-stringified, so the existing
`redact` paths can actually match and censor it if a future call site ever
does this.

### 4. No graceful-shutdown hook

`main.ts` never called `app.enableShutdownHooks()`, so `PrismaService`/
`RedisService`'s `onModuleDestroy` (which close their connections) would
never run on `SIGTERM`/`SIGINT` — a container orchestrator's graceful
shutdown window would do nothing useful, and the process would rely on a
hard kill. Fixed with the one-line Nest API for this.

### 5. The dev-only GPS simulator's production lockout had no regression test

`GpsService.simulateIngest` already refused unconditionally when
`NODE_ENV=production` (built in Phase 1 Step 7) — this was real,
previously-verified-by-manual-inspection behavior, but had zero automated
test coverage across the whole test suite, despite being asserted as a
safety property in `docs/roadmap.md` and ADR 0014. Fixed by adding a
focused unit test (`gps.service.spec.ts`) that constructs the service with
bare stub dependencies (the guard clause returns before touching any of
them) and asserts the lockout fires in production and does not
short-circuit in development.

### 6. `docs/security.md` had a dangling cross-reference and no Rate Limiting section

`auth.controller.ts` had referenced `docs/security.md#13-rate-limiting`
since Phase 1 Step 1 — a section that was never actually written (the
document consolidated into 7 top-level sections as it evolved, and this
one leftover reference was never updated to match). Fixed by adding a real
`## 8. Rate Limiting` section consolidating the actual implemented policy
(global default, per-route overrides for login/refresh/reset/invitation/
GPS-ingestion) and correcting the cross-reference.

### 7. No deployment/production-readiness documentation existed at all

Nothing in the repository documented required environment variables (as a
checklist), secrets handling, migration procedure, backup/recovery
expectations, TLS/reverse-proxy responsibility, or a pre-launch checklist
— all explicitly requested by this phase and genuinely absent. Added
[`docs/deployment.md`](../deployment.md), which is careful to state
plainly what is *not* built (no backup automation, no TLS termination, no
production Dockerfile, no monitoring stack) rather than implying
infrastructure exists where only documentation now does.

### 8. Undocumented (but correct) cascade-delete interaction

`TripStudent.trip` cascades on delete, which reads as risky in isolation
(could a hard-deleted Trip silently destroy attendance history?) — but
`AttendanceEvent.tripStudentId` has no `onDelete` clause (Prisma/Postgres
default: restrict), so any `TripStudent` with real attendance history
already blocks this cascade from completing at the database level. No
behavior changed; a comment was added at the point of the cascade
explaining why it's safe, since this interaction is subtle enough that a
future reader could otherwise "fix" it into something worse.

## Reviewed and Confirmed Already Sound (no change)

Documented briefly so this audit's absence-of-a-fix isn't mistaken for an
absence of review:

- **Authentication**: refresh-token rotation + reuse detection (an
  already-revoked token's *entire session family* is revoked on replay),
  suspended-account and suspended/inactive-school checks on both login and
  refresh, password-change/reset revoking all existing sessions, generic
  error messages against account enumeration — all already correctly
  implemented (`AuthService`).
- **Cross-tenant read authorization for platform-level operations**:
  `SchoolsService.getOtherSchoolAsPlatformAdmin` explicitly checks
  `platform.schools.read` before using the `runAsPlatformAdmin` bypass,
  returns 404 (not 403) on failure, and audits every successful
  cross-tenant read — exactly the pattern this audit would have asked for
  if it were missing.
- **IDOR coverage**: dedicated cross-tenant test blocks already exist per
  domain (schools, staff, students, parents, parent-student links, routes,
  route-stops, buses, drivers, attendants, bus-devices, trips, trip-stops,
  attendance events, GPS/telemetry, parent transport, notifications) —
  spanning `core-domain`, `routes`, `transport`, `trips`, `attendance`,
  `gps`, `parent-transport`, and `notifications` e2e specs, plus a
  dedicated `tenant-isolation.e2e-spec.ts` for the underlying RLS
  mechanism itself.
- **Pagination**: every list endpoint already has a bounded `limit`
  (max 100, or 500 for GPS history with its own documented justification)
  — no unbounded query exists on any list endpoint.
- **Health checks**: `/health` (liveness, no I/O) vs `/health/ready`
  (readiness — DB/Redis/storage) are already correctly split, and the
  readiness response never returns more than a generic per-dependency
  up/down plus (for a down dependency) its own error message — no
  connection string or credential is ever included.
- **CORS/Helmet/error handling**: `helmet()` and env-driven, non-wildcard,
  credentialed CORS were already correctly configured;
  `AllExceptionsFilter` already logs stack traces server-side only and
  returns a generic message + request ID for any 5xx, never leaking
  internals to the client.
- **CI**: already runs install → lint → typecheck → build → migrate deploy
  → unit tests → e2e tests → a non-blocking dependency audit (deliberately
  non-blocking, with the reasoning documented inline) — no changes judged
  necessary.
- **Docker Compose**: already env-var-driven throughout with no
  hardcoded secrets, and explicitly sets the MinIO bucket private
  (`mc anonymous set none`) — already honest about being a local dev
  convenience, not a production platform.

## Consequences

- No schema migration was needed for this phase — every fix is
  application code, configuration, or documentation.
- No existing behavior changed for development or CI (`NODE_ENV=test`/
  `development` are never subject to the new production-only checks); the
  only environment-visible change is that `CORS_ORIGIN` must now be set
  explicitly everywhere, which every existing environment (`.env`,
  `.env.example`, CI) already did in practice.
- Explicitly out of scope, and not attempted: a production Dockerfile,
  automated backups, a monitoring/alerting stack, or a full architecture
  audit for scale unrelated to any concrete finding — all would be
  speculative infrastructure this phase's instructions warn against
  building without a genuine, current requirement.
