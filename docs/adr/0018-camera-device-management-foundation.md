# ADR 0018: Camera / Device Management Foundation

Status: Accepted
Date: 2026-08-30

## Context

Phase 2 Step 11 is the first Phase 2 (Operational Safety) step: a camera
inventory, bus association, lifecycle, device authentication, and a safe
stream/recording abstraction — explicitly **not** streaming, recording, AI,
facial/behavior recognition, geofencing, or emergency management. The
platform already has a working device-management pattern from Phase 1 Step
7 (GPS): `BusDevice` is a generic device inventory table (`GPS_TRACKER`,
`EDGE_COMPUTER`, `NETWORK_GATEWAY`) with an opaque bearer-credential
mechanism, and `docs/database.md`'s `bus_devices` entry had already
earmarked `CAMERA_CONTROLLER` as a device type "once Phase 2 camera work
actually starts." This step is that start.

## Decision 1: Camera is a thin table layered on `BusDevice`, not a parallel device-identity model

A `Camera` row does **not** duplicate device identity, credentials, or
health tracking. Instead:

- Every `Camera` has a required 1:1 `busDeviceId` pointing at a `BusDevice`
  row with `deviceType: 'CAMERA_CONTROLLER'`.
- The `BusDevice` row supplies, for free, everything device-generic: bearer
  credential issuance/rotation (`credentialHash`/`credentialSetAt`,
  reusing `BusDevicesService.rotateCredential` byte-for-byte —
  `CamerasService.rotateCredential` just resolves the camera's
  `busDeviceId` and delegates), `lastSeenAt`/`lastHealth` (this is the
  *first* real writer of `lastHealth`, previously a reserved-but-unused
  column), `firmwareVersion`, and the external/serial identifier
  (`externalDeviceId`, surfaced to API clients as `CameraDto.serialNumber`
  rather than a second, independent serial-number column).
- `Camera` itself holds only what is genuinely camera-specific: identity/
  labeling (`cameraCode`, `name`, `position`, `customPositionLabel`),
  presentation metadata (`manufacturer`, `model`), the stream protocol
  (`streamType`), and the staff-controlled operational lifecycle
  (`status`).

Rejected alternative: a fully independent `Camera` device-identity/
credential model. This would duplicate the credential generate/hash/
rotate mechanism, the freshness-threshold pattern, and the
`resolveDeviceByCredential`-style guard almost verbatim, for no benefit —
exactly the kind of duplication `docs/database.md`'s own "thin extension of
`bus_devices`" note (written speculatively in Phase 1 Step 3, before this
module existed) already anticipated avoiding.

