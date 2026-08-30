/**
 * Canonical role and permission keys. This is the single source of truth consumed
 * by prisma/seed.ts (to create the seed rows) and by the backend policy layer
 * (to validate a requested permission key is a real one at compile time).
 *
 * See docs/security.md#2-authorization-rbac--permissions for the full model.
 */

export const ROLE_KEYS = [
  'SUPER_ADMIN',
  'SCHOOL_ADMIN',
  'TRANSPORT_ADMIN',
  'TRANSPORT_MANAGER',
  'PRINCIPAL',
  'DRIVER',
  'BUS_ATTENDANT',
  'SECURITY',
  'PARENT',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const PERMISSION_KEYS = [
  'schools.read',
  'schools.update',
  'users.read',
  'users.create',
  'users.update',
  'users.delete',
  'users.manage_roles',
  'students.read',
  'students.create',
  'students.update',
  'students.delete',
  'parents.read',
  'parents.create',
  'parents.update',
  'parents.manage_relationships',
  'buses.read',
  'buses.manage',
  'drivers.read',
  'drivers.manage',
  'attendants.read',
  'attendants.manage',
  'routes.read',
  'routes.manage',
  'trips.read',
  'trips.manage',
  'attendance.read',
  'attendance.manage',
  'gps.read',
  'camera.read',
  'camera.manage',
  'ai_events.read',
  'ai_events.review',
  'incidents.create',
  'incidents.read',
  'incidents.resolve',
  'emergency.create',
  'emergency.read',
  // Phase 2 Step 12: `emergency.manage` (lifecycle transitions —
  // acknowledge/add response action/resolve/cancel), a deliberate sibling
  // of the existing `emergency.create`/`emergency.read` pair rather than a
  // new pluralized `emergencies.*` scheme — this domain already has an
  // established singular naming convention (matching `gps.read`,
  // `attendance.read`/`attendance.manage`) that a new key should follow,
  // not compete with.
  'emergency.manage',
  // Safety events are a new-this-step concept, distinct from the
  // pre-existing `incidents.*` keys (reserved for a human-adjudicated
  // incident lifecycle expected to be built from future `ai_events`, per
  // docs/architecture.md's module table) — reusing `incidents.*` here would
  // blur that still-unbuilt pipeline. `safety_events.create` is the narrow
  // permission DRIVER/BUS_ATTENDANT hold (their own trip/bus only, enforced
  // in SafetyEventsService); `safety_events.read`/`safety_events.manage`
  // are the broader staff dashboard/triage capabilities.
  'safety_events.create',
  'safety_events.read',
  'safety_events.manage',
  // Phase 2 Step 13: geofences (standalone zones) and safety_rules
  // (monitoring policies) are separate permission pairs, not folded into
  // `safety_events.*` — configuring what gets monitored is a distinct,
  // narrower-audience capability from viewing/triaging the events those
  // rules produce (mirrors the camera.*-vs-buses.* separation reasoning
  // from Phase 2 Step 11).
  'geofences.read',
  'geofences.manage',
  'safety_rules.read',
  'safety_rules.manage',
  'notifications.read',
  'notifications.manage',
  'reports.read',
  'audit_logs.read',
  'device_health.read',
  'platform.schools.read',
  'platform.schools.create',
  // Lifecycle/status changes (activate, suspend, deactivate) — deliberately
  // distinct from `schools.update` (routine profile edits SCHOOL_ADMIN
  // already has). Suspending/deactivating a school affects whether every one
  // of its users and parents can authenticate at all (docs/security.md#3-school-status),
  // which is a platform-level concern, not something a school administers
  // for itself. See docs/adr/0011-school-status-platform-managed.md.
  'platform.schools.manage',
  'platform.impersonate_school',
  // Phase 3 Step 14: the AI model registry (AIModel) is platform-wide (no
  // schoolId column at all — a shared ML asset, not a per-school
  // configuration; see docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md),
  // so it follows the same `platform.*` namespace/SUPER_ADMIN-only
  // convention as `platform.schools.*` (ADR 0011) rather than a school-level
  // permission. No school-level staff role is ever granted either key —
  // they see a model's name/version only as denormalized fields on the
  // AIObservations they're permitted to read, never the registry itself.
  'platform.ai_models.read',
  'platform.ai_models.manage',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/**
 * Default role -> permission grants for MVP-scope permissions, mirroring the
 * matrix in docs/security.md#23-default-role--permission-matrix. Phase 2/3
 * permissions (camera, ai_events, incidents, emergency) are included here even
 * though those modules are not implemented yet, so the seed data does not need to
 * be revisited when those modules land — only the enforcing modules do.
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<RoleKey, readonly PermissionKey[]>> = {
  SUPER_ADMIN: [
    'platform.schools.read',
    'platform.schools.create',
    'platform.schools.manage',
    'platform.impersonate_school',
    // Phase 3 Step 14 — the AI model registry is platform-wide, SUPER_ADMIN-only.
    'platform.ai_models.read',
    'platform.ai_models.manage',
  ],
  SCHOOL_ADMIN: [
    'schools.read',
    'schools.update',
    'users.read',
    'users.create',
    'users.update',
    'users.delete',
    'users.manage_roles',
    'students.read',
    'students.create',
    'students.update',
    'students.delete',
    'parents.read',
    'parents.create',
    'parents.update',
    'parents.manage_relationships',
    'buses.read',
    'buses.manage',
    'drivers.read',
    'drivers.manage',
    'attendants.read',
    'attendants.manage',
    'routes.read',
    'routes.manage',
    'trips.read',
    'trips.manage',
    'attendance.read',
    'gps.read',
    // Phase 2 Step 11 (camera foundation): SCHOOL_ADMIN already has full
    // read+manage on every other fleet/device domain (buses, drivers,
    // attendants) — cameras were the one Phase-2-reserved permission pair
    // that had never been granted anywhere the school's own top operational
    // authority could use it, the same class of gap fixed for
    // TRANSPORT_MANAGER (buses.read, Step 3) and TRANSPORT_ADMIN
    // (notifications.read, Step 9) while reviewing existing grants.
    'camera.read',
    'camera.manage',
    // Phase 3 Step 14 — same reasoning as camera.read/manage above:
    // `ai_events.*` was reserved since Phase 0 for exactly this concept
    // (see architecture.md's module table) but had never actually been
    // granted to this school's own top operational authority, the same
    // class of gap fixed for camera.read/manage in Step 11.
    'ai_events.read',
    'incidents.create',
    'incidents.read',
    'incidents.resolve',
    'emergency.read',
    // Phase 2 Step 12 — same reasoning as camera.read/manage above: this
    // school's own top operational authority should have full safety-event/
    // emergency triage capability, not just read visibility. `emergency.create`
    // lets staff trigger an emergency directly (not only escalate one from a
    // SafetyEvent), same "authorized staff" capability the step's spec lists
    // alongside driver/attendant.
    'emergency.create',
    'emergency.manage',
    'safety_events.create',
    'safety_events.read',
    'safety_events.manage',
    // Phase 2 Step 13 — same reasoning as camera/safety-event grants above.
    'geofences.read',
    'geofences.manage',
    'safety_rules.read',
    'safety_rules.manage',
    'notifications.read',
    'notifications.manage',
    'reports.read',
    'audit_logs.read',
    'device_health.read',
  ],
  TRANSPORT_ADMIN: [
    'buses.read',
    'buses.manage',
    'drivers.read',
    'drivers.manage',
    'attendants.read',
    'attendants.manage',
    'routes.read',
    'routes.manage',
    'trips.read',
    'trips.manage',
    'attendance.read',
    'gps.read',
    'camera.read',
    'camera.manage',
    // Phase 3 Step 14: `ai_events.read` added alongside the pre-existing
    // `ai_events.review` — reviewing without being able to read observations
    // at all was a latent gap (review presupposes read).
    'ai_events.read',
    'ai_events.review',
    'incidents.create',
    'incidents.read',
    'incidents.resolve',
    'emergency.read',
    'emergency.create',
    'emergency.manage',
    'safety_events.create',
    'safety_events.read',
    'safety_events.manage',
    'geofences.read',
    'geofences.manage',
    'safety_rules.read',
    'safety_rules.manage',
    'reports.read',
    'device_health.read',
    // Operational alert recipient (GPS_STALE/GPS_OFFLINE/TRIP_CANCELLED/
    // TRIP_NO_SHOW) — added in Phase 1 Step 9 while reviewing existing
    // grants; only SCHOOL_ADMIN had this since Phase 0, the same class of
    // gap as TRANSPORT_MANAGER's fleet-visibility fix in Phase 1 Step 3.
    'notifications.read',
  ],
  TRANSPORT_MANAGER: [
    // Read-only fleet visibility — added in Phase 1 Step 3 while reviewing
    // existing grants: a manager who schedules trips/attendance needs to see
    // which buses/drivers/attendants exist, but has no business creating or
    // editing fleet records (that stays TRANSPORT_ADMIN/SCHOOL_ADMIN-only,
    // via buses.manage/drivers.manage/attendants.manage).
    'buses.read',
    'drivers.read',
    'attendants.read',
    'routes.read',
    'trips.read',
    'trips.manage',
    'attendance.read',
    'attendance.manage',
    'gps.read',
    'camera.read',
    // Phase 3 Step 14 — read-only, same posture as camera.read above.
    'ai_events.read',
    'emergency.read',
    'emergency.create',
    'emergency.manage',
    'safety_events.create',
    'safety_events.read',
    'safety_events.manage',
    // Read-only — a manager can see what's configured but provisioning
    // geofences/rules stays TRANSPORT_ADMIN/SCHOOL_ADMIN-only, same split
    // already used for buses/drivers/attendants above.
    'geofences.read',
    'safety_rules.read',
    'reports.read',
    'device_health.read',
    // Operational alert recipient — see the TRANSPORT_ADMIN note above.
    'notifications.read',
  ],
  PRINCIPAL: [
    'schools.read',
    'students.read',
    'buses.read',
    'drivers.read',
    'attendants.read',
    'routes.read',
    'trips.read',
    'attendance.read',
    'gps.read',
    // Camera visibility (Phase 2 Step 11) fits the same broad
    // safety-oversight bucket PRINCIPAL already has for GPS/incidents/
    // emergency — read-only, never camera.manage (provisioning hardware is
    // an operational task, not a principal's).
    'camera.read',
    'ai_events.read',
    'incidents.read',
    'emergency.read',
    'emergency.create',
    'emergency.manage',
    'safety_events.create',
    'safety_events.read',
    'safety_events.manage',
    'geofences.read',
    'safety_rules.read',
    'reports.read',
    'audit_logs.read',
    // Operational alert recipient — see the TRANSPORT_ADMIN note above.
    'notifications.read',
  ],
  // `trips.manage` deliberately excluded — a driver must never manage ANY
  // trip (create/reassign/cancel any trip in the school), only start/complete
  // their OWN assigned one. That narrower capability is enforced by
  // TripsService checking "is this principal the trip's assigned driver" in
  // addition to the `trips.read` permission gate, not by a broader
  // permission grant — see docs/security.md's trips authorization note.
  // (Phase 0's seed granted `trips.manage` here; removed in Phase 1 Step 5
  // while reviewing existing grants, the same kind of gap found and fixed
  // for TRANSPORT_MANAGER in Phase 1 Step 3.)
  // `safety_events.create` added in Phase 2 Step 12 — same "own trip only"
  // scoping philosophy as `emergency.create` (enforced in
  // SafetyEventsService, not by the permission grant alone): a driver can
  // report a MANUAL_ALERT/DRIVER_ALERT for their own currently-assigned
  // trip/bus, never school-wide, and never `safety_events.read`/`.manage`
  // (no browsing other events, no triage authority).
  DRIVER: ['trips.read', 'gps.read', 'emergency.create', 'safety_events.create'],
  // `attendance.read` added in Phase 1 Step 6 while reviewing existing
  // grants — an attendant who manages attendance obviously needs to read
  // the manifest/current state they're managing too (§2.3's matrix already
  // documents "own trip only" for this role; the seed had simply omitted
  // the read grant that scoping depends on).
  BUS_ATTENDANT: ['trips.read', 'attendance.read', 'attendance.manage', 'gps.read', 'emergency.create', 'safety_events.create'],
  SECURITY: [
    'gps.read',
    'camera.read',
    'ai_events.read',
    'ai_events.review',
    'incidents.create',
    'incidents.read',
    'incidents.resolve',
    'emergency.read',
    // Read-only — fits SECURITY's existing broad safety-oversight-without-
    // management posture (camera.read/emergency.read/incidents.read, never
    // the corresponding manage grants).
    'safety_events.read',
    'geofences.read',
    'safety_rules.read',
  ],
  PARENT: [],
} as const;
