# ADR 0009: Pin NestJS to the 11.x Line (not the newly-released 12.x)

Status: Accepted
Date: 2026-08-30
Trigger: encountered during Phase 0 scaffolding — a genuinely blocking technical
issue, same category as [ADR 0008](0008-prisma-version-pin.md).

## Context

[architecture.md](../architecture.md) specifies NestJS for the API without pinning
a major version. Installing "latest" during scaffolding resolved to NestJS 12.0.1.
Building the app succeeded, but the test suite failed immediately:

```
Must use import to load ES Module: .../node_modules/@nestjs/testing/index.js
```

Inspecting `@nestjs/testing@12.0.1`'s `package.json` confirmed `"type": "module"`
with no CommonJS export condition — it is pure ESM with no dual-package fallback.
This app's build (via `nest build`/`tsc`, CommonJS output) and its test runner
(Jest + ts-jest, the standard, broadly-documented NestJS testing setup) are both
CommonJS. Making the whole toolchain ESM-native (Jest's experimental VM-modules
mode, `.mjs`/`extensionsToTreatAsEsm` config, verifying every other dependency's
ESM/CJS interop) would be a substantial, still-settling toolchain migration for a
framework version released too recently for that migration path to be
well-documented — the same bleeding-edge-risk pattern as ADR 0008, in a framework
this monolith depends on even more centrally than Prisma.

## Decision

Pin all `@nestjs/*` packages to their latest 11.x releases:
`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/swagger`,
`@nestjs/testing`, `@nestjs/cli` at `^11`, and `@nestjs/schematics` at `^11.1.0`.
`@nestjs/config` does not version-track the core framework (it jumped from `4.0.4`
directly to `12.0.0` when the maintainers realigned its numbering) — pinned to
`^4.0.4`, confirmed via its published `peerDependencies` to support
`@nestjs/common ^10 || ^11`. `@nestjs/throttler` (`^6.5.0`) and `@nestjs/terminus`
(`^11.1.1`) were already resolved against compatible ranges and needed no change.

## Consequences

- The full toolchain (build via `tsc`/`nest build`, test via Jest/ts-jest) works
  without any ESM-interop configuration — the standard, most broadly compatible
  setup for a NestJS + Prisma stack today.
- Revisiting this to NestJS 12 (a follow-up ADR, not a silent upgrade) is
  reasonable once `@nestjs/testing` ships a CJS-compatible export or this app's
  own toolchain moves to native ESM — neither is a documented MVP requirement, so
  this pin has no functional impact on scope.
- Combined with [ADR 0008](0008-prisma-version-pin.md), this establishes a general
  pattern for this project: when "latest" resolves to a same-week major release
  with a breaking distribution/integration model, pin to the last stable line and
  document it here rather than absorbing the migration cost into Phase 0
  scaffolding.
