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
trips    1───* trip_stops (immutable snapshot of route_stops at creation)
trips    1───* trip_students ───1 students
trip_stops 1───* trip_students (pickup/dropoff, nullable = "the school")
trips    1───* attendance_events ───1 trip_students
buses    1───* gps_points
schools 1───* invitations (polymorphic: staff or parent principal)
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
  status text not null default 'ACTIVE' check (status in ('ACTIVE','TRIAL','SUSPENDED','INACTIVE')),
  address jsonb,
  contact_email citext not null,
  contact_phone text,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
```
`status` semantics (Phase 1 Step 2, [ADR 0011](adr/0011-school-status-platform-managed.md)):
`ACTIVE`/`TRIAL` are operational — every user's and parent's login/refresh works
normally, subject to their own account status. `SUSPENDED`/`INACTIVE` block **all**
logins and refreshes for the school regardless of individual account status
(`AuthService.isSchoolOperational()`), checked on every `loginStaff`/`loginParent`/
`refresh` call. Status changes are platform-managed
(`platform.schools.manage`, SUPER_ADMIN only) — deliberately separate from
`schools.update` (routine profile edits, SCHOOL_ADMIN), since suspending a school
is a platform-level action, not school self-service.

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
  password_hash text, -- nullable: null until an INVITED account accepts its invitation
  full_name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INVITED','SUSPENDED','DISABLED')),
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
  password_hash text, -- nullable: null until an INVITED account accepts its invitation
  full_name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INVITED','SUSPENDED','DISABLED')),
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
As of Phase 1 Step 2, the link itself is always staff-initiated
(`POST /parents/:id/children`, `parents.manage_relationships`) rather than
parent self-service — there is no endpoint where a parent supplies a `studentId`
to link themselves; verification is a separate staff action
(`POST /parent-students/:id/verify`).

### `invitations`
Backs the staff and parent onboarding flow (Phase 1 Step 2) — a single polymorphic
table shared by both audiences via `principal_type`/`principal_id`, avoiding a
duplicated token/expiry table per audience.
```sql
create table invitations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  principal_type text not null check (principal_type in ('STAFF','PARENT')),
  principal_id uuid not null, -- users.id or parents.id, per principal_type
  token_hash text not null unique, -- sha-256 of the opaque token; same scheme as refresh/reset tokens
  invited_by uuid not null references users(id),
  expires_at timestamptz not null, -- default INVITATION_TOKEN_TTL_DAYS (7) from issuance
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (principal_type, principal_id)
);
create index on invitations (school_id);
```
The `unique (principal_type, principal_id)` constraint means at most one invitation
ever exists per person — issuing a new one (e.g. "resend") upserts the same row
with a fresh token/expiry rather than accumulating rows. Accepting sets the
target `User`/`Parent` row's `password_hash` and flips `status` to `ACTIVE`
(`InvitationsService.accept()`), inside the same tenant-scoped transaction as
marking the invitation `accepted_at`. This table carries the platform-admin RLS
bypass clause (see [§5](#5-row-level-security)) because acceptance is looked up
by token hash before the caller's tenant is known, the same pre-tenant-resolution
pattern as `refresh_tokens`/`password_reset_tokens`.

### `buses`
Implemented in Phase 1 Step 3 (`BusesModule`) with the fields actually needed
by the admin UI's create/edit/list/filter screens — `fleet_number` is the
school's own internal identifier (e.g. "Bus 7"), distinct from the legal
`registration_number`; both are unique per school, and `fleet_number` allows
multiple `NULL`s (Postgres treats each `NULL` as distinct in a unique index)
since not every school assigns one immediately.
```sql
create table buses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  fleet_number text,
  registration_number text not null,
  capacity int not null check (capacity > 0),
  make text,
  model text,
  manufacture_year int,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','MAINTENANCE','RETIRED')),
  permit_expiry date,
  insurance_expiry date,
  fitness_expiry date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (school_id, registration_number),
  unique (school_id, fleet_number)
);
```
`status` semantics: `ACTIVE` (in service) and `INACTIVE`/`MAINTENANCE`
(temporarily withdrawn — both reversible via a normal `PATCH`) vs. `RETIRED`
(terminal — a bus can only reach this state through `POST /buses/:id/archive`,
never a plain status update, mirroring `Student.status`'s archive-only
`INACTIVE`; `PATCH` explicitly rejects `status: 'RETIRED'` with a 400 telling
the caller to use the archive endpoint instead). This is a routine,
school-level concern gated by `buses.manage` — unlike `School.status`
([ADR 0011](adr/0011-school-status-platform-managed.md)), it is not a
platform-level lifecycle decision.

### `bus_devices`
Generic device inventory — a GPS tracker or edge computer today, a camera
controller once Phase 2 camera work actually starts (not before: adding an
enum value for a device type nothing uses yet would be exactly the kind of
speculative addition the project avoids).
```sql
create table bus_devices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  bus_id uuid not null references buses(id),
  device_type text not null check (device_type in ('GPS_TRACKER','EDGE_COMPUTER','NETWORK_GATEWAY')),
  external_device_id text not null, -- serial/IMEI from hardware vendor — not a secret
  firmware_version text,
  metadata jsonb, -- device configuration (e.g. reporting interval); distinct from last_health
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
No credential/secret column exists on this table — see
[security.md#device-security](security.md#device-security) for why. As with
`buses.status`, `PATCH` cannot set `status` to `INACTIVE` directly; only
`POST /devices/:id/deactivate` can.

### `drivers`, `attendants`
Transport-specific profiles layered onto an existing `User` — never a second
identity or credential store. `POST /drivers` and `POST /attendants` attach a
profile to an already-existing staff user (created via the Users/invite
flow); they never create a `User` or set a password themselves. `status`
here (`ACTIVE`/`INACTIVE`, via `activate`/`deactivate` endpoints) is a
transport-operational flag only — e.g. "not currently doing driving
duty" — and is completely independent of the underlying `User.status`
(`ACTIVE`/`INVITED`/`SUSPENDED`/`DISABLED`) that actually gates login;
deactivating a driver profile has no effect on whether that person can sign
in as staff.
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
  unique (user_id),
  unique (school_id, license_number)
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

Implemented in Phase 1 Step 4 (`RoutesModule`/`RouteStopsModule`). A Route is
a reusable **planned path** — never a specific day's execution, never bound
to a specific bus/driver/attendant. That binding is the future Trip model's
job (`trips.bus_id`/`driver_id`/`attendant_id`, below), which is
time-bound (`service_date` + `shift`) in a way a Route template
deliberately isn't. A `default_bus_id` field from the Phase 0 scaffold was
removed for exactly this reason — it modeled a permanent route↔bus binding
this phase's design rules out. See [§8](#8-data-model-principle-fleet-domain)'s
"Route vs. Trip" note.

`direction` (`HOME_TO_SCHOOL`/`SCHOOL_TO_HOME`) is distinct from `shift`
(`MORNING_PICKUP`/`AFTERNOON_DROP`/`CUSTOM`) — the two are highly correlated
in practice but independent facts (a `CUSTOM`-shift activity route could run
either direction), so both are kept rather than inferring one from the
other.

`status`: `ACTIVE` (in use, referenceable by new Trips once Trips exist) and
`INACTIVE` (temporarily not run) are both reversible via a normal `PATCH`.
`ARCHIVED` is terminal — set only via `POST /routes/:id/archive`, mirroring
`Bus.status`'s `RETIRED`. A route is **never physically deleted**: a Trip may
reference it historically once Trips exist, so it must remain resolvable.

```sql
create table routes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  code text, -- optional short reference (e.g. "R-01"), unique per school when set
  name text not null,
  direction text not null check (direction in ('HOME_TO_SCHOOL','SCHOOL_TO_HOME')),
  shift text not null check (shift in ('MORNING_PICKUP','AFTERNOON_DROP','CUSTOM')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','ARCHIVED')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (school_id, code)
);
```

**Route↔Stop relationship**: stops are **route-owned**, not a separate
reusable "physical stop" entity shared across routes. A school where
`Route A → Main Gate` and `Route B → Main Gate` simply gets two `RouteStop`
rows with the same name/coordinates — a small, harmless duplication of a
name+coordinates tuple. A `PhysicalStop ← RouteStop` indirection was
considered and rejected for MVP: nothing today needs to query "every route
serving this physical location," and the extra join/CRUD surface would be
unused complexity until that need is concrete. If it ever is, the
route-owned model migrates cleanly (extract the distinct name/coordinate
tuples into a new table, backfill `RouteStop.physical_stop_id`).

`expected_offset_minutes` is an offset from trip start, not an absolute
time — a Route is a template with no start time of its own; an absolute ETA
only exists once a Trip (which has a `service_date`) exists. `mode`
(`PICKUP`/`DROPOFF`/`BOTH`) is modeled explicitly per stop rather than
inferred from the route's `direction`, since a real route can have
exceptions. Sequence uniqueness (`unique(route_id, sequence_no)`) is
enforced by the database, not just application validation — reordering
(`POST /routes/:routeId/stops/reorder`) shifts every affected stop to a
temporary out-of-range sequence number first, in the same transaction, so
the final pass writing real sequence numbers 1..N can never collide with an
existing value.

```sql
create table route_stops (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  route_id uuid not null references routes(id) on delete cascade,
  sequence_no int not null,
  name text not null,
  address text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  expected_offset_minutes int not null, -- offset from trip start
  radius_meters int not null default 150, -- arrival detection tolerance (future GPS geofencing)
  mode text not null default 'BOTH' check (mode in ('PICKUP','DROPOFF','BOTH')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (route_id, sequence_no)
);
```

A stop is hard-deleted (`DELETE /stops/:id`) only if no `trip_students` row
references it yet; otherwise the caller must deactivate it instead
(`status: 'INACTIVE'`) — the same "don't break historical integrity" rule
as routes, applied at the stop level. No PostGIS extension is used —
`latitude`/`longitude` are plain validated `double precision` columns,
sufficient for storing and displaying fixed points; nothing in this phase
does geospatial querying (radius/distance calculations) that would justify
it.

### `trips`, `trip_stops`, `trip_students`

Implemented in Phase 1 Step 5 (`TripsModule`/`TripStudentsModule`). Full
design rationale — Trip-vs-Route separation, why `trip_stops` is a full
immutable snapshot rather than a live reference to `route_stops`, why
`scheduled_start_time`/`scheduled_end_time` are validated `"HH:mm"` strings
rather than `DateTime`, the trip lifecycle graph, and why
`membership_status` is a distinct concept from `current_status` — is in
[ADR 0012](adr/0012-trip-stop-snapshot-and-lifecycle.md). Summary below.

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
  scheduled_start_time text not null, -- "HH:mm", school-local wall-clock — never converted to UTC
  scheduled_end_time text not null,
  status text not null default 'SCHEDULED'
    check (status in ('SCHEDULED','READY','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW')),
  started_at timestamptz,   -- a real instant, unlike the scheduled_* columns above
  ended_at timestamptz,
  cancellation_reason text, -- used for both CANCELLED and NO_SHOW
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (route_id, service_date, shift)
);
create index on trips (school_id, service_date);
create index on trips (bus_id, service_date);
create index on trips (driver_id, service_date);
create index on trips (attendant_id, service_date);

