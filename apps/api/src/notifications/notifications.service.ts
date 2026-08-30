import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma, type NotificationEventType } from '@prisma/client';
import type { NotificationDto } from '@school-transport/shared-types';
import { PrismaService } from '../database/prisma.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import type { DomainEvent } from '../common/events/domain-event.types';
import { ParentGateway } from '../parents/parent.gateway';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationTemplates, type NotificationContent } from './notification-templates';

const OPERATIONAL_STAFF_ROLES = ['SCHOOL_ADMIN', 'PRINCIPAL', 'TRANSPORT_ADMIN', 'TRANSPORT_MANAGER'] as const;

interface CreateParams {
  schoolId: string;
  eventType: NotificationEventType;
  entityType: 'ATTENDANCE_EVENT' | 'TRIP' | 'SAFETY_EVENT' | 'EMERGENCY';
  entityId: string;
  recipientType: 'PARENT' | 'USER';
  recipientId: string;
  content: NotificationContent;
  payload: Record<string, string>;
}

/**
 * Consumes `DomainEvent`s (published by AttendanceService/TripsService/
 * GpsService, never called directly by them) and turns the ones with a
 * defined audience into durable, idempotent `Notification` rows — see
 * docs/adr/0016-notifications-and-alerts.md for the full design (recipient
 * policy per event type, the idempotency key, the correction-suppression
 * rule, and why TRIP_STARTED/TRIP_COMPLETED currently produce nothing).
 *
 * Runs entirely outside whatever transaction the originating domain event
 * came from — `DomainEventsService.publish` is only ever called after a
 * domain service's own `runInTenantContext` has already committed, so a
 * failure anywhere in this class can never roll back or block the business
 * write that triggered it.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEvents: DomainEventsService,
    private readonly deliveryService: NotificationDeliveryService,
    private readonly parentGateway: ParentGateway,
  ) {}

  onModuleInit(): void {
    this.domainEvents.subscribe((event) => {
      this.handle(event).catch((error) => this.logger.error(`Failed to process domain event ${event.type}`, error as Error));
    });
  }

  private async handle(event: DomainEvent): Promise<void> {
    switch (event.type) {
      case 'CHILD_BOARDED':
        return this.handleAttendanceEvent(event.schoolId, event.tripId, event.studentId, event.attendanceEventId, 'CHILD_BOARDED');
      case 'CHILD_DROPPED_OFF':
        return this.handleAttendanceEvent(event.schoolId, event.tripId, event.studentId, event.attendanceEventId, 'CHILD_DROPPED_OFF');
      case 'TRIP_CANCELLED':
        return this.handleTripEvent(event.schoolId, event.tripId, 'TRIP_CANCELLED', event.reason);
      case 'TRIP_NO_SHOW':
        return this.handleTripEvent(event.schoolId, event.tripId, 'TRIP_NO_SHOW', event.reason);
      case 'GPS_STALE':
        return this.handleGpsEvent(event.schoolId, event.tripId, event.busId, 'GPS_STALE');
      case 'GPS_OFFLINE':
        return this.handleGpsEvent(event.schoolId, event.tripId, event.busId, 'GPS_OFFLINE');
      case 'TRIP_STARTED':
      case 'TRIP_COMPLETED':
        // Published for future consumers; neither the parent- nor
        // staff-facing audience list calls for a notification on these
        // transitions — see ADR 0016.
        return;
      case 'SAFETY_EVENT_CRITICAL':
        return this.handleSafetyEventCritical(event.schoolId, event.safetyEventId);
      case 'EMERGENCY_CREATED':
        return this.handleEmergencyEvent(event.schoolId, event.emergencyId, 'EMERGENCY_CREATED');
      case 'EMERGENCY_RESOLVED':
        return this.handleEmergencyEvent(event.schoolId, event.emergencyId, 'EMERGENCY_RESOLVED');
    }
  }

  /**
   * Only CRITICAL severity publishes this domain event at all (see
   * SafetyEventsService) — LOW/MEDIUM/HIGH events never reach here, by
   * construction, not by a filter in this class. Staff-only, same
   * recipient list as GPS_STALE/GPS_OFFLINE/trip alerts (ADR 0016/0019).
   */
  private async handleSafetyEventCritical(schoolId: string, safetyEventId: string): Promise<void> {
    const event = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.safetyEvent.findFirst({
        where: { id: safetyEventId },
        select: { type: true, bus: { select: { registrationNumber: true, fleetNumber: true } } },
      }),
    );
    if (!event) return;
    const content = NotificationTemplates.SAFETY_EVENT_CRITICAL({
      eventTypeLabel: event.type.replace(/_/g, ' ').toLowerCase(),
      busDisplayName: event.bus ? this.busDisplayName(event.bus) : '',
    });

    const staffUserIds = await this.resolveOperationalStaffRecipients(schoolId);
    for (const userId of staffUserIds) {
      await this.createIfNew({
        schoolId,
        eventType: 'SAFETY_EVENT_CRITICAL',
        entityType: 'SAFETY_EVENT',
        entityId: safetyEventId,
        recipientType: 'USER',
        recipientId: userId,
        content,
        payload: { safetyEventId },
      });
    }
  }

  private async handleEmergencyEvent(
    schoolId: string,
    emergencyId: string,
    eventType: 'EMERGENCY_CREATED' | 'EMERGENCY_RESOLVED',
  ): Promise<void> {
    const emergency = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.emergency.findFirst({
        where: { id: emergencyId },
        select: { bus: { select: { registrationNumber: true, fleetNumber: true } } },
      }),
    );
    const content = NotificationTemplates[eventType]({
      busDisplayName: emergency?.bus ? this.busDisplayName(emergency.bus) : '',
    });

    const staffUserIds = await this.resolveOperationalStaffRecipients(schoolId);
    for (const userId of staffUserIds) {
      await this.createIfNew({
        schoolId,
        eventType,
        entityType: 'EMERGENCY',
        entityId: emergencyId,
        recipientType: 'USER',
        recipientId: userId,
        content,
        payload: { emergencyId },
      });
    }
  }

  /**
   * Only ever called from `board`/`dropOff` — never from `correct()`. A
   * correction intentionally does not re-publish a domain event at all
   * (see AttendanceService), so there is no path from a correction to a
   * resent "your child boarded" notification, per the spec's explicit
   * instruction not to confuse parents with duplicate boarding messages
   * after a staff correction.
   */
  private async handleAttendanceEvent(
    schoolId: string,
    tripId: string,
    studentId: string,
    attendanceEventId: string,
    eventType: 'CHILD_BOARDED' | 'CHILD_DROPPED_OFF',
  ): Promise<void> {
    const parentIds = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.parentStudent.findMany({ where: { studentId, verified: true }, select: { parentId: true } }),
    );
    const content = NotificationTemplates[eventType]({});
    for (const { parentId } of parentIds) {
      const notification = await this.createIfNew({
        schoolId,
        eventType,
        entityType: 'ATTENDANCE_EVENT',
        entityId: attendanceEventId,
        recipientType: 'PARENT',
        recipientId: parentId,
        content,
        payload: { tripId },
      });
      if (!notification) continue;
      await this.deliverExternalChannels(schoolId, notification.id, parentId, content);
      this.parentGateway.emitNotificationToChild(studentId, this.toClientDto(notification));
    }
  }

  private async handleTripEvent(
    schoolId: string,
    tripId: string,
    eventType: 'TRIP_CANCELLED' | 'TRIP_NO_SHOW',
    reason: string,
  ): Promise<void> {
    const trip = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.trip.findFirst({ where: { id: tripId }, select: { bus: { select: { registrationNumber: true, fleetNumber: true } } } }),
    );
    const busDisplayName = trip ? this.busDisplayName(trip.bus) : 'a bus';

    // Affected parents: verified parents of every non-removed manifest student on this trip.
    const manifest = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.tripStudent.findMany({ where: { tripId, membershipStatus: { not: 'REMOVED' } }, select: { studentId: true } }),
    );
    const studentIds = [...new Set(manifest.map((m) => m.studentId))];
    const parentIds =
      studentIds.length === 0
        ? []
        : await this.prisma.runInTenantContext(schoolId, (tx) =>
            tx.parentStudent.findMany({ where: { studentId: { in: studentIds }, verified: true }, select: { parentId: true } }),
          ).then((rows) => [...new Set(rows.map((r) => r.parentId))]);

    const parentContent = NotificationTemplates[eventType]({ audience: 'PARENT' });
    for (const parentId of parentIds) {
      const notification = await this.createIfNew({
        schoolId,
        eventType,
        entityType: 'TRIP',
        entityId: tripId,
        recipientType: 'PARENT',
        recipientId: parentId,
        content: parentContent,
        payload: { tripId, reason },
      });
      if (!notification) continue;
      await this.deliverExternalChannels(schoolId, notification.id, parentId, parentContent);
      // In-app + REST poll only for trip-level notifications — see the
      // class docstring / ADR 0016 for why realtime push is scoped to the
      // two child-specific attendance events only.
    }

    // Relevant operational staff.
    const staffContent = NotificationTemplates[eventType]({ audience: 'STAFF', busDisplayName });
    const staffUserIds = await this.resolveOperationalStaffRecipients(schoolId);
    for (const userId of staffUserIds) {
      await this.createIfNew({
        schoolId,
        eventType,
        entityType: 'TRIP',
        entityId: tripId,
        recipientType: 'USER',
        recipientId: userId,
        content: staffContent,
        payload: { tripId, reason },
      });
    }
  }

  /**
   * `entityId` is the trip, not the bus — at most one GPS_STALE and one
   * GPS_OFFLINE notification per trip per recipient, even if the bus
   * flickers between freshness states multiple times during that trip
   * (the caller, GpsService, additionally suppresses repeated *attempts*
   * via a Redis marker before this is ever called — this DB constraint is
   * the correctness guarantee, that marker is the performance
   * optimization). See docs/adr/0016.
   */
  private async handleGpsEvent(schoolId: string, tripId: string, busId: string, eventType: 'GPS_STALE' | 'GPS_OFFLINE'): Promise<void> {
    const bus = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.bus.findFirst({ where: { id: busId }, select: { registrationNumber: true, fleetNumber: true } }),
    );
    const busDisplayName = this.busDisplayName(bus);
    const content = NotificationTemplates[eventType]({ busDisplayName });

    const staffUserIds = await this.resolveOperationalStaffRecipients(schoolId);
    for (const userId of staffUserIds) {
      await this.createIfNew({
        schoolId,
        eventType,
        entityType: 'TRIP',
        entityId: tripId,
        recipientType: 'USER',
        recipientId: userId,
        content,
        payload: { busId },
      });
    }
  }

  /** SCHOOL_ADMIN/PRINCIPAL/TRANSPORT_ADMIN/TRANSPORT_MANAGER — the same 4 roles docs/security.md's `notifications.read` grant now covers. Not every staff user, per the spec's explicit instruction. */
  private async resolveOperationalStaffRecipients(schoolId: string): Promise<string[]> {
    const users = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.user.findMany({
        where: { status: 'ACTIVE', userRoles: { some: { role: { key: { in: [...OPERATIONAL_STAFF_ROLES] } } } } },
        select: { id: true },
      }),
    );
    return [...new Set(users.map((u) => u.id))];
  }

  /** Idempotent by construction: the unique constraint absorbs a reprocessed event as a silent no-op, the same pattern GPS telemetry's retry dedup already uses (docs/adr/0014). */
  private async createIfNew(params: CreateParams) {
    return this.prisma.runInTenantContext(params.schoolId, async (tx) => {
      try {
        return await tx.notification.create({
          data: {
            schoolId: params.schoolId,
            eventType: params.eventType,
            entityType: params.entityType,
            entityId: params.entityId,
            recipientType: params.recipientType,
            recipientId: params.recipientId,
            title: params.content.title,
            body: params.content.body,
            payload: params.payload,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return null;
        }
        throw error;
      }
    });
  }

  /**
   * PUSH/SMS/EMAIL for a parent recipient only — staff notifications are
   * in-app only this phase (no staff channel-preference concept exists;
   * see ADR 0016). PUSH has no delivery row at all: no push-token
   * registration flow exists anywhere in this app yet, so there is
   * nothing to send a push notification *to* — the interface/provider
   * (`PUSH_PROVIDER`) is prepared, but genuinely never invoked until a
   * token-registration endpoint exists.
   */
  private async deliverExternalChannels(schoolId: string, notificationId: string, parentId: string, content: NotificationContent): Promise<void> {
    const parent = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.parent.findUnique({ where: { id: parentId }, select: { email: true, phone: true } }),
    );
    if (!parent) return;

    const prefs = await this.prisma.runInTenantContext(schoolId, (tx) => tx.notificationPreference.findMany({ where: { parentId } }));
    const enabledFor = (channel: 'SMS' | 'EMAIL') => prefs.find((p) => p.channel === channel)?.enabled ?? true;

    const targets: Array<{ channel: 'SMS' | 'EMAIL'; to: string | null }> = [
      { channel: 'EMAIL', to: parent.email },
      { channel: 'SMS', to: parent.phone },
    ];

    for (const { channel, to } of targets) {
      if (!to || !enabledFor(channel)) continue;
      const delivery = await this.prisma.runInTenantContext(schoolId, (tx) =>
        tx.notificationDelivery.create({ data: { schoolId, notificationId, channel, status: 'PENDING' } }),
      );
      await this.deliveryService.deliver(schoolId, delivery.id, channel, to, content);
    }
  }

  private busDisplayName(bus: { registrationNumber: string; fleetNumber: string | null } | null): string {
    if (!bus) return 'a bus';
    return bus.fleetNumber ? `Bus ${bus.fleetNumber}` : bus.registrationNumber;
  }

  private toClientDto(row: {
    id: string;
    eventType: string;
    title: string;
    body: string;
    payload: unknown;
    readAt: Date | null;
    createdAt: Date;
  }): NotificationDto {
    return {
      id: row.id,
      eventType: row.eventType as NotificationDto['eventType'],
      title: row.title,
      body: row.body,
      payload: (row.payload as Record<string, string> | null) ?? null,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
