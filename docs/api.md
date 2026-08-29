# API Design

Status: Draft v1
Base path: `/api/v1`
Spec format: OpenAPI 3.1, generated from NestJS decorators (`@nestjs/swagger`) and
published at `/api/v1/docs` in non-production environments (disabled or auth-gated
in production).

## 1. Conventions

- **Auth**: `Authorization: Bearer <access_token>` for mobile/API clients, secure
  httpOnly session cookie for the web app. Both resolve to the same
  `AuthenticatedRequest` context. See [authentication.md](authentication.md)
  (to be written alongside auth module implementation).
- **Tenant scoping**: implicit from the authenticated principal — clients never pass
  a `schoolId` to scope a query. `SUPER_ADMIN` platform tools use an explicit
  `X-Target-School-Id` header, validated against a distinct, narrowly-granted
  permission (`platform.impersonate_school`), fully audit-logged.
- **Pagination**: cursor-based — `?limit=25&cursor=<opaque>` — response includes
  `nextCursor: string | null`. Offset pagination is not used (avoids skip/limit
  performance and consistency issues at scale).
- **Filtering/sorting**: `?filter[status]=ACTIVE&sort=-createdAt`.
- **Idempotency**: all unsafe `POST` endpoints that create a resource with real-world
  side effects (trip start, emergency raise, notification dispatch) accept an
  `Idempotency-Key` header; the server deduplicates within a 24h window.
- **Request ID**: server generates/propagates `X-Request-Id`; always present in
  error responses and logs.
- **Errors**: uniform shape —
  ```json
  { "error": { "code": "STUDENT_NOT_FOUND", "message": "Student not found.",
      "requestId": "...", "details": {} } }
  ```
  HTTP status is set conventionally (400/401/403/404/409/422/429/500); `code` is a
  stable machine-readable string clients can branch on, `message` is safe to display.

## 2. Endpoint Groups (MVP)

All routes below are prefixed `/api/v1` and require the listed permission unless
marked public. Full parameter/response schemas live in the generated OpenAPI doc —
this table is the contract summary for planning and review.

### Auth
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | staff/driver/attendant login |
| POST | `/auth/parent/login` | public | separate parent login path (phone/OTP-capable later) |
| POST | `/auth/logout` | authenticated | |
| POST | `/auth/refresh` | authenticated (refresh token) | |
| POST | `/auth/mfa/verify` | authenticated (pending-MFA state) | |
| POST | `/auth/password/forgot` | public | rate-limited |
| POST | `/auth/password/reset` | public (token) | |

### Schools (SUPER_ADMIN + SCHOOL_ADMIN self-service subset)
| Method | Path | Permission |
|---|---|---|
| GET | `/schools` | `platform.schools.read` (SUPER_ADMIN only) |
| POST | `/schools` | `platform.schools.create` |
| GET | `/schools/:id` | `schools.read` |
| PATCH | `/schools/:id` | `schools.update` |

### Users & RBAC
| Method | Path | Permission |
|---|---|---|
| GET | `/users` | `users.read` |
| POST | `/users` | `users.create` |
| PATCH | `/users/:id` | `users.update` |
| DELETE | `/users/:id` | `users.delete` (soft delete) |
| GET | `/roles` | `roles.read` |
| GET | `/permissions` | `roles.read` |
| POST | `/users/:id/roles` | `users.manage_roles` |

### Students / Parents
| Method | Path | Permission |
|---|---|---|
| GET | `/students` | `students.read` |
| POST | `/students` | `students.create` |
| GET | `/students/:id` | `students.read` |
| PATCH | `/students/:id` | `students.update` |
| DELETE | `/students/:id` | `students.delete` |
| GET | `/parents` | `parents.read` |
| POST | `/parents` | `parents.create` |
| POST | `/parents/:id/link-student` | `parents.manage_relationships` | creates unverified `parent_students` row |
| POST | `/parent-students/:id/verify` | `parents.manage_relationships` | school confirms link |

### Buses / Drivers / Attendants
| Method | Path | Permission |
|---|---|---|
| GET/POST | `/buses` | `buses.read` / `buses.manage` |
| PATCH/DELETE | `/buses/:id` | `buses.manage` |
| GET/POST | `/drivers` | `drivers.read` / `drivers.manage` |
| GET/POST | `/attendants` | `attendants.read` / `attendants.manage` |

