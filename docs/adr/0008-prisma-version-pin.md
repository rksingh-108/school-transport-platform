# ADR 0008: Pin Prisma ORM to the 5.x Line (not the newly-released 7.x)

Status: Accepted
Date: 2026-08-30
Trigger: encountered during Phase 0 scaffolding — a genuinely blocking technical
issue per the standing instruction to only deviate from documented architecture
when one arises, and to record the deviation.

## Context

[ADR 0003](0003-orm-and-database-toolchain.md) chose Prisma as the ORM/migration
toolchain but did not pin a major version. Installing "latest" during Phase 0
scaffolding resolved to Prisma 7.10.0 (with an 8.0.0 release candidate already
tagged `latest` on the CLI package). Prisma 7's default client generator
(`provider = "prisma-client"`) is a substantially different integration model from
the one ADR 0003's reasoning assumed:

- It emits **ESM TypeScript source files** into the output directory, with
  explicit `.ts`-extension relative imports between them (e.g.
  `import * as $Enums from "./enums.ts"`) and `import.meta.url` usage — designed
  to be consumed by a bundler or native TS runtime, not compiled by plain `tsc`
  into CommonJS `dist/` output the way NestJS's default build does.
- It **requires an explicit driver adapter object** at construction
  (`new PrismaClient({ adapter: new PrismaPg({ connectionString: ... }) })`)
  rather than a connection-string-only `datasource.url`. This is a real API
  surface change, not a config tweak.
- It replaces `schema.prisma`'s `datasource.url` / CLI behavior with a new
  `prisma.config.ts` file (versioned as `prisma7.config.ts` by this release),
  another moving part not assumed anywhere in [database.md](../database.md) or
  [ADR 0003](0003-orm-and-database-toolchain.md).

Making the modular monolith's core persistence layer depend on a same-week-mature,
still-settling major version (an RC is already tagged `latest` on the CLI)
introduces exactly the kind of unnecessary bleeding-edge risk this project's
principles warn against for foundational tooling, for no functional benefit at
this stage — none of the documented MVP requirements need Prisma 7's new
capabilities (driver adapters for edge/serverless runtimes, D1/Turso support,
etc.).

## Decision

Pin `prisma` and `@prisma/client` to the 5.x line (currently 5.22.0), using the
classic `prisma-client-js` generator: CommonJS-compatible output resolved via the
normal `@prisma/client` package, connection configured via `datasource.url =
env("DATABASE_URL")` in `schema.prisma`, no driver adapter required, no separate
`prisma.config.ts`. This is the generation model ADR 0003's reasoning (migration
review ergonomics, precise generated types, NestJS/ts-jest/typescript-eslint
compatibility) was actually written against.

The two-database-role design required by [database.md](../database.md#5-row-level-security)
(a privileged connection for migrations/seed, a restricted `app_user` connection
for the running API) is implemented via the well-established 5.x
`datasources.db.url` constructor override, not a config-file-level split — see
`apps/api/src/database/prisma.service.ts`.

## Consequences

- The generated Prisma Client lives in `node_modules/@prisma/client` as usual;
  no custom `generated/` output directory or `.gitignore` entry for one is needed.
- This ties the codebase to a version line that will eventually be unsupported.
  Revisiting this (a follow-up ADR, not a silent upgrade) is reasonable once
  Prisma 7/8 stabilizes past its RC and the wider ecosystem (ts-jest, NestJS
  starter templates, typescript-eslint) demonstrates compatibility with its ESM/
  driver-adapter model — tracked as a follow-up item, not blocking for MVP.
- No documented product requirement depends on Prisma 7-only features, so this
  pin has no functional impact on scope.
