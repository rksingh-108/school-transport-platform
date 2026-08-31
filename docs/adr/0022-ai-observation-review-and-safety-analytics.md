# ADR 0022: AI Observation Review, Safety-Event Linkage, and Safety Analytics

Status: Accepted
Date: 2026-08-31

## Context

Phase 3 Step 15 is the final planned implementation step. Step 14 built the
edge-AI pipeline foundation — device auth, the model registry,
`AIObservation` ingestion — but every observation stopped at `CANDIDATE`
forever, since Step 14 explicitly deferred any promotion/review workflow.
This step connects `AIObservation` to the existing `SafetyEvent`/
`Emergency` machinery built in Phase 2 Steps 12-13, adds a per-school
policy layer controlling what's promotable, and adds the first real
operational safety analytics. The most important constraint, repeated
throughout the step's own instructions, is architectural, not incidental:
**AI must never autonomously create a SafetyEvent or Emergency** — every
promotion is gated behind an explicit, authenticated staff action.

## Decision 1: Promotion is a human-gated state transition, never an automatic side effect of ingestion

`AIObservation.status` gains three real endpoints —
`POST /ai-observations/:id/{review,dismiss,promote}` — and no others.
`AiObservationsService.ingest()` (Step 14) is completely unaware that
review/promotion exists; it has zero code path that could ever set a
status other than `CANDIDATE` or invoke `SafetyEventsService`. This is a
structural guarantee, not a policy one: there is no configuration flag,
confidence threshold, or detection type that causes an observation to
promote itself. The state machine is:

```
CANDIDATE ──review──▶ REVIEWED
CANDIDATE ──dismiss──▶ DISMISSED (terminal)
CANDIDATE ──promote──▶ PROMOTED (terminal)
REVIEWED ──dismiss──▶ DISMISSED (terminal)
REVIEWED ──promote──▶ PROMOTED (terminal)
```

`REVIEWED` is optional, not a mandatory gate in front of dismiss/promote —
a reviewer who has already made up their mind about a clear-cut detection
isn't forced through an extra click. `DISMISSED`/`PROMOTED` are terminal:
no endpoint ever moves an observation out of either.

## Decision 2: `SafetyEvent.sourceAiObservationId` is the link, `source: 'AI'` is real and was pre-reserved

`SafetyEventSource` gained one new value, `AI`. This was not a new
decision made casually — the enum's own comment since Phase 2 Step 12 read
*"AI is deliberately NOT a value here yet — Phase 3's AI integration will
add it (and only it) to this enum... not before"*. This step is that
moment, and `AI` is the only value added, exactly as anticipated. It is
set in exactly one place, `SafetyEventsService.createRowFromAiObservation`,
called only from `AiObservationsService.promote()`.

`sourceAiObservationId` (nullable, `@unique`) lives on `SafetyEvent`,
mirroring `Emergency.sourceSafetyEventId`'s exact shape from ADR 0019 — the
"promoted-into" row points back at its origin, never the reverse owning a
foreign key. The `@unique` constraint is deliberate and load-bearing, not
incidental: it is the database-level guarantee that one `AIObservation` can
never produce two `SafetyEvent` rows, which is also this step's entire
concurrency/idempotency mechanism (Decision 7).

`createdBy` on the resulting `SafetyEvent` is the **reviewer's** id, not
null and not some synthetic "AI" actor — `source` and `createdBy` answer
different questions. `source: 'AI'` describes what originally produced the
underlying signal (an edge-device detection); `createdBy` describes who is
accountable for the SafetyEvent record actually existing (the staff member
who reviewed the evidence and chose to promote it). Collapsing these into
one field would either falsely credit a human with detecting the fall, or
falsely imply the AI created the event unsupervised — neither is accurate.

## Decision 3: The detection-type → SafetyEvent-type mapping is a fixed, hardcoded, documented table — never school-configurable

`AI_DETECTION_TO_SAFETY_EVENT_TYPE` (`apps/api/src/ai-observations/policies/ai-safety-policy.constants.ts`)
maps each of the eight `AIDetectionType` values to an **existing**
`SafetyEventType` — no new SafetyEvent type was invented for this step.
`FALL_DETECTED → MEDICAL`, `SMOKE_DETECTED`/`FIRE_DETECTED → SMOKE_FIRE`,
`DOOR_STATE_DETECTED → DOOR_OPEN`, and the four ambiguous/non-hazard types
(`PERSON_DETECTED`, `PERSON_COUNT`, `OBJECT_DETECTED`, `UNUSUAL_MOTION`)
all map to `OTHER` — a real, existing catch-all, not a new "AI_OTHER"
type. This mapping is intentionally NOT part of the per-school policy
table (Decision 4): what *kind* of safety condition a fall represents is
not a school's operational decision to make, whereas whether that
detection type should be promotable at all, and at what confidence, is.

## Decision 4: `AiSafetyPolicy` is tenant-scoped (unlike the platform-wide `AIModel` registry), and controls promotability + confidence + severity — never a JSON rules blob

