# Deployment & Production Readiness Checklist

Status: Draft v1 — written during the Phase 1 Step 10 hardening pass.
**This document describes requirements and operational practice, not
infrastructure that already exists.** No CI/CD pipeline, cloud environment,
backup automation, or reverse proxy has been provisioned by this codebase —
`infra/docker-compose.yml` is a **local development convenience**
(Postgres/Redis/MinIO only, no API/web containers, no TLS), not a
production orchestration platform. Anything below marked "not yet built"
is exactly that.

## 1. Required Environment Variables

See `.env.example` for the full, current list with inline explanations.
As of Phase 1 Step 10, `validateEnv` (`apps/api/src/config/env.schema.ts`)
**fails the API process at boot** if `NODE_ENV=production` and any of the
following hold — this is enforced code, not just documentation:

- `CORS_ORIGIN` is `"*"`.
- `JWT_STAFF_SECRET` or `JWT_PARENT_SECRET` is the well-known development
  placeholder value from `.env.example`/CI, or the two are identical.
- `STORAGE_ACCESS_KEY` or `STORAGE_SECRET_KEY` is the well-known MinIO
  default (`minioadmin`).

This is a narrow, exact-match check (not a broad heuristic) — it catches
the specific mistake of copying dev defaults forward, not every possible
misconfiguration. It does **not** validate `API_DATABASE_URL`/`REDIS_URL`
point at real infrastructure — that's a deploy-time operational
responsibility, not something the app can safely infer.

Every other required variable (`API_DATABASE_URL`, `REDIS_URL`,
`STORAGE_*`, `JWT_*_SECRET` length/presence) fails fast via the same
`validateEnv` in every environment, not just production.

## 2. Secrets

