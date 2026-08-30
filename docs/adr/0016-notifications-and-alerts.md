# ADR 0016: Notifications + Alerts — Event Boundary, Outbox Model, Recipient Policy

Status: Accepted
Date: 2026-08-30

## Context

Phase 1 Step 9 reacts to operational events (a child boarding/dropped off, a
trip cancelled/no-show, a bus's GPS going stale/offline) and delivers the
right notification to the right audience — a parent for child-specific
events, operational staff for fleet-level ones — reliably, without spamming,
and without ever letting a notification failure affect the business
transaction that triggered it. Several previously-scaffolded pieces already
existed (`Notification`/`NotificationPreference` models, `RecipientType`/
`NotificationChannel` enums, `notifications.read`/`notifications.manage`
permissions) but nothing was wired up. Nine decisions needed making.

## Decisions

### 1. A single, shared in-process event bus — not a bespoke emitter per publisher, not a distributed queue

`DomainEventsService` (`apps/api/src/common/events/`, `@Global()` module) is
a plain Node `EventEmitter` wrapped in one injectable service, generalizing
the exact technique Phase 1 Step 8 already used for `GpsGateway` →
`ParentGateway` (a private `EventEmitter` + a public `on...` method) into
one shared bus instead of a new bespoke one per publisher. `AttendanceService`,
`TripsService`, and `GpsService` `publish()` a typed `DomainEvent`
(`apps/api/src/common/events/domain-event.types.ts`) **after** their own
`runInTenantContext` transaction has already committed — the same
"side-effect after commit" shape this codebase already uses for
`auditService.record(...)`. `NotificationsService` is the only subscriber.
No new infrastructure dependency (Kafka/RabbitMQ/a job queue) was
introduced — explicitly out of scope per this phase's instructions, and
unnecessary at this phase's scale.

`DomainEvent` (the internal TS union) is deliberately broader than
`NotificationEventType` (the Prisma enum): `TRIP_STARTED`/`TRIP_COMPLETED`
are published (so lifecycle transitions are always recorded as domain
events, per the spec's "publish on the actual transition" instruction) but
currently map to no notification at all — neither the parent- nor
staff-facing audience list in the spec calls for one on those two
transitions. Keeping them in the internal event taxonomy but out of the DB
enum means a future consumer (e.g., a live trip-board widget) can subscribe
without a schema change, while today's `Notification` table never carries
a row nobody would ever read.

### 2. The Phase 0 scaffold is corrected in place: Notification (logical) + NotificationDelivery (new)

The original `Notification` model conflated "one record" with "one
channel + one delivery status" (a `channel`/`status`/`sentAt` triplet on
the row itself), which cannot represent "this notification was attempted
on two channels with two different outcomes." It's split into:

- **`Notification`** — the durable, logical record: `title`/`body`
  (pre-rendered controlled text), `entityType`/`entityId`, `readAt`, a
  small `payload` pointer. One row per (event, recipient), independent of
  channel.
- **`NotificationDelivery`** (new) — one row per (notification, external
  channel) actually attempted: `status`, `attempts`, `lastAttemptAt`,
  `deliveredAt`/`failedAt`, `failureReason`, `providerMessageId`.

This is the minimum robust model the spec asked for — no third
`OutboxEvent` table was added. The `Notification` row itself **is** the
outbox: it's written durably, in its own transaction, decoupled from the
domain transaction that triggered it (decision 1), and its mere existence
already represents "this operational fact must be told to this recipient,"
independent of whether any external channel ever successfully delivers it.

**IN_APP has no `NotificationDelivery` row at all.** There is nothing to
attempt or track — the `Notification` row's existence already *is* its
in-app delivery, instantaneously and unconditionally. Creating a
`NotificationDelivery(channel=IN_APP, status=DELIVERED)` row for every
notification would be bookkeeping with no informational value.

### 3. Idempotency key: `(schoolId, eventType, entityId, recipientType, recipientId)`

Reprocessing the same domain event for the same recipient is a silent
no-op — the unique constraint absorbs a `P2002` on `Notification.create()`
exactly the way GPS telemetry's retry dedup already works (ADR 0014), not
a pre-check-then-insert race. `entityId` is chosen per event type so the
constraint means "one notification per real-world occurrence":

- `CHILD_BOARDED`/`CHILD_DROPPED_OFF`: the originating `AttendanceEvent`'s
  own id — each boarding/drop-off is already a unique immutable fact
  (ADR 0013), so this needs no extra "occurrence" component.
- `TRIP_CANCELLED`/`TRIP_NO_SHOW`: the `Trip`'s id — a trip can only reach
  either terminal status once (`TripsService`'s own status machine already
  guarantees this).
- `GPS_STALE`/`GPS_OFFLINE`: the **trip's** id, not the bus's — see
  decision 5.

### 4. Corrections never resend a boarding/drop-off notification

`AttendanceService.correct()` does not call `domainEvents.publish(...)` at
all — only `board()`/`dropOff()` do. This is a structural guarantee, not a
runtime check: there is no code path from a correction to a
`CHILD_BOARDED`/`CHILD_DROPPED_OFF` notification, so a parent can never see
"your child boarded" twice because staff fixed a mistake. If corrections
ever need their own distinct notification, that would be a new, explicitly
designed decision — not an accidental resend of the wrong template.

### 5. GPS alert semantics: lazy, read-triggered transition detection — not a background sweep

`GPS_STALE`/`GPS_OFFLINE` represent a **state transition** (LIVE → STALE,
LIVE/STALE → UNKNOWN), reusing the exact freshness levels Phase 1 Step 7
already computes (`GpsService.computeFreshness`) — no second, conflicting
freshness calculation exists. The genuinely hard part: staleness is
*silence* (a bus that stops sending data), which is not something an
ingest-triggered pipeline can ever detect — nothing arrives to trigger an
event. Detecting it requires either a proactive background sweep or
evaluating on read.

**Decision: evaluate on read.** `GpsService.checkFreshnessTransition` runs
inside `readCurrentLocation` — the single method every read path already
calls (staff current-location/fleet reads, parent transport reads,
Phase 1 Step 8). No job/timer/scheduler infrastructure exists in this
codebase, and building one solely for this would be exactly the
over-engineering this phase's instructions warn against. **Accepted
limitation**: a bus nobody is currently viewing won't be proactively
alerted on until the next read of it. A future scheduled sweep (checking
buses with an `IN_PROGRESS` trip on an interval) can layer on top of the
same `checkFreshnessTransition` function without a redesign.

A Redis marker (`school:{id}:bus:{id}:last-notified-freshness`) makes the
common case — nothing changed — a single cheap `GET`, so this never
queries Postgres on every read, only when the marker is actually stale.
Crucially, this marker is a **performance optimization, not the
correctness guarantee**: the `Notification` table's unique constraint
(decision 3) is what actually prevents a duplicate row under a race (e.g.,
two concurrent reads both observing the transition before either updates
the marker). `entityId` is the **trip's** id (not the bus's): at most one
`GPS_STALE` and one `GPS_OFFLINE` notification per trip per recipient, even
if the bus flickers between freshness states multiple times during that
one trip. A transition back to `LIVE` updates the marker (so a later
re-degradation is detected again) but is never itself notified — no
`GPS_RECOVERED` type exists, per the spec's explicit "don't invent alert
types nothing asked for" instruction.