`schoolId`/`busId` are denormalized directly onto `Camera` (matching
`GpsPoint`'s precedent) rather than requiring a join through `BusDevice`
for RLS/indexing — set once at creation from the device, never
independently client-writable, so the two can never disagree about which
school/bus a camera belongs to.

## Decision 2: A separate device-auth guard, not a shared one with GPS

`GpsService.resolveDeviceByCredential` filters `deviceType: 'GPS_TRACKER'`.
Rather than generalize `DeviceAuthGuard`/`resolveDeviceByCredential` into a
single cross-domain mechanism parameterized by device type,
`CamerasService.resolveDeviceByCredential` + `CameraDeviceAuthGuard` are a
separate, near-identical (~10 line) implementation filtered to
`deviceType: 'CAMERA_CONTROLLER'`. This is a deliberate rejection of a
premature shared abstraction: a GPS tracker's credential must never
authenticate a camera heartbeat (or vice versa), and threading a
`deviceType` parameter through one shared guard/service pair would be more
coupling between two otherwise-independent modules than the small amount
of duplication avoids. If a third device-authenticated capability appears
later, that would be the right time to extract a genuine shared
`DeviceAuthService` — not before.

## Decision 3: `camera.read`/`camera.manage`, never `buses.read`/`buses.manage`

`BusDevicesController` (generic device inventory: GPS/edge/gateway) is
gated by `buses.read`/`buses.manage` — "a device has no lifecycle
independent of the bus it's attached to." Cameras deliberately break this
precedent: `CamerasController` is gated by the pre-existing `camera.read`/
`camera.manage` permission keys (seeded since before this module existed,
per the project's "define the permission now, enforce it when the feature
exists" convention — see ADR 0017's note on `platform.impersonate_school`
for the same pattern). This is intentional, not an oversight: camera
access is a narrower, separately-grantable capability than generic
fleet-device visibility. Proof this distinction is load-bearing, not
cosmetic: `SECURITY` already had `camera.read` seeded with no
`buses.read`/`buses.manage` grant at all, and `DRIVER`/`BUS_ATTENDANT`
(which already have `gps.read`, `buses`-adjacent visibility) are
deliberately never granted `camera.read` — operating a bus is not, by
itself, a reason to see its camera inventory. Reusing `buses.*` would have
made every existing `buses.read` grant silently double as camera
visibility, an unreviewed widening.

Two genuine RBAC gaps were found and fixed while wiring this up (same
class of correction as ADR 0017's SCHOOL_ADMIN/PRINCIPAL notification
gaps): `SCHOOL_ADMIN` had never actually been granted `camera.read`/
`camera.manage` despite having full read+manage on every other fleet
domain (buses/drivers/attendants/routes/trips), and `PRINCIPAL` had never
been granted `camera.read` despite having the equivalent broad
safety-oversight read grant for GPS/incidents/emergency. Both fixed in
`packages/shared-types/src/rbac.ts`.

## Decision 4: No stored "online"/stream-status column

Camera connectivity (`ONLINE`/`STALE`/`OFFLINE`/`UNKNOWN`) is derived at
read time from the linked `BusDevice.lastSeenAt` against two new
configurable thresholds (`CAMERA_LIVE_THRESHOLD_SECONDS`/
`CAMERA_STALE_THRESHOLD_SECONDS`) — the same lazy-freshness pattern GPS
already uses for `BusLocationDto.freshness`, deliberately not stored as an
independently-settable database column. Storing a second "online" flag
that some future code path could write directly would let it drift from
the truth (the actual last-heartbeat time) with no way to tell which one
is right — precisely the "unnecessary state duplication" the step's own
instructions warned against. Camera connectivity uses one extra state
(`OFFLINE`, distinct from `UNKNOWN`) beyond GPS's three-state model: for
hardware fleet management, "reported once, a while ago" (`OFFLINE`) and
"never reported at all" (`UNKNOWN`) are meaningfully different facts (a
never-installed camera vs. one that used to work and stopped), unlike GPS
where both cases are equally "no idea where the bus is."

## Decision 5: Stream and recording are an abstraction with no real backing, by construction

`CameraStreamProvider` (`NotConfiguredCameraStreamProvider` /
`MockCameraStreamProvider`, selected via `CAMERA_STREAM_PROVIDER`,
mirroring Notifications' `NotConfiguredProvider` pattern from ADR 0016) is
the entire streaming surface this phase. `CameraStreamAvailabilityDto`
structurally cannot express "a real, live feed is available" — its
`status` union is `'NOT_CONFIGURED' | 'SIMULATED'` — so a compromised or
buggy frontend has no value to misrepresent as "live." `MOCK` is rejected
outright when `NODE_ENV=production` (extending Phase 1 Step 10's
production-config-validation checks), the same discipline as the GPS dev
simulator. No recording, snapshot, or file-storage functionality was
built: no camera file has ever existed in this codebase to store, so
adding `files`-module wiring now would be exactly the kind of speculative
functionality the project avoids. `docs/database.md §4` still lists
`camera_events`/`ai_events`/`incidents` as outlined-not-built.

## Consequences

- One migration (`20260830140335_phase2_step11_camera_foundation`): three
  new enums (`CameraPosition`, `CameraStatus`, `CameraStreamType`), one new
  `DeviceType` value (`CAMERA_CONTROLLER`), one new table (`cameras`) with
  a plain tenant-scoped RLS policy (no platform-admin bypass clause needed
  — nothing looks up a `Camera` row pre-tenant; heartbeat credential
  resolution queries `bus_devices`, which already carries that clause from
  Phase 1 Step 7).
- No changes to GPS, notifications, trips, attendance, or any other Phase 1
  module's behavior.
- Explicitly out of scope, and not attempted: camera streaming/recording,
  camera-triggered events, any AI processing, MQTT device ingestion
  (heartbeat is HTTP, matching GPS's own Phase 1 scope), geofencing,
  emergency management. These remain Phase 2's later steps or Phase 3.
