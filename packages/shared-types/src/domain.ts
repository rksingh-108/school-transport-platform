import type { RoleKey } from './rbac';

/** Response DTOs — hand-shaped, never a serialized Prisma entity (docs/security.md#5). */

export interface SchoolDto {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'INACTIVE';
  contactEmail: string;
  contactPhone: string | null;
  address: Record<string, unknown> | null;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface StaffDto {
  id: string;
  email: string;
  fullName: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DISABLED';
  roles: RoleKey[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface InvitationDto {
  id: string;
  principalType: 'STAFF' | 'PARENT';
  email: string | null;
  fullName: string;
  invitedByName: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface StudentDto {
  id: string;
  admissionNumber: string;
  fullName: string;
  dateOfBirth: string | null;
  grade: string | null;
  section: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'GRADUATED';
  createdAt: string;
}

export interface ParentDto {
  id: string;
  phone: string;
  email: string | null;
  fullName: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DISABLED';
  createdAt: string;
}

export interface ParentStudentLinkDto {
  id: string;
  studentId: string;
  studentFullName: string;
  relationship: string;
  verified: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

/** Parent-facing shape of their own linked child — never includes school-internal fields. */
export interface ParentLinkedChildDto {
  id: string;
  fullName: string;
  grade: string | null;
  section: string | null;
}

/**
 * `GET /parent/children`'s actual response shape (Phase 1 Step 8) — extends
 * the identity fields above with a per-child transport summary in the same
 * response, so the "My Children" dashboard never needs a follow-up request
 * per child (see docs/adr/0015-parent-transport-tracking.md). `getMyChild`
 * (`GET /parent/children/:studentId`, Phase 1 Step 2) is unrelated to
 * transport and still returns the plain `ParentLinkedChildDto` above.
 */
export interface ParentChildWithTransportDto extends ParentLinkedChildDto {
  transport: ParentChildTransportSummaryDto;
}

export interface BusDto {
  id: string;
  fleetNumber: string | null;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  manufactureYear: number | null;
  capacity: number;
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'RETIRED';
  permitExpiry: string | null;
  insuranceExpiry: string | null;
  fitnessExpiry: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A transport-specific profile layered onto an existing staff User — never a duplicate identity. */
export interface DriverDto {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  licenseNumber: string;
  licenseExpiry: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface AttendantDto {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

/**
 * Never includes the device credential hash. `credentialSetAt` says only
 * *whether/when* a bearer credential was issued (Phase 1 Step 7) — the
 * plaintext token itself is returned exactly once, by
 * `POST /devices/:id/credential`, never by any read endpoint. See
 * docs/security.md#5.1-device-security.
 */
export interface BusDeviceDto {
  id: string;
  busId: string;
  deviceType: 'GPS_TRACKER' | 'EDGE_COMPUTER' | 'NETWORK_GATEWAY';
  externalDeviceId: string;
  firmwareVersion: string | null;
  metadata: Record<string, unknown> | null;
  status: 'ACTIVE' | 'INACTIVE' | 'FAULTY';
  credentialSetAt: string | null;
  lastSeenAt: string | null;
  installedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A device's bearer credential, minted exactly once by
 * `POST /devices/:id/credential`. The raw token is shown to the caller a
 * single time and never persisted anywhere in plaintext (only its SHA-256
 * hash is stored, same pattern as refresh/reset/invitation tokens) — see
 * docs/adr/0014-gps-telemetry-and-realtime-tracking.md.
 */
export interface DeviceCredentialDto {
  deviceId: string;
  token: string;
  issuedAt: string;
}

/** A reusable planned path — never a specific day's execution (that's the future Trip). See docs/database.md §8. */
export interface RouteDto {
  id: string;
  code: string | null;
  name: string;
  direction: 'HOME_TO_SCHOOL' | 'SCHOOL_TO_HOME';
  shift: 'MORNING_PICKUP' | 'AFTERNOON_DROP' | 'CUSTOM';
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  description: string | null;
  stopCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RouteStopDto {
  id: string;
  routeId: string;
  sequenceNo: number;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  expectedOffsetMinutes: number;
  radiusMeters: number;
  mode: 'PICKUP' | 'DROPOFF' | 'BOTH';
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

/**
 * One scheduled/actual execution of a Route — never the Route itself. See
 * docs/adr/0012-trip-stop-snapshot-and-lifecycle.md. `scheduledStartTime`/
 * `scheduledEndTime` are "HH:mm" school-local wall-clock strings, not
 * instants — see the ADR for why. Denormalizes a few display fields
 * (route/bus/driver/attendant names) so the list screen needs no N+1 calls.
 */
export interface TripDto {
  id: string;
  routeId: string;
  routeName: string;
  routeCode: string | null;
  direction: 'HOME_TO_SCHOOL' | 'SCHOOL_TO_HOME';
  busId: string;
  busRegistrationNumber: string;
  busFleetNumber: string | null;
  driverId: string;
  driverName: string;
  attendantId: string | null;
  attendantName: string | null;
  serviceDate: string;
  shift: 'MORNING_PICKUP' | 'AFTERNOON_DROP' | 'CUSTOM';
  scheduledStartTime: string;
  scheduledEndTime: string;
  status: 'SCHEDULED' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  startedAt: string | null;
  endedAt: string | null;
  cancellationReason: string | null;
  notes: string | null;
  studentCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Immutable snapshot of a route stop, taken at Trip creation — never edited afterward. */
export interface TripStopDto {
  id: string;
  tripId: string;
  sourceRouteStopId: string | null;
  sequenceNo: number;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  expectedOffsetMinutes: number;
  mode: 'PICKUP' | 'DROPOFF' | 'BOTH';
  createdAt: string;
}

/**
 * Manifest membership — never inherited from the route, always an explicit
 * row. `currentStatus`/`boardedAt`/`droppedOffAt` are a derived projection
 * fed by AttendanceEvent (Phase 1 Step 6) — the manifest list is the one
 * efficient read for "who's on this trip and what's their current
 * attendance state," with no N+1 needed to also show it.
 */
export interface TripStudentDto {
  id: string;
  tripId: string;
  studentId: string;
  studentFullName: string;
  studentAdmissionNumber: string;
  pickupTripStopId: string | null;
  pickupStopName: string | null;
  dropoffTripStopId: string | null;
  dropoffStopName: string | null;
  membershipStatus: 'PLANNED' | 'ACTIVE' | 'REMOVED';
  notes: string | null;
  currentStatus: 'EXPECTED' | 'BOARDED' | 'ABSENT' | 'DROPPED_OFF';
  /** Always at `pickupStopName` when set — boarding is always recorded at the student's own planned pickup stop. */
  boardedAt: string | null;
  /** Always at `dropoffStopName` when set — drop-off is always recorded at the student's own planned dropoff stop. */
  droppedOffAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One immutable attendance event. Never returned to parents (no parent
 * endpoint reads this model at all yet — see docs/security.md). `notes`,
 * `recordedByName`, and `correctsEventId` are staff-only detail, omitted
 * entirely rather than nulled if a parent-safe DTO is ever built later.
 */
export interface AttendanceEventDto {
  id: string;
  tripId: string;
  tripStudentId: string;
  eventType: 'BOARDING_CONFIRMED' | 'MARKED_ABSENT' | 'DROPPED_OFF';
  source: 'ATTENDANT_APP';
  tripStopId: string | null;
  tripStopName: string | null;
  occurredAt: string;
  recordedByName: string | null;
  correctsEventId: string | null;
  notes: string | null;
  createdAt: string;
}

/**
 * A bus's live/last-known position (Phase 1 Step 7). Backed by Redis for
 * fast reads with a Postgres fallback after a cold start — see
 * docs/adr/0014-gps-telemetry-and-realtime-tracking.md. When a bus has never
 * reported, every location field is `null` and `freshness` is `'UNKNOWN'`;
 * this is never returned to parents in this phase (no parent GPS endpoint
 * exists yet — docs/privacy.md).
 */
export interface BusLocationDto {
  busId: string;
  busRegistrationNumber: string;
  busFleetNumber: string | null;
  tripId: string | null;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number | null;
  heading: number | null;
  accuracyM: number | null;
  /** The device's own clock reading for this fix ("recordedAt" in the API). */
  recordedAt: string | null;
  /** Server-controlled — when this fix was actually received. */
  receivedAt: string | null;
  freshness: 'LIVE' | 'STALE' | 'UNKNOWN';
  /** BusDevice.lastSeenAt — distinct from `recordedAt`: a device can be "seen" (any ingest attempt) without that fix becoming the current location (see the monotonic-timestamp rule in the ADR). */
  deviceLastSeenAt: string | null;
}

/** One historical telemetry row. Never includes `deviceId` — the dashboard's history view has no use for it, and omitting it costs nothing. */
export interface GpsPointDto {
  id: string;
  busId: string;
  tripId: string | null;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyM: number | null;
  recordedAt: string;
  receivedAt: string;
}

/**
 * The realtime event contract (`bus.location.updated`) emitted over the
 * Socket.IO fleet-tracking gateway — identical shape to the pieces of
 * `BusLocationDto` a live subscriber actually needs, so the frontend can
 * reuse one renderer for both the initial REST fetch and realtime pushes.
 * Never includes device secrets, internal DB ids, or other-tenant data —
 * the gateway only ever emits into the caller's own school's room(s).
 */
export interface BusLocationUpdatedEvent {
  busId: string;
  tripId: string | null;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyM: number | null;
  recordedAt: string;
  receivedAt: string;
  freshness: 'LIVE' | 'STALE' | 'UNKNOWN';
}

/** The four attendance states a parent may ever see — never the full internal event history, corrections, or who recorded it (docs/security.md#9-parent-transport-boundary). */
export type ParentAttendanceStatus = 'EXPECTED' | 'BOARDED' | 'ABSENT' | 'DROPPED_OFF';
export type ParentTripStatus = 'SCHEDULED' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

/**
 * A lightweight per-child transport summary (Phase 1 Step 8) — attached to
 * every entry in `GET /parent/children` so the "My Children" dashboard never
 * needs a follow-up request per child. Deliberately excludes coordinates
 * (the full location detail lives in `ParentTransportDto`, fetched only for
 * the child a parent has actually opened) — `freshness` alone is enough for
 * a summary card. `null` fields mean "no relevant trip/attendance/bus today"
 * (see docs/adr/0015-parent-transport-tracking.md), never a fabricated value.
 */
export interface ParentChildTransportSummaryDto {
  tripStatus: ParentTripStatus | null;
  attendanceStatus: ParentAttendanceStatus | null;
  busDisplayName: string | null;
  /** Only meaningful while `tripStatus === 'IN_PROGRESS'` — `null` otherwise, never a stale leftover value from an earlier trip. */
  freshness: 'LIVE' | 'STALE' | 'UNKNOWN' | null;
}

/**
 * The full parent-safe transport view for one child
 * (`GET /parent/children/:studentId/transport`). A deliberately hand-built
 * DTO, never a passthrough of `TripDto`/`TripStudentDto`/`BusLocationDto` —
 * see docs/adr/0015-parent-transport-tracking.md for exactly which internal
 * fields were excluded and why (device IDs, driver/attendant identity,
 * school/tenant IDs, raw telemetry history, correction/audit metadata).
 * `trip`/`attendance`/`bus` are `null` together when no trip is relevant to
 * this child today; `location` is `null` whenever `trip.status` isn't
 * `'IN_PROGRESS'` — a parent is never shown a location for a trip that
 * hasn't started or has already ended.
 */
export interface ParentTransportDto {
  child: { id: string; fullName: string; grade: string | null; section: string | null };
  trip: {
    id: string;
    status: ParentTripStatus;
    direction: 'HOME_TO_SCHOOL' | 'SCHOOL_TO_HOME';
    scheduledStartTime: string;
    scheduledEndTime: string;
  } | null;
  bus: { displayName: string } | null;
  attendance: {
    status: ParentAttendanceStatus;
    boardedAt: string | null;
    droppedOffAt: string | null;
  } | null;
  location: {
    latitude: number | null;
    longitude: number | null;
    speedKmh: number | null;
    heading: number | null;
    lastUpdatedAt: string | null;
    freshness: 'LIVE' | 'STALE' | 'UNKNOWN';
  } | null;
}

/**
 * The parent-safe realtime event (`parent.child.transport.updated`,
 * `/realtime/parent` namespace) — pushed only into a room scoped to one
 * verified child (`parent:child:{studentId}`), never a bus- or school-wide
 * room. Triggered by the same GPS-ingestion pipeline as the staff
 * `bus.location.updated` event (see the gateway's internal hook in
 * ADR 0015), so the payload always reflects live trip/attendance state
 * alongside the location, not just the location. No `deviceId`/`schoolId`/
 * `driverId`/`attendantId`/raw telemetry — same exclusions as
 * `ParentTransportDto`.
 */
export interface ParentChildTransportUpdatedEvent {
  childId: string;
  tripStatus: ParentTripStatus;
  attendanceStatus: ParentAttendanceStatus;
  busDisplayName: string;
  location: {
    latitude: number;
    longitude: number;
    speedKmh: number | null;
    heading: number | null;
    freshness: 'LIVE' | 'STALE' | 'UNKNOWN';
  };
  lastUpdatedAt: string;
}