- Generate real values for `JWT_STAFF_SECRET`/`JWT_PARENT_SECRET` (distinct
  per audience — see docs/security.md §1) with, e.g.,
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.
- `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `REDIS_PASSWORD`,
  `MINIO_ROOT_PASSWORD`/`STORAGE_SECRET_KEY` must all be real, unique
  values — never the `.env.example` placeholders.
- No secret is ever logged — see docs/security.md's structured-logging
  redaction rules (`PinoLoggerService`) and §5.1's device-credential
  hashing discipline. Device/GPS credentials, refresh tokens, and password
  reset tokens are stored as SHA-256 hashes only, never plaintext.
- Secrets belong in your deployment platform's secret manager, never
  committed to the repository or baked into an image.

## 3. Database Migrations

- `pnpm exec prisma migrate deploy --schema=prisma/schema.prisma` applies
  all pending migrations non-interactively — this is what CI runs
  (`.github/workflows/ci.yml`) and what a production deploy should run,
  never `prisma migrate dev` (interactive, dev-only) or `migrate reset`
  (destructive).
- `prisma/seed.ts` is **development/demo data only** — obviously-fake
  schools, users, and a printed dev password (`Passw0rd!123`). **Never run
  it against a production database.** No seed step should exist in a
  production deploy pipeline at all (see §8, "seed disabled").
- Migrations are additive-only in this codebase's own history (no prior
  migration has ever been edited after being applied elsewhere) — see the
  file-by-file rationale in each `prisma/migrations/*/migration.sql` and
  the ADRs referencing schema evolution (e.g. ADR 0010's "Extension"
  sections).

## 4. Backups & Recovery — not yet built

**No automated backup exists in this codebase.** Setting it up is an
infrastructure decision for wherever this is deployed. Practical
requirements, not yet implemented:

- **PostgreSQL**: regular `pg_dump`/continuous WAL archiving (or your
  managed Postgres provider's built-in backup), with periodic **restore
  drills** — a backup that has never been restored is unverified. RLS
  policies and the `app_user` role (`infra/docker/postgres/init/`) must be
  part of any restore procedure, not just the data.
- **Redis**: this deployment uses Redis only for GPS current-location
  cache and Socket.IO room state (Steps 7–8) — all of it is derivable from
  PostgreSQL (`GpsService`'s cold-start fallback already re-populates the
  cache from the latest `GpsPoint` row) or is inherently ephemeral
  (WebSocket room membership). Redis persistence (AOF/RDB) is a
  nice-to-have for warm restarts, not a data-loss risk if lost.
- **MinIO/object storage**: no file-upload feature has shipped yet in any
  phase (`files` module is Phase 0-scaffolded, unimplemented) — there is
  currently nothing stored in object storage to back up. Revisit when a
  real file feature ships.
- **Rollback**: because migrations are additive, rolling the application
  back to a previous commit while the database has already run a newer
  migration is not automatically safe — coordinate application rollback
  with the corresponding migration state, or accept forward-fix-only for
  a bad deploy.

## 5. TLS / Reverse Proxy — not yet built

The API and web app both listen on plain HTTP locally. Production TLS
termination (a reverse proxy, load balancer, or platform-managed TLS) is
an infrastructure decision outside this repository. Whatever terminates
TLS must forward the real client IP (`X-Forwarded-For` or platform
equivalent) so `req.ip`-keyed rate limiting (docs/security.md §8) and
audit `ipAddress` fields reflect the actual client, not the proxy.

## 6. CORS / Allowed Origins

`CORS_ORIGIN` (single origin, `credentials: true`) must be set to the
real deployed web app's origin — never `*`, enforced at boot in production
(§1 above). Staff and parent web apps share one origin in this
architecture (one Next.js app, two route groups), so one value covers
both.

## 7. Redis & Object Storage

- `REDIS_URL` must include a real password in any non-local environment —
  `infra/docker-compose.yml`'s local Redis already requires one
  (`--requirepass`); production must too.
- `STORAGE_*` should point at a real S3-compatible provider (or a properly
  secured, non-default-credentialed MinIO deployment) with a **private**
  bucket — `infra/docker-compose.yml`'s `minio-init` service already sets
  `mc anonymous set none` on the dev bucket; replicate that policy in
  production regardless of provider.

## 8. Pre-Launch Checklist

- [ ] All secrets are real, unique, and stored in a secret manager — not
  the `.env.example` values (enforced for JWT/storage in production —
  §1 — but double-check the rest by hand).
- [ ] `prisma migrate deploy` run against the target database; migration
  count matches `prisma/migrations/`.
- [ ] **Seed script is not part of the production deploy pipeline** — no
  demo schools/users/passwords in production.
- [ ] `NODE_ENV=production` — this alone disables the GPS dev simulator
  (`GpsService.simulateIngest` refuses unconditionally, regardless of
  caller — see `apps/api/src/gps/gps.service.spec.ts` for the regression
  test) and activates the config-safety checks in §1.
- [ ] `CORS_ORIGIN` set to the real web app origin (not `*`, not
  `localhost`).
- [ ] TLS terminated in front of the API (§5), with the real client IP
  forwarded.
- [ ] Redis and object storage both have real, non-default credentials.
- [ ] `GET /health` and `GET /health/ready` both return healthy against
  the real infrastructure before routing traffic to a new instance.
- [ ] Structured logs (pino, JSON) are shipped to whatever log
  aggregation the deployment uses; redaction rules verified (no
  passwords/tokens/secrets appear in a sample of real logs).
- [ ] PUSH/SMS/EMAIL notification providers remain `NOT_CONFIGURED`
  (`NotConfiguredProvider`, docs/adr/0016) unless a real vendor has been
  deliberately wired up — do not represent notifications as "delivered"
  externally until that's actually true.
- [ ] A rollback plan exists for the specific migration(s) in this deploy
  (see §4).
- [ ] Backup/restore procedure exists and has been drilled at least once
  (§4) — not yet built in this codebase; this is an infrastructure
  prerequisite for a real launch, not something `pnpm` commands provide.

## 9. What This Checklist Deliberately Does Not Claim

- No compliance certification (DPDPA or otherwise) is claimed — see
  docs/privacy.md's ⚠️-marked legal-review items.
- No load testing or capacity planning has been performed — see
  docs/roadmap.md for what's explicitly deferred.
- No monitoring/alerting stack is provisioned — `/health`/`/health/ready`
  and structured JSON logs are the integration points a real monitoring
  setup would consume; none is wired up here.
