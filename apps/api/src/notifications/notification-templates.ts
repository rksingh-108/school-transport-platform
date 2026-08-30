import type { NotificationEventType } from '@prisma/client';

/**
 * The single source of truth for notification wording (Phase 1 Step 9) —
 * no domain service, controller, or the frontend ever assembles
 * notification text itself, and no client-supplied text can become a
 * system notification (there is no such input anywhere in the API). Kept
 * centralized specifically so localization can be added later in one
 * place, per the spec's explicit instruction, rather than a full i18n
 * system being built now.
 *
 * Parent-facing templates use plain, non-technical language — no
 * `deviceId`/`TripStudent`/internal ids/staff names ever appear. Staff
 * templates may reference a bus display name (never an internal id) since
 * that's genuinely operationally useful and staff already see it elsewhere
 * (Phase 1 Step 7).
 */
export interface NotificationContent {
  title: string;
  body: string;
}

export const NotificationTemplates: Record<NotificationEventType, (ctx: Record<string, string>) => NotificationContent> = {
  CHILD_BOARDED: () => ({
    title: 'Child boarded',
    body: 'Your child has boarded the school bus.',
  }),
  CHILD_DROPPED_OFF: () => ({
    title: 'Child dropped off',
    body: 'Your child has been dropped off.',
  }),
  TRIP_CANCELLED: (ctx) => ({
    title: 'Trip cancelled',
    body: ctx['audience'] === 'STAFF' ? `A trip on ${ctx['busDisplayName']} was cancelled.` : "Today's school bus trip has been cancelled.",
  }),
  TRIP_NO_SHOW: (ctx) => ({
    title: 'Trip did not run',
    body:
      ctx['audience'] === 'STAFF'
        ? `A scheduled trip on ${ctx['busDisplayName']} was marked as a no-show.`
        : "Today's school bus trip did not run as scheduled.",
  }),
  GPS_STALE: (ctx) => ({
    title: 'Bus location is stale',
    body: `${ctx['busDisplayName']} has not reported a fresh GPS position recently.`,
  }),
  GPS_OFFLINE: (ctx) => ({
    title: 'Bus location unavailable',
    body: `${ctx['busDisplayName']} has not reported any GPS position for a while and appears offline.`,
  }),
  SAFETY_EVENT_CRITICAL: (ctx) => ({
    title: 'Critical safety event reported',
    body: `A critical ${ctx['eventTypeLabel']} safety event was reported${ctx['busDisplayName'] ? ` on ${ctx['busDisplayName']}` : ''}. Review it now.`,
  }),
  EMERGENCY_CREATED: (ctx) => ({
    title: 'Emergency reported',
    body: `An emergency was reported${ctx['busDisplayName'] ? ` on ${ctx['busDisplayName']}` : ''}. Immediate attention required.`,
  }),
  EMERGENCY_RESOLVED: (ctx) => ({
    title: 'Emergency resolved',
    body: `The emergency reported${ctx['busDisplayName'] ? ` on ${ctx['busDisplayName']}` : ''} has been marked resolved.`,
  }),
};
