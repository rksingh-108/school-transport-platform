/**
 * The internal, in-process domain event taxonomy (Phase 1 Step 9) — the
 * boundary between "something happened in a domain service" and "the
 * notification system reacts to it." Deliberately a TypeScript discriminated
 * union, not a DB enum: some of these (TRIP_STARTED/TRIP_COMPLETED) are
 * published for future consumers but currently produce zero notifications
 * (see NotificationsService) — `NotificationEventType` (the Prisma enum,
 * only the subset that actually creates a `Notification` row) is a
 * deliberately narrower, separate concept. See
 * docs/adr/0016-notifications-and-alerts.md.
 */
export type DomainEvent =
  | { type: 'CHILD_BOARDED'; schoolId: string; tripId: string; studentId: string; attendanceEventId: string }
  | { type: 'CHILD_DROPPED_OFF'; schoolId: string; tripId: string; studentId: string; attendanceEventId: string }
  | { type: 'TRIP_STARTED'; schoolId: string; tripId: string }
  | { type: 'TRIP_COMPLETED'; schoolId: string; tripId: string }
  | { type: 'TRIP_CANCELLED'; schoolId: string; tripId: string; reason: string }
  | { type: 'TRIP_NO_SHOW'; schoolId: string; tripId: string; reason: string }
  | { type: 'GPS_STALE'; schoolId: string; tripId: string; busId: string }
  | { type: 'GPS_OFFLINE'; schoolId: string; tripId: string; busId: string }
  // Phase 2 Step 12. Not every SafetyEvent publishes a domain event — only
  // CRITICAL severity does (see NotificationsService and ADR 0019's
  // anti-notification-storm reasoning), so this is intentionally named for
  // the specific case rather than a generic 'SAFETY_EVENT_CREATED'.
  | { type: 'SAFETY_EVENT_CRITICAL'; schoolId: string; safetyEventId: string }
  | { type: 'EMERGENCY_CREATED'; schoolId: string; emergencyId: string }
  | { type: 'EMERGENCY_RESOLVED'; schoolId: string; emergencyId: string };

export type DomainEventType = DomainEvent['type'];
