# ADR 0002: Shared Database, Shared Schema, with Row-Level Security

Status: Accepted
Date: 2026-08-30

## Context
Three standard multi-tenancy strategies exist: database-per-tenant, schema-per-
tenant, and shared-schema-with-tenant-column. The product will serve many schools,
each modest in data volume individually (thousands of students/buses, not millions),
but the platform must guarantee zero cross-tenant leakage — this is a child-safety
product, not a generic B2B tool, so the isolation bar is higher than typical SaaS.

## Decision
Shared database, shared schema, every tenant-scoped table carries a `school_id`,
enforced at two independent layers:
1. Application-layer repository methods that require `schoolId` explicitly (no
   ambient/global query path).
2. PostgreSQL Row-Level Security policies keyed on a per-request session variable.

Database-per-tenant was rejected for MVP: it multiplies operational burden
(migrations, connection pooling, backups) long before the data volume justifies it,
and it doesn't remove the need for correct application-layer scoping anyway (a
misconfigured connection pool can still cross tenants). Schema-per-tenant was
rejected for the same reason at smaller scale, with worse migration ergonomics than
either alternative.

## Consequences
- Single connection pool, single migration path, simplest operations.
- Requires RLS to be part of the schema from the first migration, not retrofitted —
  see [database.md](../database.md#5-row-level-security).
- If a specific large school/school-group later needs hard physical isolation
  (contractual/regulatory requirement), that can be handled as a dedicated-instance
  deployment of the same codebase, not a schema redesign.
- Every new tenant-scoped table added later must remember the `school_id` column +
  RLS policy — this is captured as a checklist item in the module scaffold, and
  covered by the cross-tenant-404 test pattern established in Phase 1 step 3 of
  [roadmap.md](../roadmap.md).
