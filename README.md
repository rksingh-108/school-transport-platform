# School Transportation Management & Child Safety Platform

A multi-tenant SaaS platform for Indian K-12 schools to manage bus transportation:
fleet, drivers/attendants, routes, live GPS tracking, student boarding, parent
notifications, and (later phases) camera-assisted safety monitoring and incident
management.

This is a production-oriented commercial platform, not a demo. See
[docs/product-requirements.md](docs/product-requirements.md) for the full product
scope and non-negotiable safety/privacy principles.

## Status

**Phase 0 (foundation) complete.** The monorepo, database schema + Row-Level
Security, NestJS API skeleton, and Next.js web skeleton are scaffolded and
verified working end-to-end (see [docs/roadmap.md](docs/roadmap.md)). No product
features exist yet — that's Phase 1.

## Architecture Overview

A modular-monolith NestJS API (`apps/api`) backed by PostgreSQL (Prisma) with
Row-Level Security for tenant isolation, a Next.js web app (`apps/web`), Redis,
and S3-compatible object storage (MinIO locally). See
[docs/architecture.md](docs/architecture.md) for the full design and the
reasoning behind it in [docs/adr/](docs/adr/).

## Repository Structure

```
apps/
  api/            NestJS modular monolith (see docs/architecture.md)
  web/            Next.js app (school console + parent app, built out from Phase 1)
packages/
  shared-types/   Hand-written domain types shared by api + web
  shared-schemas/ Zod validation schemas shared by api + web
  config/         Shared TypeScript/ESLint/Prettier presets
  ui/             Shared design-system components (empty until Phase 1 needs them)
prisma/           Database schema, migrations, seed script (see docs/database.md)
infra/            Docker Compose stack + Postgres init scripts
docs/             Architecture, database, API, security, privacy, AI-safety docs + ADRs
.github/workflows/ CI (install, lint, typecheck, build, migrate, test)
```

## Documentation

| Doc | Covers |
|---|---|
| [docs/product-requirements.md](docs/product-requirements.md) | What the product does, roles, parent-experience contract |
| [docs/architecture.md](docs/architecture.md) | Modular monolith design, repo structure, module boundaries |
| [docs/database.md](docs/database.md) | PostgreSQL schema, RLS, migrations, Prisma implementation notes |
| [docs/api.md](docs/api.md) | REST/WebSocket API contract, conventions |
| [docs/security.md](docs/security.md) | AuthN/AuthZ, RBAC matrix, tenant isolation |
| [docs/privacy.md](docs/privacy.md) | Child data handling, retention, compliance checklist |
| [docs/ai-safety.md](docs/ai-safety.md) | AI event taxonomy, human-in-the-loop review, edge architecture |
| [docs/roadmap.md](docs/roadmap.md) | Phase 1 (MVP) → Phase 4 sequencing |
| [docs/adr/](docs/adr/) | Architecture Decision Records |

## Tech Stack

Next.js 16 / React 19 / TypeScript / Tailwind CSS 4 (web) · NestJS 11 / TypeScript
(API) · PostgreSQL 16 + Prisma 5 · Redis 7 · MinIO (S3-compatible object storage) ·
pnpm workspaces + Turborepo · Docker Compose. See
[docs/architecture.md](docs/architecture.md) and [docs/adr/](docs/adr/) — several
version pins (Prisma, NestJS) are deliberate, documented decisions ([ADR
0008](docs/adr/0008-prisma-version-pin.md), [ADR
0009](docs/adr/0009-nestjs-version-pin.md)), not defaults.

## Prerequisites

- Node.js 20+ (developed against 24)
- pnpm 9+ (developed against 11.18.0 — `corepack enable` or `npm i -g pnpm`)
- Docker Desktop (or a compatible Docker + Compose v2 engine)

## Local Setup

```bash
git clone <repo-url>
cd school-transport-platform
pnpm install
cp .env.example .env
```

Open `.env` and adjust ports if any of `5434` (Postgres), `6379` (Redis), `9000`/
`9001` (MinIO) are already in use on your machine — see the comments in
`.env.example`. **Never commit `.env`** (it's git-ignored).

## Start Infrastructure

```bash
pnpm docker:up      # Postgres, Redis, MinIO (persistent named volumes)
```

Check everything is healthy: `docker compose -f infra/docker-compose.yml ps` — all
three services should show `(healthy)`. `pnpm docker:down` stops them;
`pnpm docker:logs` tails their logs.

## Database: Migrate and Seed

```bash
pnpm db:migrate       # applies prisma/migrations (schema + Row-Level Security)
pnpm db:seed          # safe, obviously-fake dev data — see prisma/seed.ts
```

`db:migrate` runs against the privileged `DATABASE_URL`; the running API instead
connects with the restricted, RLS-subject `API_DATABASE_URL` (the `app_user` role,
created automatically by `infra/docker/postgres/init/01-create-app-role.sh` the
first time the Postgres container initializes its volume). See
[docs/database.md](docs/database.md#5-row-level-security) for why there are two
connection strings.

The seed script prints a dev login password for every account it creates
(`Passw0rd!123` at the time of writing — never used for anything but local dev).

Other database commands: `pnpm db:studio` (Prisma Studio), `pnpm db:generate`
(regenerate the Prisma client after a schema change).

## Development

```bash
pnpm dev                                          # everything, via Turborepo
pnpm --filter @school-transport/api run dev       # just the API (NestJS, watch mode)
pnpm --filter @school-transport/web run dev       # just the web app (Next.js)
```

API: http://localhost:3001 (health: `/health`, readiness: `/health/ready`,
versioned API surface: `/api/v1/...` once Phase 1 endpoints exist).
Web: http://localhost:3000.

## Testing

```bash
pnpm test                                              # unit tests, all packages
pnpm --filter @school-transport/api run test:e2e       # e2e + tenant-isolation
                                                        # integration tests
                                                        # (needs the Docker stack
                                                        # running and migrated)
```

See [docs/security.md#6-testing-requirements](docs/security.md#6-testing-requirements)
for what's tested and why — in particular,
`apps/api/test/tenant-isolation.e2e-spec.ts` exercises the real PostgreSQL
Row-Level Security policies against a live database, not a mock.

## Other Commands

```bash
pnpm build       # build all packages/apps
pnpm lint        # ESLint, all packages
pnpm typecheck   # tsc --noEmit, all packages
pnpm format      # Prettier, whole repo
```

## CI

`.github/workflows/ci.yml` runs install → lint → typecheck → build → migrate →
unit tests → e2e/integration tests (against real Postgres/Redis/MinIO service
containers) → dependency audit, on every push/PR. No deployment step yet — see
[docs/roadmap.md](docs/roadmap.md).