### 6. Recipient resolution

- **`CHILD_BOARDED`/`CHILD_DROPPED_OFF`**: every verified parent linked to
  the student (never assumed to be exactly one).
- **`TRIP_CANCELLED`/`TRIP_NO_SHOW`**: verified parents of every
  non-removed manifest student on that trip, **and** operational staff
  (below) — matching the spec's explicit "affected parents + relevant
  staff" example.
- **`GPS_STALE`/`GPS_OFFLINE`**: operational staff only — never parents,
  per the spec's explicit "GPS_STALE → staff, NOT automatically parents"
  instruction.
- **Operational staff** = active `User`s holding `SCHOOL_ADMIN`,
  `PRINCIPAL`, `TRANSPORT_ADMIN`, or `TRANSPORT_MANAGER` in the event's
  school — resolved by role key, not a new permission (see decision 8).
  Not every staff user; `DRIVER`/`BUS_ATTENDANT` are never notified.

### 7. Delivery: PUSH/SMS/EMAIL are prepared interfaces, never faked

`NotificationChannelProvider` (`apps/api/src/notifications/providers/`)
mirrors the existing `AuthNotificationAdapter` pattern exactly (interface +
DI token + a dev-safe implementation) rather than inventing a new shape.
`NotConfiguredProvider` is bound to all three of `PUSH_PROVIDER`/
`SMS_PROVIDER`/`EMAIL_PROVIDER` — no real vendor (Firebase/Twilio/SendGrid)
is configured or hard-coded. It logs the attempt clearly labeled
unconfigured and returns a distinct terminal `NOT_CONFIGURED` status —
never `SENT`, never a misleading "delivered" state. A real provider is a
new class bound to the same token; no call site changes.