-- Immutable snapshot of the route's active stops, copied at trip creation.
-- Never edited after creation. See ADR 0012.
create table trip_stops (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  trip_id uuid not null references trips(id) on delete cascade,
  source_route_stop_id uuid references route_stops(id) on delete set null, -- traceability only
  sequence_no int not null,
  name text not null,
  address text,
  latitude double precision not null,
  longitude double precision not null,
  expected_offset_minutes int not null,
  mode text not null check (mode in ('PICKUP','DROPOFF','BOTH')),
  created_at timestamptz not null default now(),
  unique (trip_id, sequence_no)
);
create index on trip_stops (school_id);

create table trip_students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  trip_id uuid not null references trips(id) on delete cascade,
  student_id uuid not null references students(id),
  pickup_trip_stop_id uuid references trip_stops(id) on delete set null,  -- null = "the school" (implicit terminus)
  dropoff_trip_stop_id uuid references trip_stops(id) on delete set null,
  membership_status text not null default 'PLANNED' check (membership_status in ('PLANNED','ACTIVE','REMOVED')),
  notes text,
  current_status text not null default 'EXPECTED'
    check (current_status in
      ('EXPECTED','BOARDING_PENDING','BOARDED','ABSENT','DROPPED_OFF','ARRIVED_AT_SCHOOL')),
  boarded_at timestamptz,
  dropped_off_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, student_id)
);
create index on trip_students (school_id);
create index on trip_students (student_id);
```

`trip_students.pickup_trip_stop_id`/`dropoff_trip_stop_id` reference
**this trip's own** `trip_stops`, never `route_stops` directly (Phase 0's
scaffold had a single `stop_id` pointing at `route_stops`, replaced in
Phase 1 Step 5 — see ADR 0012 for why). A stop id belonging to a
*different* trip is rejected at the service layer (a bare foreign key can't
express "must belong to trip X specifically").

`trip_students.membership_status` (Step 5: "is this student on the
manifest") is written directly by `TripStudentsService`.
`trip_students.current_status`/`boarded_at`/`dropped_off_at` (Step 6
Attendance's concept: "what happened to them") are a **derived,
denormalized projection**, only ever written by `AttendanceService` in
response to an `attendance_events` insert, never directly by
`TripStudentsService` — keeping the read-optimized columns consistent with
the immutable event log. See [ADR 0013](adr/0013-attendance-event-model.md).
`BOARDING_PENDING`/`ARRIVED_AT_SCHOOL` remain unused Phase 0 scaffold
values — only `EXPECTED`/`BOARDED`/`ABSENT`/`DROPPED_OFF` are ever set.

### `attendance_events`

Implemented in Phase 1 Step 6 (`AttendanceService`). Full design rationale
— why this is a separate fact log from `TripStudent.membershipStatus`, why
a correction is a new row rather than an edit, the exact boarding/drop-off/
absence state-transition rules, and the `BUS_ATTENDANT` own-trip scoping
mechanism — is in
[ADR 0013](adr/0013-attendance-event-model.md). Summary below.

```sql
create table attendance_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  trip_id uuid not null references trips(id), -- denormalized for direct trip-scoped queries/indexing
  trip_student_id uuid not null references trip_students(id),
  trip_stop_id uuid references trip_stops(id), -- always derived server-side from the student's own pickup/dropoff stop; null = "the school"
  event_type text not null
    check (event_type in
      ('BOARDING_CONFIRMED','MARKED_ABSENT','DROPPED_OFF','ARRIVED_AT_SCHOOL','STATUS_CORRECTED')),
  source text not null default 'ATTENDANT_APP' check (source in ('ATTENDANT_APP','RFID','QR','CV','SYSTEM')),
  recorded_by uuid references users(id), -- always the authenticated principal; never client-supplied
  occurred_at timestamptz not null default now(), -- server time for normal events; caller-specified only via /correct
  corrects_event_id uuid references attendance_events(id), -- set only on a correction; the event it supersedes
  notes text,
  latitude double precision,
  longitude double precision,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index on attendance_events (trip_id, occurred_at);
