# Database Design

Status: Draft v1 (MVP-scope tables fully specified; Phase 2/3 tables specified at
a lower level of detail since they will be refined against real device/camera
integrations)
Engine: PostgreSQL 15+
Toolchain: Prisma (schema.prisma is the source of truth; this doc is the human-
readable companion — see [adr/0003-orm-and-database-toolchain.md](adr/0003-orm-and-database-toolchain.md))

## 1. Conventions

- Primary keys: `uuid` (`gen_random_uuid()`), never auto-increment integers exposed
  externally — avoids enumeration and simplifies future multi-region/offline sync.
- Every tenant-scoped table has a non-nullable `school_id uuid references schools(id)`.
- Timestamps: `created_at timestamptz not null default now()`,
  `updated_at timestamptz not null default now()` (maintained by trigger/ORM hook).
- Soft delete: `deleted_at timestamptz null` on tables representing real-world
  entities that must be recoverable / retained for audit (`students`, `parents`,
  `users`, `buses`, `drivers`, `attendants`, `routes`). Event/log tables
  (`attendance_events`, `gps_points`, `audit_logs`, `notifications`) are append-only
  and never deleted except by retention jobs.
- All foreign keys `on delete restrict` by default; explicit `on delete cascade`
  only for true ownership compositions (e.g., `route_stops` → `routes`).