Only **PARENT** recipients ever get PUSH/SMS/EMAIL delivery attempts —
staff notifications are in-app only this phase (no staff channel-preference
concept exists; the spec's "Parent Preferences" section has no staff
analogue). **PUSH is never actually attempted at all**: no push-token
registration flow exists anywhere in this app (no mobile/web push
subscription endpoint), so there is nothing to send a push notification
*to* — the interface is prepared, but wiring it up needs a
token-registration flow that doesn't exist yet.

`NotificationPreference` was simplified from the Phase 0 scaffold's
per-(parent, eventType, channel) shape to a flat per-(parent, channel)
toggle (PUSH/SMS/EMAIL only) — the spec's actual stated minimum, and a
full matrix nobody asked for would be the over-engineering this phase
warns against. **IN_APP is never represented in this table at all** — it
is unconditional for every notification-producing event, so there is no
row to flip that could accidentally suppress a required operational
notification, satisfying the spec's "cannot disable required operational
notifications" instruction structurally rather than via a runtime check
that could be bypassed. A missing preference row defaults to enabled
(opt-out, not opt-in) — sensible since these are transport-safety-adjacent
messages, and harmless today since no channel is actually configured
regardless.

### 8. RBAC: reused, one genuine gap fixed

No new permission was introduced. `notifications.read`/
`notifications.manage` already existed (Phase 0) but only `SCHOOL_ADMIN`
held `notifications.read` — `PRINCIPAL`/`TRANSPORT_ADMIN`/
`TRANSPORT_MANAGER` were missing it despite being exactly the roles the
spec names as GPS/trip alert recipients. Fixed while reviewing existing
grants, the same class of correction as `TRANSPORT_MANAGER`'s fleet
visibility (Step 3) and `bus_devices`' RLS gap (Step 7). Parent
notification access remains fully relationship-based (no permission at
all), matching every other parent endpoint (`docs/security.md §4`).

### 9. Retry: bounded and synchronous — no background job scheduler

`NotificationDeliveryService.deliver` retries within one call, up to
`NOTIFICATION_MAX_DELIVERY_ATTEMPTS` (default 3), with a
`NOTIFICATION_RETRY_BACKOFF_MS` (default 200ms) pause between attempts —
only for a `FAILED` result marked `retryable: true`. There is no
background job/queue that re-attempts a delivery later. This phase has no
real external provider that could produce a genuine async transient
failure to retry in the first place (`NotConfiguredProvider` returns a
terminal `NOT_CONFIGURED` immediately, never `FAILED`) — building a
scheduler solely to retry a provider that doesn't exist yet would be
exactly the over-engineering this phase's instructions warn against. A
future real provider integration can layer async requeue on top of the
same `attempts`/`lastAttemptAt` columns without a model change.

## Consequences

- Attendance/trip/GPS domain services gained exactly one new dependency
  each (`DomainEventsService`) and one `publish()` call per transition —
  no existing method was rewritten, no existing behavior changed.
- A notification failure (a bad email address, a provider outage) can
  never roll back or block the business write that triggered it — the
  domain transaction has already committed by the time
  `NotificationsService` even starts.
- Realtime push (`/realtime/parent`, `parent.notification.created`) is
  scoped to the two child-specific attendance events only — trip-level
  and staff notifications are in-app + REST poll, which the spec itself
  calls an acceptable MVP posture. Extending realtime push to trip-level
  events later means resolving "which child rooms are affected" per
  recipient (a parent can have multiple children on one cancelled trip),
  a design not built here since no test or manual-verification step in
  this phase required it.
- e2e tests directly seed the Redis current-location snapshot to
  deterministically simulate an aged fix (rather than waiting real
  wall-clock time for staleness thresholds to elapse) — this exercises the
  real `readCurrentLocation`/`checkFreshnessTransition` code path, only the
  precondition is seeded directly, the same testing convention every prior
  phase's e2e suite already uses for fixture setup.
