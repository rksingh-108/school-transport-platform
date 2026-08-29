# Architecture

Status: Draft v1
Last updated: 2026-08-30

## 1. Style: Modular Monolith

The core business application (auth, schools, students, buses, trips, attendance,
notifications, dashboards, RBAC) ships as a **single NestJS application** organized
into strictly bounded modules. We do not start with microservices — see
[adr/0001-modular-monolith.md](adr/0001-modular-monolith.md) for the reasoning.

Three things are deliberately kept **outside** the monolith's process boundary from
day one, because they have different scaling, language, and failure characteristics:

1. **AI inference** — separate Python service (Phase 3), invoked over a narrow HTTP/
   gRPC contract. See [adr/0006-ai-service-separation.md](adr/0006-ai-service-separation.md).
2. **Realtime/telemetry ingestion** — device-facing ingestion is a thin adapter in
   front of the monolith (HTTP for MVP, MQTT broker later) so device protocol churn
   never touches business logic. See [adr/0005-realtime-and-telemetry-ingestion.md](adr/0005-realtime-and-telemetry-ingestion.md).
3. **Object storage** — accessed only through a storage abstraction, never a direct
   SDK call from business modules, so the backing provider (local disk / MinIO / S3 /
   an Indian cloud provider) can change without touching module code.

This keeps the monolith simple to develop, test, deploy, and reason about while
leaving clean seams to extract services later *if and when scale actually requires
it* (per instruction — no speculative microservices).

```
                        ┌─────────────────────────────┐
   Parent / School Web  │                              │
   Driver / Attendant   │      Next.js Web App         │
   Mobile (PWA, MVP)    │      (apps/web)              │
                        └──────────────┬───────────────┘
                                       │ REST + WebSocket (JWT/cookie auth)
                        ┌──────────────▼───────────────┐
                        │        NestJS API              │
                        │        (apps/api)              │
                        │  modules: auth, schools, users,│
                        │  rbac, students, parents, buses│
                        │  routes, trips, attendance,    │
                        │  gps, notifications, reports,  │
                        │  audit, files, sysconfig        │
                        └───┬─────────────┬─────────────┘
                            │             │
                ┌───────────▼───┐   ┌─────▼──────┐
                │  PostgreSQL    │   │   Redis     │
                │  (system of    │   │ (cache,     │
                │   record)      │   │  pub/sub,   │
                │                │   │  WS scaling)│
                └────────────────┘   └─────────────┘

   Bus GPS Device ─┐
   Bus Camera/Edge ┼──▶  Ingestion Adapter (apps/ingestion, Phase 1 = HTTP,
                   │      Phase 2+ = MQTT broker) ──▶ NestJS telemetry module
   Edge AI Box ─────┘                                        │
                                                              ▼
                                              Python AI Service (apps/ai-service,
                                              Phase 3) — safety event inference,
                                              model registry, provider abstraction

   Object Storage: MinIO (dev) / S3-compatible (prod) — accessed via StorageProvider
   interface only, never directly from modules.
```

## 2. Repository Structure (proposed)

Monorepo, pnpm workspaces + Turborepo (build graph/caching). Rationale in
[adr/0003-orm-and-database-toolchain.md](adr/0003-orm-and-database-toolchain.md) and
general tooling notes below.

```
school-transport-platform/
├── apps/
│   ├── api/                     # NestJS modular monolith
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── schools/
│   │   │   │   ├── users/
│   │   │   │   ├── rbac/                # roles, permissions, policies
│   │   │   │   ├── students/
│   │   │   │   ├── parents/
│   │   │   │   ├── parent-students/
│   │   │   │   ├── buses/
│   │   │   │   ├── bus-devices/
│   │   │   │   ├── drivers/
│   │   │   │   ├── attendants/
│   │   │   │   ├── routes/
│   │   │   │   ├── stops/
│   │   │   │   ├── trips/
│   │   │   │   ├── attendance/
│   │   │   │   ├── gps/                 # telemetry ingestion + live state
│   │   │   │   ├── geofencing/          # phase 2
│   │   │   │   ├── speed-monitoring/    # phase 2
│   │   │   │   ├── cameras/             # phase 2
│   │   │   │   ├── ai-events/           # phase 3 (consumes ai-service)
│   │   │   │   ├── incidents/           # phase 2/3
│   │   │   │   ├── emergency/           # phase 2
│   │   │   │   ├── notifications/
│   │   │   │   ├── reports/
│   │   │   │   ├── audit-logs/
│   │   │   │   ├── files/               # storage abstraction consumer
│   │   │   │   ├── device-health/
│   │   │   │   └── system-config/
│   │   │   ├── common/                  # guards, interceptors, filters, decorators
│   │   │   ├── policies/                # centralized authorization policies
│   │   │   ├── config/
│   │   │   └── main.ts
│   │   └── test/                        # e2e (supertest) + integration
│   ├── web/                     # Next.js app (school console + parent app)
│   │   └── src/
│   │       ├── app/                     # route groups: (parent) (school) (auth)
│   │       ├── components/
│   │       ├── lib/
│   │       └── styles/
│   ├── ingestion/                # thin device-facing telemetry adapter (Phase 1: HTTP)
│   └── ai-service/               # Python FastAPI, interface-only stub in Phase 1
├── packages/
│   ├── shared-types/             # generated OpenAPI types + hand-written domain types
│   ├── shared-schemas/           # Zod schemas shared by web + api DTO validation
│   ├── config/                   # eslint, tsconfig, prettier presets
│   └── ui/                       # shared design-system components (web only)
├── prisma/                       # schema.prisma, migrations, seed.ts
├── infra/
│   ├── docker/                   # Dockerfiles per app
│   └── docker-compose.yml
├── docs/
│   ├── product-requirements.md
│   ├── architecture.md
│   ├── database.md
│   ├── api.md
│   ├── security.md
│   ├── privacy.md
│   ├── ai-safety.md
│   ├── roadmap.md
│   └── adr/
├── .github/workflows/            # CI
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

Each `apps/api/src/modules/<name>` follows the same internal shape:

```
<name>/
  <name>.controller.ts     # HTTP boundary only — no business logic
  <name>.service.ts        # business logic
  <name>.repository.ts     # data access (Prisma calls isolated here)
  dto/                     # request/response DTOs, Zod/class-validator schemas
  entities/                # domain types (not 1:1 with DB rows where they diverge)
  policies/                # module-specific authorization rules, composed with rbac
  <name>.module.ts
  tests/
    <name>.service.spec.ts
    <name>.controller.spec.ts
    <name>.e2e-spec.ts