`AiSafetyPolicy` has typed columns (`detectionType`, `enabled`,
`minimumConfidence`, `defaultSeverity`, `requiresHumanReview`) unique per
`(schoolId, detectionType)` — the same "typed configuration, not a generic
rules engine" discipline `SafetyRule` established in
[ADR 0020](0020-geofencing-and-operational-safety-rules.md). Unlike
`AIModel` ([ADR 0021](0021-edge-ai-computer-vision-pipeline-foundation.md)
Decision 5), this table IS tenant-scoped: whether FALL_DETECTED should be
promotable, and at what confidence bar, is a genuine per-school
operational decision (a school running a stricter safety program may want
a lower bar; one with more sensitive cameras may want a higher one),
whereas a model artifact is a shared platform asset with no such
per-school dimension.

`enabled` is toggled only via dedicated `POST .../enable`/`.../disable`
endpoints, never a generic `PATCH` — `PATCH` structurally excludes both
`detectionType` and `enabled` (mirrors `SafetyRule`'s exact convention).
`requiresHumanReview` is a real, stored, settable field, but — this is
worth stating plainly — **no code path in this codebase ever reads it to
skip review**. There is no "auto-promote" pipeline for this field to gate;
Decision 1's structural guarantee means every promotion is human-gated
regardless of this field's value. It exists for schema completeness and
honest future extensibility (a school administrator configuring policy
should be able to express and audit this intent even though the system
doesn't yet act on `false` any differently from `true`), not because
setting it to `false` currently changes runtime behavior. This is
explicitly documented on the schema field itself so a future engineer
doesn't assume it does something it doesn't.

## Decision 5: Conservative, hardcoded system defaults when a school has no policy row — never "anything goes"

`SYSTEM_DEFAULT_AI_SAFETY_POLICY` provides a fallback for every detection
type. The four "not inherently indicative of a safety condition" types
(`PERSON_DETECTED`, `PERSON_COUNT`, `OBJECT_DETECTED`) default to
`enabled: false` — a school must explicitly opt in before these can ever
be promoted, since a person being detected on a school bus is the expected
case, not a safety signal. The four genuine hazard/condition types
(`FALL_DETECTED`, `SMOKE_DETECTED`, `FIRE_DETECTED`, `DOOR_STATE_DETECTED`)
and `UNUSUAL_MOTION` default to `enabled: true` with confidence bars
between 0.70 and 0.85 (higher for the two fire/smoke types, which use
`CRITICAL` default severity) — genuinely useful out of the box without a
school having to configure anything, while still requiring the same
mandatory human review as every other path. A missing policy row is never
treated as "auto-emergency" or "always promotable" — it resolves to
exactly these hardcoded, reviewed defaults, per the step's own explicit
"never silently treat missing configuration as automatic emergency"
instruction.

## Decision 6: Severity is never derived from confidence alone

`AiSafetyPolicy.defaultSeverity` is a fixed value per detection type, set
by a human when configuring the policy — it does not scale with the
observation's `confidence` score. A reviewer may optionally override it at
promotion time (`PromoteAiObservationInput.severity`), since they have
just looked at the actual evidence and may judge it more or less urgent
than the school's static default; omitting it uses the policy default.
Confidence remains, as established in
[ADR 0021](0021-edge-ai-computer-vision-pipeline-foundation.md) Decision
11, a statement about the model's certainty in the detection — never a
proxy for how severe or urgent the underlying situation is.

## Decision 7: Concurrency and idempotency are guaranteed by the database, not application-level locking

`promote()` runs the `SafetyEvent` insert and the `AIObservation` status
update inside a single Prisma transaction. If two staff members
simultaneously promote the same observation, both transactions attempt to
insert a `SafetyEvent` with the same `sourceAiObservationId` — the
`@unique` constraint (Decision 2) means only one can ever commit; the
loser's transaction fails on a Postgres unique-violation, which
`AiObservationsService.promote()` translates into a clean `400`
("already been promoted"), never a 500 and never a silently-duplicated
event. No advisory lock, no `SELECT ... FOR UPDATE`, and no application-
level mutex were needed — the same `create-then-catch-P2002` idiom already
used for GPS dedup (ADR 0014) and AI-observation temporal aggregation
(ADR 0021) extended to a genuinely different purpose (correctness under
concurrency, not "same data resent").

## Decision 8: Failure leaves no partial state, by construction

If the `SafetyEvent` insert fails for any reason inside `promote()`'s
transaction, the whole transaction rolls back — the `AIObservation` is
never left marked `PROMOTED` without a corresponding `SafetyEvent`
existing, because both writes are the same atomic unit. Audit, the
`SAFETY_EVENT_CRITICAL` domain-event publish, and the realtime emit all
happen strictly *after* that transaction has committed
(`SafetyEventsService.afterAiPromotion`, mirroring
`EmergenciesService.afterCreate`'s established "DB write, then post-commit
side effects" split) — a failure in any of those (e.g., a notification
provider being unavailable) can never roll back or invalidate the already-
committed `SafetyEvent`/`AIObservation` state, matching the same
"notification failure must never undo a real operational record" principle
already established for every prior safety-domain write in this codebase.

## Decision 9: Notifications and realtime are the EXISTING SafetyEvent pipeline, verbatim — no second system

An AI-promoted `SafetyEvent` flows through the identical
`CRITICAL`-severity-only notification trigger and `/realtime/safety`
`safety.event.created` emission every other `SafetyEvent` already uses
(Phase 2 Step 12) — `SafetyEventsService.afterAiPromotion` calls the exact
same `domainEvents.publish`/`safetyGateway.emitSafetyEventCreated` methods
`create()`/`createSystemEvent()` already call. There is no
`/realtime/ai-observations`-to-`/realtime/safety` bridge to build and no
new notification event type — `SAFETY_EVENT_CRITICAL` already fires
regardless of a `SafetyEvent`'s `source`. Parents receive nothing from
this path, exactly as they receive nothing from any other `SafetyEvent`
source.

## Decision 10: Analytics is read-only, aggregated-only, database-side aggregation, tenant-scoped, and time-bounded

`GET /analytics/safety` (`SafetyAnalyticsService`) never returns raw
`AIObservation`/`SafetyEvent` rows — only counts, group-bys, and a daily
trend. Every aggregate is computed in Postgres (`COUNT`, `groupBy`, or a
parameterized `Prisma.sql` raw query for the timezone-aware daily
bucketing `groupBy` can't express) — the service never loads a full table
into Node.js and reduces it there. The query's `from`/`to` range is capped
at 90 days by Zod (`safetyAnalyticsQuerySchema`), so even a worst-case
query touches a bounded slice of data. The one exception —
`averageReviewTimeSeconds`, computed from a `findMany` of just the
`occurredAt`/`reviewedAt` columns for reviewed rows in range — is still
bounded by the same validated date range, never "every observation ever."
The whole read runs inside `runInTenantContext`, so it is exactly as
tenant-isolated as every other query in this codebase; a bug here can
never affect GPS ingestion, attendance, or SafetyEvent creation, since the
module is entirely read-only and imports no write path.

Daily-trend day boundaries use the school's own `School.timezone` (via
`(occurred_at AT TIME ZONE $timezone)::date` in the raw query) — the same
timezone-awareness principle `ParentTransportService.todayInTimezone`
already established for "today" in Phase 1 Step 8, extended here to a
date-range bucketing context. A UTC calendar day and a school's local
calendar day are not the same thing, and conflating them would make the
daily trend chart visibly wrong near midnight in most of this platform's
deployment regions.

"Promotion rate"/"dismissal rate" are named exactly that, never "accuracy"
— human review is a judgment call about operational risk, not a scientific
ground-truth labeling exercise, and calling it "accuracy" would imply a
kind of validation this data was never designed to support.

## Decision 11: `ai_events.review` (reserved since Phase 0) gates all three review actions; new `ai_safety_policies.*` and `safety_analytics.read` follow established split conventions

Reviewing/dismissing/promoting individual observations reuses the
pre-existing `ai_events.review` permission — reserved since before this
codebase had any AI feature, clearly intended for exactly this "a human
reviews an AI-flagged item" action. Configuring the *policy* that governs
what's promotable is a separate, narrower-audience capability
(`ai_safety_policies.read`/`.manage`), mirroring the
`geofences.*`-vs-`safety_rules.*` split from
[ADR 0020](0020-geofencing-and-operational-safety-rules.md) exactly.
Analytics gets its own `safety_analytics.read` rather than reusing
`reports.read` (whose grantees don't include `SECURITY`, which has a
legitimate interest here) or `ai_events.read` (analytics returns
aggregates, a meaningfully different capability from browsing individual
observations). `DRIVER`/`BUS_ATTENDANT` are granted none of the three —
no broad AI review/policy/analytics surface for either role, per the
step's explicit instruction.

## Consequences

- One migration
  (`20260830235141_phase3_step15_ai_review_and_safety_analytics`) adds the
  `AI` enum value, `SafetyEvent.sourceAiObservationId`,
  `AIObservation.reviewedBy`/`reviewedAt`/`reviewNote`, and the
  `ai_safety_policies` table with its own `tenant_isolation` RLS policy.
- No existing `SafetyEvent`/`Emergency` endpoint, state machine, or
  notification/realtime behavior changed — every new capability is
  additive, reusing the exact same service methods, gateway, and audit
  infrastructure Steps 12-13 already built.
- Explicitly out of scope and not attempted, per the step's own boundary:
  any automatic Emergency creation from a promoted event (escalation
  remains the existing explicit human action from Step 12), real facial/
  behavioral/identity recognition of any kind, raw video/snapshot storage,
  and a route-level analytics breakdown (bus-level was judged sufficient
  for this step's operational analytics; adding route requires a join
  through `Trip` this step deliberately trimmed for scope, not because it
  is technically difficult).