create index on attendance_events (trip_student_id, occurred_at);
create index on attendance_events (school_id);
```

Immutable — never updated or deleted. `ARRIVED_AT_SCHOOL` and
`STATUS_CORRECTED` are Phase 0 scaffold values left unused this phase (a
correction reuses the real corrected type instead — see the ADR); only
`BOARDING_CONFIRMED`/`MARKED_ABSENT`/`DROPPED_OFF` are written by anything
in Step 6. `source` is always `ATTENDANT_APP` this phase (this codebase's
"MANUAL" — no separate enum value was introduced for the same concept
under a different name); `RFID`/`QR`/`CV`/`SYSTEM` remain reserved for a
future device/AI integration that does not exist yet.

`TripStudent.currentStatus`/`boardedAt`/`droppedOffAt` are the derived,
denormalized projection of "the latest event for this student" — see
`TripStudent`'s entry above and the ADR.

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
`audit_logs`, `users`, `parents`, `refresh_tokens`, `password_reset_tokens`, and
`invitations` carry an additional clause:
```sql
using (
  school_id = current_setting('app.current_school_id', true)
  or coalesce(current_setting('app.is_platform_admin', true), 'false') = 'true'
)
```
`PrismaService.runAsPlatformAdmin()` sets `app.is_platform_admin = 'true'` for
narrow, audited cross-tenant reads — used only where a query is inherently
pre-tenant by nature: `SUPER_ADMIN` platform tooling on `schools`, credential
resolution (login-by-identifier, refresh/reset-token-by-hash) on the middle four,
and invitation-acceptance (lookup by token hash, before the accepting principal's
tenant is known) on `invitations`, per
[ADR 0010](adr/0010-credential-resolution-rls-bypass.md). **Every table queried
via `runAsPlatformAdmin` anywhere in the codebase must carry this clause** — a table
with only the plain `current_school_id` check silently returns zero rows for a
platform-admin-scoped query (`is_platform_admin` being set has no effect on a
policy that never references it), which is exactly the bug documented in ADR 0010's
follow-up: it broke every login/refresh/reset flow until the policies on `users`
and `parents` were corrected to match. This lesson was applied proactively to
`invitations` from the start in Phase 1 Step 2, avoiding a repeat of that bug.
Tables *never* queried via `runAsPlatformAdmin` (`students`, `buses`, `trips`,
etc.) correctly have only the plain tenant check — adding the bypass clause to a
table nothing legitimately needs it for would be an unjustified widening of the
escape hatch.

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

## 8. Data Model Principle: Fleet Domain

Introduced in Phase 1 Step 3 (`buses`/`bus_devices`/`drivers`/`attendants`),
the fleet domain keeps four concepts deliberately separate rather than
merging them for convenience:

- **`User`** — the authentication identity. Staff sign in as a `User`
  regardless of what transport role they hold.
- **`Driver`/`Attendant` profile** — transport-specific information layered
  onto an existing `User` via `user_id` (1:1, `unique(user_id)`). Creating one
  never creates a `User` or sets a password; the person must already exist as
  staff (via the invite flow from Phase 1 Step 2). This also means assigning
  the `DRIVER`/`BUS_ATTENDANT` RBAC role (which grants *login-time*
  permissions like `trips.manage`) and creating the driver/attendant profile
  (which records *fleet-domain* facts like a license number) are
  independent actions — one doesn't imply the other.
- **`Bus`** — the vehicle itself, with no `driver_id`/`attendant_id` column.
- **`BusDevice`** — a physical/edge device attached to a bus.

**No separate "assignment" entity was created** linking a bus to a driver and
attendant for a given day. The schema already has one: the `Trip` model
(scaffolded in Phase 0, not yet exposed via any API — routes/trips are a
later Phase 1 step) carries `bus_id`/`driver_id`/`attendant_id` directly and
is inherently time-bound (`service_date` + `shift`). Building a second,
redundant assignment concept now — before anything consumes either — would
be exactly the kind of premature abstraction this project avoids. When the
Trips module is built, it becomes the real "who's driving which bus today"
record.

### Route vs. Trip (Phase 1 Step 4)

The same separation principle extends to routes: `Route` is a **reusable
planned path** (a template — "our Route 1 morning pickup"); `Trip` is a
**specific day's execution** of one (scaffolded in Phase 0, not yet exposed
via any API). A `Route` has no `bus_id`/`driver_id`/`attendant_id` column for
the same reason `Bus` has no `driver_id`/`attendant_id` — permanent
operational binding belongs entirely to `Trip`, which already carries
`route_id` alongside `bus_id`/`driver_id`/`attendant_id` and a
`service_date`. See [§3](#3-core-tables-mvp)'s `routes`/`route_stops` entry
for the Route↔Stop relationship decision (route-owned stops, no separate
physical-stop entity).
