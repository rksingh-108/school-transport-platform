# ADR 0003: Prisma as ORM/Migration Toolchain; pnpm + Turborepo for the Monorepo

Status: Accepted
Date: 2026-08-30

## Context
NestJS is commonly paired with either TypeORM or Prisma. The team needs
schema-first migrations that are reviewable as plain SQL, strong TypeScript type
generation (matters a lot here given the number of entities and the "no `any`
without documented reason" rule), and straightforward RLS-session-variable support
via raw query escape hatches. Separately, the monorepo needs a package manager and
task runner.

## Decision
- **Prisma** for schema definition, migrations, and the primary query layer.
  Repository classes wrap Prisma calls so business services never import
  `PrismaClient` types directly (keeps the door open to swapping the query layer
  under a stable repository interface later without touching services).
- **pnpm workspaces + Turborepo** for the monorepo: pnpm for fast, disk-efficient,
  strict dependency resolution (avoids phantom-dependency bugs that `npm`/`yarn
  classic` allow); Turborepo for build/test task caching and dependency-graph-aware
  task execution across `apps/*` and `packages/*`.

## Consequences
- Prisma's migration files are the schema source of truth; [database.md](../database.md)
  is the human-readable companion and must be kept in sync manually during review
  (no auto-doc-generation step in MVP — a documentation-freshness check is a
  reasonable Phase 2 CI addition, not required now).
- Prisma's RLS integration requires setting the session variable explicitly per
  request (via `$executeRaw` in a transaction-scoped middleware) — this is a known,
  documented pattern, not a Prisma-native feature, and is called out explicitly in
  [security.md](../security.md#3-tenant-isolation) so it isn't lost during
  implementation.
- TypeORM was rejected primarily for weaker migration-review ergonomics (its
  auto-generated migrations are harder to audit than Prisma's) and less precise
  generated types.
