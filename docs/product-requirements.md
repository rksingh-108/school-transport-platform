# Product Requirements — School Transportation Management & Child Safety Platform

Status: Draft v1 (architecture phase)
Owner: Platform Engineering
Last updated: 2026-08-30

## 1. Product Summary

A multi-tenant SaaS platform that lets Indian K-12 schools manage bus transportation
end-to-end: fleet, drivers/attendants, routes, student boarding, live GPS tracking,
parent notifications, and (in later phases) camera-assisted safety monitoring and
incident management. The product is sold to schools/school groups, not to parents or
individual drivers directly — the school is the tenant and the "customer".

This document defines *what* the product does and the boundaries of each user's
access. It is intentionally implementation-agnostic; see [architecture.md](architecture.md)
for how it is built.

## 2. Product Principles (non-negotiable)

1. **Child safety over convenience.** Any feature that trades safety for UX polish is
   rejected. When in doubt, prefer the more conservative behavior (e.g., mark a bus
   offline rather than guess its location).
2. **Privacy-by-design and data minimization.** Every field collected must have a
   named purpose. Parents get outcome data about their own child only, never
   operational/internal data. See [privacy.md](privacy.md).
3. **AI is assistive, not authoritative.** AI never finalizes an incident, never
   labels a child, and never acts on the physical world. A human with the
   `ai_events.review` permission always adjudicates. See [ai-safety.md](ai-safety.md).
4. **Tenant isolation is a backend guarantee, not a UI convention.** No cross-school
   data access is possible regardless of what the frontend renders.
5. **Everything reversible-by-default, audited.** Destructive/administrative actions
   are logged with actor, tenant, timestamp, and reason where applicable.

## 3. Users and Roles

| Role | Description | Typical device |
|---|---|---|
| `SUPER_ADMIN` | Platform operator (us). Manages tenants, plans, platform config. No routine access to student/camera data. | Web |
| `SCHOOL_ADMIN` | School-level administrator. Manages users, students, parents for their school. | Web |
| `TRANSPORT_ADMIN` | Owns transport operations for a school (or school group): buses, drivers, routes. | Web |
| `TRANSPORT_MANAGER` | Day-to-day operator: trips, exceptions, dispatch. | Web |
| `PRINCIPAL` | Read-heavy oversight role: dashboards, reports, incidents. | Web |
| `DRIVER` | Drives an assigned bus, starts/ends trips, raises emergencies. | Mobile |
| `BUS_ATTENDANT` | Rides the bus, confirms boarding/drop-off, raises exceptions. | Mobile |
| `SECURITY` | Reviews AI safety events and incidents; no student academic data. | Web |
| `PARENT` | Views their own child(ren)'s transport status only. | Mobile/Web |

Roles are seed data, not compiled-in constants — see [security.md](security.md) for
the permission model. A school may in future define custom roles composed from the
same permission set; the MVP ships the nine roles above as system-defined roles that
cannot be deleted.

## 4. Functional Scope by Domain

### 4.1 Transport & Fleet
- Onboard/manage schools (tenants), buses, drivers, attendants.
- Assign drivers/attendants to buses; track assignment history.
- Bus metadata: registration number, capacity, make/model, compliance documents
  (permit, insurance, fitness certificate) with expiry tracking.

### 4.2 Routes, Stops, Trips
- Define routes composed of ordered stops with expected arrival offsets.
- A trip is one execution of a route on a given date/shift (morning pickup, afternoon
  drop) by a specific bus/driver/attendant.
- Trip lifecycle: `SCHEDULED → IN_PROGRESS → COMPLETED` (or `CANCELLED`).

### 4.3 Students, Parents, Relationships
- Student is scoped to a school; may be assigned to at most one active route/bus per
  shift.
- Parent accounts can be linked to multiple students (siblings), including across
  schools within the same platform (a parent with kids at two different partner
  schools) — but each link is independently authorized and scoped.
- Parent-student relationship requires school-side verification before granting
  access (prevents self-service impersonation).

### 4.4 Attendance / Boarding
- Event-sourced boarding state machine (see [database.md](database.md#attendance_events)):
  `EXPECTED → BOARDING_PENDING → BOARDED → DROPPED_OFF/ARRIVED_AT_SCHOOL`, with
  `ABSENT` as a terminal alternative to `BOARDED`.
- Sources: attendant manual confirmation (MVP), RFID/NFC card, QR scan, future CV
  detection. All sources normalize to the same event schema.

### 4.5 GPS / Realtime Tracking
- Ingest device telemetry (lat/lon/speed/heading/timestamp/ignition/network state).
- Push live position to authorized school dashboards and to parents of students on
  that specific bus, via WebSocket.
- Detect and surface device offline / stale-fix conditions.

### 4.6 Notifications
- Channel-agnostic notification service (push/SMS/email/in-app) driven by templated
  events, with parent-configurable preferences per event type where the event is
  non-safety-critical.

### 4.7 Control Center (School Ops Dashboard)
- Fleet-wide live map, trip status board, attendance exceptions, delayed buses,
  device/camera health, safety events, incidents, emergency events — filterable by
  route/bus/trip/date/status/severity.

### 4.8 Camera & Device Health (Phase 2)
- Cameras are managed devices bound to a bus with health/heartbeat state. No
  continuous cloud streaming requirement; architecture supports on-demand/event clip
  retrieval.

### 4.9 AI Safety Events & Incidents (Phase 3)
- Objective, behavior-based event taxonomy (never child-identity or character
  judgments). Human-in-the-loop review pipeline: `AI_EVENT → REVIEWED_EVENT →
  CONFIRMED_INCIDENT → RESOLVED_INCIDENT`. See [ai-safety.md](ai-safety.md).

### 4.10 Emergency & Geofencing/Speed (Phase 2)
- Driver/attendant emergency trigger with immediate escalation.
- Geofence definitions (school zone, route corridor) and speed thresholds per
  route/zone with violation events.

### 4.11 Reports & Audit
- Operational reports (attendance, punctuality, incidents, device health) exportable
  per school.
- Immutable audit log of security-relevant and data-access actions.

## 5. Parent Experience (contract)

Parents see, per linked child:
- Current status (`BOARDED`, `ARRIVED_AT_SCHOOL`, `DROPPED_OFF`, etc.)
- Assigned bus (number/identifier only, not driver personal details beyond name)
- Live bus location on a map and ETA to the child's stop
- A same-day timeline of boarding/arrival/drop-off events for their child
- School-approved broadcast notifications

Parents never see: other students, camera feeds/recordings, AI events, incidents,
driver personal/contact data beyond what the school chooses to expose, or any other
bus/route not carrying their child. This is enforced server-side — see
[security.md](security.md#parent-data-access-boundary).

## 6. Out of Scope for MVP

Camera management, AI safety events, incidents, geofencing, speed monitoring,
billing, and public APIs are explicitly deferred to Phase 2+. See
[roadmap.md](roadmap.md). Building them prematurely without real device/camera
integrations to validate against would produce speculative, unverifiable code.

## 7. Success Criteria for MVP

- A school admin can onboard a school, buses, drivers, attendants, routes, stops,
  students, and parents without engineering support.
- A trip can be started, students marked boarded/absent, and completed, with full
  audit history.
- A parent can see their child's live status and bus location for an active trip.
- Cross-tenant and cross-role access attempts are provably rejected (tested).
- The system runs fully locally via Docker Compose with seed data.