### Routes / Stops
| Method | Path | Permission |
|---|---|---|
| GET/POST | `/routes` | `routes.read` / `routes.manage` |
| PATCH/DELETE | `/routes/:id` | `routes.manage` |
| GET/POST | `/routes/:id/stops` | `routes.read` / `routes.manage` |

### Trips
| Method | Path | Permission |
|---|---|---|
| GET | `/trips` | `trips.read` (filtered to assigned trip for DRIVER/ATTENDANT) |
| POST | `/trips` | `trips.manage` (create/schedule) |
| GET | `/trips/:id` | `trips.read` |
| POST | `/trips/:id/start` | `trips.manage` (DRIVER: own trip only) |
| POST | `/trips/:id/end` | `trips.manage` (DRIVER: own trip only) |
| GET | `/trips/:id/manifest` | `attendance.read` |

### Attendance
| Method | Path | Permission |
|---|---|---|
| POST | `/trips/:tripId/students/:studentId/events` | `attendance.manage` (ATTENDANT: own trip only) — body: `{eventType, source, metadata?}` |
| GET | `/trips/:tripId/students/:studentId/events` | `attendance.read` |

### GPS / Tracking
| Method | Path | Permission |
|---|---|---|
| POST | `/telemetry/gps` | device credential (see below) — ingestion endpoint, not a user-facing one |
| GET | `/buses/:id/location` | `gps.read` (staff) |
| GET | `/parent/children/:studentId/bus-location` | parent, own child only |
| WS | `/ws/tracking` | staff: subscribe by school/bus; parent: subscribe by own-child's-bus only, server-enforced |

Device ingestion uses a distinct auth mechanism (per-device signed credential /
mTLS client cert in production), never a user session token — see
[gps.md](gps.md) (to be written) and [security.md](security.md).

### Parent Endpoints (dedicated namespace, minimal surface)
| Method | Path | Notes |
|---|---|---|
| GET | `/parent/children` | list own linked+verified children only |
| GET | `/parent/children/:studentId/status` | current trip status + timeline |
| GET | `/parent/children/:studentId/bus-location` | live location + ETA |
| GET | `/parent/notifications` | own notifications |
| PATCH | `/parent/notification-preferences` | own preferences only |

No parent endpoint ever accepts a `busId`, `cameraId`, or `driverId` as a queryable
resource — parents reach bus/location data only transitively through their own
`studentId`, which the backend resolves server-side to the current authorized
bus/trip. This is enforced structurally (the route doesn't exist), not just by a
permission check, per [product-requirements.md](product-requirements.md#5-parent-experience-contract).

### Notifications / Reports / Audit
| Method | Path | Permission |
|---|---|---|
| GET | `/notifications` | `notifications.read` (own school) |
| GET | `/reports/attendance` | `reports.read` |
| GET | `/reports/punctuality` | `reports.read` |
| GET | `/audit-logs` | `audit_logs.read` (PRINCIPAL/SCHOOL_ADMIN/SUPER_ADMIN only) |

### System
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/health/ready` | readiness (DB/Redis reachable) |

## 3. Phase 2/3 Endpoint Groups (outlined, not built yet)

- `/cameras`, `/cameras/:id/health` — `camera.read` / `camera.manage`
- `/ai-events`, `/ai-events/:id/review` — `ai_events.read` / `ai_events.review`
- `/incidents`, `/incidents/:id/resolve` — `incidents.read` / `incidents.create` / `incidents.resolve`
- `/geofences`, `/speed-events` — Phase 2
- `/emergency` (POST, from driver/attendant app) — highest-priority notification fanout

None of these are exposed to the parent namespace, ever (see
[privacy.md](privacy.md)).

## 4. Realtime Contracts

- `/ws/ops` (staff): server pushes `trip.status_changed`, `bus.location_updated`,
  `attendance.exception`, `device.offline`, `ai_event.created` (Phase 3),
  `emergency.raised`.
- `/ws/tracking` (parent, scoped to their child's active trip): server pushes only
  `bus.location_updated` and `trip_student.status_changed` for that student's
  bus/trip — the server computes the subscription scope from the authenticated
  parent's verified relationships, the client cannot request a different scope.

## 5. Versioning

`/api/v1` is additive-evolution: new optional fields and endpoints are added
without a version bump; breaking changes require `/api/v2` with a documented
deprecation window for `/api/v1`, per school contract terms (to be defined by
product/legal, not engineering).
