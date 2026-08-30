# ADR 0011: School Status Lifecycle Is Platform-Managed, Not Self-Service

Status: Accepted
Date: 2026-08-30

## Context

Phase 1 Step 2 adds school status management (`ACTIVE | TRIAL | SUSPENDED |
INACTIVE`, see [security.md](../security.md#3-school-status)). Setting a school
to `SUSPENDED`/`INACTIVE` blocks **every** user and parent of that school from
authenticating at all — a much larger blast radius than a routine profile edit
(name, contact info, timezone), and one a school administering itself would
never plausibly need or want to self-inflict.

## Decision

Split what was one `schools.update` permission into two:
- `schools.update` (already existed) — routine profile fields. `SCHOOL_ADMIN`
  keeps this.
- `platform.schools.manage` (new) — status/lifecycle transitions only. Granted
  to `SUPER_ADMIN` alone. `PATCH /api/v1/schools/:id/status` requires it;
  `PATCH /api/v1/schools/:id` (profile fields) does not accept a `status` field
  at all — the DTO structurally excludes it, so there is no way to reach a
  status change through the profile-update endpoint even for a `SUPER_ADMIN`
  calling it out of habit.

## Consequences

- Matches the existing `platform.*` namespace convention
  (`platform.schools.read`, `platform.schools.create`) for actions that are
  about the tenant's standing on the platform, not its own internal
  administration — consistent with
  [ADR 0002](0002-multi-tenancy-strategy.md)'s tenant-isolation model.
- A `SCHOOL_ADMIN` account, even if fully compromised, cannot suspend or
  reactivate its own school (or, moot given RLS, any other school) — one less
  thing a compromised school-level credential can do to affect service
  availability.
- No new module or table is introduced — this is a permission-catalog and
  DTO-shape decision, not a schema change beyond the status enum itself
  (`SchoolStatus` gained `INACTIVE`, which was a documentation/semantics gap
  more than an architectural one).