- Every tenant-scoped table has a composite index starting with `school_id` to keep
  tenant-filtered queries index-friendly, plus **PostgreSQL Row-Level Security (RLS)**
  as defense-in-depth (see [security.md](security.md#tenant-isolation)).
- Enums are implemented as Postgres enum types (or check constraints where the set is
  expected to grow) — not free-text.

## 2. Entity-Relationship Overview (MVP scope)

```
schools 1───* users
schools 1───* students
schools 1───* parents
schools 1───* buses ───* bus_devices
schools 1───* drivers
schools 1───* attendants
schools 1───* routes 1───* route_stops
schools 1───* trips
students *───* parents        (via parent_students)
routes   1───* trips
buses    1───* trips
drivers  1───* trips (assigned)
attendants 1───* trips (assigned)
trips    1───* trip_students ───1 students
trips    1───* attendance_events ───1 trip_students
buses    1───* gps_points
users    1───1 roles (via user_roles, many-to-many for future flexibility)
roles    *───* permissions (via role_permissions)
(all)    *───* audit_logs (polymorphic actor/subject reference)
```

## 3. Core Tables (MVP)

### `schools`
Tenant root.
```sql
create table schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED','TRIAL')),
  address jsonb,
  contact_email citext not null,
  contact_phone text,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
```

### `users`
Staff-side identities (school admin, transport roles, principal, security). Drivers
and attendants also get a `users` row (for auth) linked 1:1 to their operational
profile, so authentication is unified while operational data stays in its own table.
Parents have their own table (see below) because their access pattern and PII
sensitivity differ enough to warrant not overloading `users`.
```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  email citext not null,
  phone text,
  password_hash text not null,
  full_name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','DISABLED')),
  mfa_enabled boolean not null default false,
  mfa_secret_encrypted text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (school_id, email)
);
create index on users (school_id);
```
`SUPER_ADMIN` users have `school_id` pointing at a reserved platform-operator school
row (keeps the "every user has exactly one tenant home" invariant simple) but their
role's permissions are cross-tenant by explicit policy, not by null-tenant special
casing. See [security.md](security.md).

### `roles`, `permissions`, `role_permissions`, `user_roles`
```sql
create table roles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id), -- null = system-defined, global role
  key text not null,        -- e.g. 'SCHOOL_ADMIN'
  name text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, key)
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique, -- e.g. 'students.read'
  description text not null,
  category text not null
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (user_id, role_id)
);
```

### `students`
```sql
create table students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  admission_number text not null,
  full_name text not null,
  date_of_birth date,
  grade text,
  section text,
  photo_file_id uuid references files(id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','GRADUATED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (school_id, admission_number)
);
create index on students (school_id);
```

### `parents`
```sql
create table parents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id), -- primary/home school context
  email citext,
  phone text not null,
  password_hash text,
  full_name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','DISABLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (school_id, phone)
);
```
A parent authenticates against their own row; if linked to students at a second
school, that link (see below) references the second school directly, so
authorization checks never need to ask "is this parent's home school the same as the
student's school" — they check the relationship row itself.

### `parent_students`
```sql
create table parent_students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id), -- = students.school_id, denormalized for RLS/index
  parent_id uuid not null references parents(id),
  student_id uuid not null references students(id),
  relationship text not null default 'GUARDIAN',
  verified boolean not null default false,
  verified_by uuid references users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (parent_id, student_id)
);
create index on parent_students (school_id);
create index on parent_students (student_id);
```
`verified = false` rows grant no access — a school staff member must confirm the
relationship (prevents a parent claiming an arbitrary admission number at signup).

### `buses`
```sql
create table buses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  registration_number text not null,
  capacity int not null check (capacity > 0),
  make text,
  model text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','MAINTENANCE','RETIRED')),
  permit_expiry date,
  insurance_expiry date,
  fitness_expiry date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (school_id, registration_number)
);
```

### `bus_devices`
Generic device inventory (GPS unit today; camera/edge-box rows added in Phase 2
reuse this table's shape via `device_type`).
```sql
create table bus_devices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  bus_id uuid not null references buses(id),
  device_type text not null check (device_type in ('GPS','CAMERA','EDGE_AI_BOX')),
  external_device_id text not null, -- serial/IMEI from hardware vendor
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','FAULTY')),
  last_seen_at timestamptz,
  last_health jsonb,
  installed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_type, external_device_id)
);
create index on bus_devices (bus_id);
```

### `drivers`, `attendants`
```sql
create table drivers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  user_id uuid not null references users(id),
  license_number text not null,
  license_expiry date,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id)
);

create table attendants (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  user_id uuid not null references users(id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id)
);
```

### `routes`, `route_stops`
```sql
create table routes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  name text not null,
  shift text not null check (shift in ('MORNING_PICKUP','AFTERNOON_DROP','CUSTOM')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  default_bus_id uuid references buses(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table route_stops (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  route_id uuid not null references routes(id) on delete cascade,
  sequence_no int not null,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  expected_offset_minutes int not null, -- offset from trip start
  radius_meters int not null default 150, -- arrival detection tolerance
  unique (route_id, sequence_no)
);
```

### `trips`, `trip_students`
```sql
create table trips (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  route_id uuid not null references routes(id),
  bus_id uuid not null references buses(id),
  driver_id uuid not null references drivers(id),
  attendant_id uuid references attendants(id),
  service_date date not null,
  shift text not null check (shift in ('MORNING_PICKUP','AFTERNOON_DROP','CUSTOM')),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (route_id, service_date, shift)
);
create index on trips (school_id, service_date);
create index on trips (bus_id, service_date);

create table trip_students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  trip_id uuid not null references trips(id) on delete cascade,
  student_id uuid not null references students(id),
  stop_id uuid references route_stops(id),
  current_status text not null default 'EXPECTED'
    check (current_status in
      ('EXPECTED','BOARDING_PENDING','BOARDED','ABSENT','DROPPED_OFF','ARRIVED_AT_SCHOOL')),
  updated_at timestamptz not null default now(),
  unique (trip_id, student_id)
);
create index on trip_students (school_id);
create index on trip_students (student_id);
```
`trip_students.current_status` is a **derived, denormalized projection** for fast
reads (dashboard, parent view). It is only ever written by the attendance service in
response to an `attendance_events` insert — never written directly by a controller.
This keeps the read-optimized column consistent with the append-only event log.

### `attendance_events`
```sql
create table attendance_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  trip_student_id uuid not null references trip_students(id),
  event_type text not null
    check (event_type in
      ('BOARDING_CONFIRMED','MARKED_ABSENT','DROPPED_OFF','ARRIVED_AT_SCHOOL','STATUS_CORRECTED')),
  source text not null check (source in ('ATTENDANT_APP','RFID','QR','CV','SYSTEM')),
  recorded_by uuid references users(id), -- null for automated sources
  occurred_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index on attendance_events (trip_student_id, occurred_at);
create index on attendance_events (school_id);
```
Append-only, never updated or deleted. A correction is a new `STATUS_CORRECTED`
event with `metadata.reason` and `metadata.previous_status`, preserving full history
per the product requirement to never silently overwrite state.

### `gps_points`
High-volume, append-only, candidate for partitioning by day/bus once volume warrants
it (documented, not built prematurely).
```sql
create table gps_points (
  id bigserial primary key,
  school_id uuid not null references schools(id),
  bus_id uuid not null references buses(id),
  device_id uuid not null references bus_devices(id),
  trip_id uuid references trips(id),
  latitude double precision not null,
  longitude double precision not null,
  speed_kmh numeric(5,2),
  heading numeric(5,2),
  ignition_on boolean,
  network_state text,
  device_time timestamptz not null,
  received_at timestamptz not null default now()
);
create index on gps_points (bus_id, device_time desc);
create index on gps_points (trip_id);
```
`bigserial` here (not `uuid`) is a deliberate exception: this table is never
referenced externally by ID, is extremely high-volume, and benefits from a compact
sequential key for storage/index efficiency.

### `notifications`, `notification_preferences`
```sql
create table notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  recipient_type text not null check (recipient_type in ('USER','PARENT')),
  recipient_id uuid not null,
  event_type text not null, -- e.g. 'CHILD_BOARDED', 'BUS_DELAYED'
  channel text not null check (channel in ('PUSH','SMS','EMAIL','IN_APP')),
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','SENT','FAILED')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (school_id, recipient_type, recipient_id);

create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references parents(id),
  event_type text not null,
  channel text not null,
  enabled boolean not null default true,
  unique (parent_id, event_type, channel)
);
```
Safety-critical event types (emergency broadcasts) are exempt from preference
opt-out at the application layer.

### `audit_logs`
```sql
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid, -- nullable only for platform-level SUPER_ADMIN actions
  actor_type text not null check (actor_type in ('USER','PARENT','SYSTEM')),
  actor_id uuid,
  action text not null, -- e.g. 'student.update', 'ai_event.review'
  subject_type text,
  subject_id uuid,
  request_id text,
  ip_address inet,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index on audit_logs (school_id, created_at desc);
create index on audit_logs (subject_type, subject_id);
```
Insert-only; no application code path updates or deletes rows here. Retention is a
scheduled job governed by [privacy.md](privacy.md), not manual deletion.

### `files`
```sql
create table files (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  owner_type text not null, -- 'STUDENT_PHOTO','INCIDENT_CLIP','DOCUMENT', etc.
  owner_id uuid,
  storage_key text not null,
  content_type text not null,
  size_bytes bigint,
  retention_expires_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
```
No column stores a public URL. Access always goes through the storage abstraction to
mint a short-lived signed URL after an authorization check — see
[privacy.md](privacy.md#file-access).

## 4. Phase 2/3 Tables (specified at outline level; refined against real hardware)

- `geofences(id, school_id, name, kind[SCHOOL_ZONE|ROUTE_CORRIDOR], polygon geography, ...)`
- `speed_events(id, school_id, bus_id, trip_id, recorded_speed_kmh, limit_kmh, occurred_at, ...)`
- `cameras(id, school_id, bus_id, bus_device_id, position, status, ...)` — thin
  extension of `bus_devices` for camera-specific config.
- `camera_events(id, school_id, camera_id, kind[OFFLINE|OBSTRUCTED|HEARTBEAT], ...)`
- `ai_events(id, school_id, bus_id, camera_id, event_type, confidence, severity, occurred_at, clip_file_id, model_version, status[NEW|REVIEWED|DISMISSED], metadata jsonb)`
- `incidents(id, school_id, ai_event_id nullable, opened_by, status[OPEN|INVESTIGATING|RESOLVED], severity, summary, resolution, resolved_at, ...)`
- `incident_events(id, incident_id, actor_id, action, notes, occurred_at)` — append-only
  investigation trail, same pattern as `attendance_events`.
- `emergency_events(id, school_id, trip_id, raised_by, kind, status, occurred_at, resolved_at)`

These are deferred in full DDL until Phase 2/3 design against actual device/vendor
contracts (see [roadmap.md](roadmap.md)), but the shapes above are load-bearing for
the module boundaries defined in [architecture.md](architecture.md).

## 5. Row-Level Security

Every tenant-scoped table gets an RLS policy of the form:

```sql
alter table students enable row level security;
create policy tenant_isolation on students
  using (school_id = current_setting('app.current_school_id')::uuid);
```

The API sets `app.current_school_id` at the start of each request's tenant-scoped
transaction. This is **defense-in-depth**: application-level tenant filtering (via
the repository layer) is the primary control; RLS ensures a bug in one repository
method cannot leak another tenant's rows. See
[security.md](security.md#tenant-isolation) for the full threat model and why both
layers are required.

**Platform-admin bypass, and which tables actually need it.** `schools`,
`audit_logs`, `users`, `parents`, `refresh_tokens`, and `password_reset_tokens`
carry an additional clause:
```sql
using (
  school_id = current_setting('app.current_school_id', true)
  or coalesce(current_setting('app.is_platform_admin', true), 'false') = 'true'
)
```
`PrismaService.runAsPlatformAdmin()` sets `app.is_platform_admin = 'true'` for
narrow, audited cross-tenant reads — used only where a query is inherently
pre-tenant by nature: `SUPER_ADMIN` platform tooling on `schools`, and credential
resolution (login-by-identifier, refresh/reset-token-by-hash) on the other four,
per [ADR 0010](adr/0010-credential-resolution-rls-bypass.md). **Every table queried
via `runAsPlatformAdmin` anywhere in the codebase must carry this clause** — a table
with only the plain `current_school_id` check silently returns zero rows for a
platform-admin-scoped query (`is_platform_admin` being set has no effect on a
policy that never references it), which is exactly the bug documented in ADR 0010's
follow-up: it broke every login/refresh/reset flow until the policies on `users`
and `parents` were corrected to match. Tables *never* queried via
`runAsPlatformAdmin` (`students`, `buses`, `trips`, etc.) correctly have only the
plain tenant check — adding the bypass clause to a table nothing legitimately
needs it for would be an unjustified widening of the escape hatch.

## 6. Migrations

Prisma Migrate generates versioned, reviewable SQL migration files committed to
`prisma/migrations/`. No production schema change is ever hand-applied. Seed data
(`prisma/seed.ts`) creates the nine system roles, their permission grants, and
synthetic demo schools/buses/students/parents for local development — never real
child data.

## 7. Prisma Implementation Notes

`prisma/schema.prisma` is the actual source of truth; the SQL in this document is
illustrative and matches it in substance (constraints, relations, indexes) but not
always byte-for-byte, for the reasons below. Where they differ, the generated
migration under `prisma/migrations/` is authoritative.

- **Primary keys are `TEXT`, not native `uuid`.** Prisma's `String @id
  @default(uuid())` idiom (used for every UUID primary key in this schema)
  generates the value client-side and stores it in a plain `TEXT` column, not
  Postgres's native `uuid` type with a `gen_random_uuid()` server-side default as
  shown in this document's illustrative SQL. This is Prisma's standard, widely-used
  pattern — all constraints (`NOT NULL`, `UNIQUE`, foreign keys) are fully
  preserved; only the column's physical type and where the default is generated
  differ. A consequence: RLS policies (below) compare session variables as text,
  with no `::uuid` cast.
- **Row-Level Security is hand-written SQL**, appended manually to the relevant
  migration file — Prisma's schema language has no RLS syntax. See
  [§5](#5-row-level-security) and the `-- Row-Level Security` block at the end of
  `prisma/migrations/20260829200211_init_core_schema/migration.sql`. Any future
  migration that adds a new tenant-scoped table must append its own
  `ENABLE`/`FORCE ROW LEVEL SECURITY` + `CREATE POLICY` statements the same way —
  this is a manual checklist item, not something Prisma or a lint rule enforces
  automatically yet.
- **Email case-insensitivity is application-layer, not `citext`.** The illustrative
  SQL used Postgres's `citext` extension type; the actual schema uses plain
  `String` and normalizes email addresses to lowercase in the service layer before
  writing or querying, to avoid depending on Prisma's `postgresqlExtensions`
  preview feature for a non-essential convenience.
- **Polymorphic references are plain columns, not Prisma relations.**
  `audit_logs.actor_id`/`subject_id` (varies by `actor_type`/`subject_type`) and
  `files.owner_id` (varies by `owner_type`) have no `@relation` in the schema and
  no database-level foreign key — Prisma (and Postgres foreign keys generally)
  cannot express "references table A or table B depending on another column."
  Referential integrity for these is enforced at the service layer.
- **`permissions`, `role_permissions`, `user_roles` have no RLS policy.**
  `permissions` is global reference data with no tenant dimension. The two join
  tables have no `school_id` column of their own (see [§3](#3-core-tables-mvp));
  they are protected transitively because the application only ever reaches them
  through an already-tenant-scoped `roles`/`users` query, never independently.
