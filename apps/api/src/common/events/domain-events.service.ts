import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { DomainEvent } from './domain-event.types';

/**
 * A single, shared in-process event bus (Phase 1 Step 9) — the "clean
 * internal event/notification boundary" between domain services
 * (AttendanceService, TripsService, GpsService) and the notification system,
 * so none of them import or call notification/delivery code directly. Not a
 * distributed event bus/queue — a plain Node `EventEmitter`, the same
 * lightweight technique already used for GpsGateway → ParentGateway
 * (Phase 1 Step 8), generalized into one shared service instead of a
 * bespoke emitter per gateway. See docs/adr/0016-notifications-and-alerts.md.
 *
 * Publishers call `publish()` AFTER their own transaction has committed
 * (matching the existing `auditService.record(...)`-after-`runInTenantContext`
 * pattern already used throughout this codebase) — never from inside the
 * transaction callback — so a slow or throwing subscriber can never roll
 * back or delay the business write itself.
 */
@Injectable()
export class DomainEventsService {
  private readonly logger = new Logger(DomainEventsService.name);
  private readonly emitter = new EventEmitter();

  publish(event: DomainEvent): void {
    this.emitter.emit('domain-event', event);
  }

  /** Subscribers are responsible for their own error handling — a throwing listener must never surface here as an unhandled rejection. */
  subscribe(listener: (event: DomainEvent) => void): void {
    this.emitter.on('domain-event', (event: DomainEvent) => {
      try {
        listener(event);
      } catch (error) {
        this.logger.error(`Unhandled error in domain event subscriber for ${event.type}`, error as Error);
      }
    });
  }
}