```

Controllers never call the repository directly, and services never import
`PrismaClient` types across module boundaries — cross-module reads go through the
other module's service, not its repository. This is enforced by an ESLint boundaries
rule (`eslint-plugin-boundaries`), not just convention.

## 3. Cross-Cutting Concerns (applied uniformly, not per-module)

- **Tenant context**: a request-scoped `TenantContext` is derived once (from the
  authenticated user's `schoolId`, or explicit tenant header for `SUPER_ADMIN` tools)
  in a guard, and every repository method requires it as an explicit parameter — there
  is no "ambient" tenant-free query path. See [security.md](security.md#tenant-isolation).
- **AuthZ**: a single `PermissionsGuard` + `@RequirePermission()` decorator reads from
  the centralized policy layer. No controller hand-rolls `if (user.role === ...)`.
- **Validation**: Zod schemas in `packages/shared-schemas`, consumed by NestJS
  pipes on the backend and `react-hook-form` resolvers on the frontend — one schema,
  two consumers, no drift.
- **Error handling**: a global exception filter maps all errors to
  `{ code, message, requestId, details? }`; internal errors never leak stack traces.
- **Observability**: request-id middleware, structured JSON logs (pino), and a
  `/health`, `/health/ready`, `/health/live` set of endpoints from day one.
- **Realtime**: a single WebSocket gateway namespace per concern (`/ws/tracking`,
  `/ws/ops`) backed by the Redis adapter so it can scale horizontally later without
  a rewrite.

## 4. Module Boundaries — Ownership Table

| Module | Owns data | Never owns |
|---|---|---|
| `schools` | tenant record, subscription/plan metadata | any student/parent PII |
| `rbac` | roles, permissions, role_permissions | user profile data |
| `students` | student profile, school linkage | camera/AI data |
| `parents` | parent profile, auth identity link | student profile fields |
| `parent-students` | the relationship + verification status | either side's core profile |
| `buses` / `bus-devices` | vehicle + device inventory | live telemetry (owned by `gps`) |
| `routes` / `stops` | static route topology | trip execution state |
| `trips` / `trip-students` | a route's execution instance + per-student manifest | attendance event history (owned by `attendance`) |
| `attendance` | append-only boarding/drop-off events + derived current status | trip scheduling |
| `gps` | live + historical device telemetry | camera data |
| `cameras` | device inventory + health | recordings (owned by `files`) |
| `ai-events` | AI-generated candidate events | final incident record (owned by `incidents`) |
| `incidents` | human-adjudicated incident lifecycle | raw AI confidence internals |
| `notifications` | templates, preferences, delivery log | the business event that triggered it |
| `audit-logs` | immutable action log | nothing else — read/append only |
| `files` | signed-URL issuance, retention metadata | the business meaning of a file |

## 5. Frontend Composition

One Next.js app, route-grouped by audience, sharing the design system and auth
session but with **separate layouts and separately reviewed data-fetching paths**:

- `(school)` — control center, requires a staff role, permission-gated per page/widget.
- `(parent)` — deliberately minimal, only ever calls parent-safe endpoints
  (`/api/v1/parent/...`), never the staff endpoints, even if the logged-in user's
  token would technically be rejected by the backend anyway (defense in depth: the
  frontend for parents should not even *reference* staff endpoints).
- `(driver)` / `(attendant)` — mobile-first, minimal-chrome views for in-motion use.
- `(auth)` — login, MFA, password reset.

Driver/attendant/parent surfaces are built responsive-first in the Next.js app for
MVP (installable PWA); native mobile wrapping is a later, non-architectural decision.

## 6. Deployment Topology (target, not required for local dev)

- `web` and `api` as separate containers behind a reverse proxy/load balancer.
- `api` horizontally scalable (stateless; sessions in Redis, WS via Redis adapter).
- Postgres primary + read replica (later, if reporting load requires it).
- `ingestion` scaled independently from `api` since device traffic patterns differ
  from user traffic patterns.
- `ai-service` deployed and scaled independently (GPU-capable nodes) once Phase 3
  begins; can also run at the edge per bus (see [ai-safety.md](ai-safety.md)).

Local development uses Docker Compose for Postgres, Redis, MinIO, and (Phase 2+)
an MQTT broker — see [development.md](development.md) once written.
