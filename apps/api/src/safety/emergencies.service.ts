import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CursorPage, EmergencyDto } from '@school-transport/shared-types';
import type { AddEmergencyActionInput, CancelEmergencyInput, ListEmergenciesQuery, ResolveEmergencyInput, TriggerEmergencyInput } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';
import { SafetyEventsService } from './safety-events.service';
import { SafetyGateway } from './safety.gateway';

type EmergencyRow = {
  id: string;
  tripId: string | null;
  busId: string | null;
  initiatedBy: string;
  sourceSafetyEventId: string | null;
  status: string;
  severity: string;
  reason: string | null;
  startedAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  initiator: { fullName: string };
  resolver: { fullName: string } | null;
  actions: { id: string; actorId: string; actionType: string; note: string | null; createdAt: Date; actor: { fullName: string } }[];
};

const ROW_INCLUDE = {
  initiator: { select: { fullName: true } },
  resolver: { select: { fullName: true } },
  actions: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { fullName: true } } } },
} satisfies Prisma.EmergencyInclude;

/** ACTIVE is the only non-terminal starting state; RESOLVED/CANCELLED are both terminal. See docs/adr/0019. */
const MANUAL_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ['ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'],
  ACKNOWLEDGED: ['RESOLVED', 'CANCELLED'],
  RESOLVED: [],
  CANCELLED: [],
};

/**
 * "A confirmed operational/safety issue requiring response." See
 * docs/adr/0019-safety-events-and-emergency-management.md. Never
 * physically deletes a row — RESOLVED/CANCELLED are both terminal but
 * preserved indefinitely as operational history.
 */
@Injectable()
export class EmergenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly domainEvents: DomainEventsService,
    private readonly safetyGateway: SafetyGateway,
    @Inject(forwardRef(() => SafetyEventsService)) private readonly safetyEventsService: SafetyEventsService,
  ) {}

  private async resolveOwnCurrentTrip(
    tx: Prisma.TransactionClient,
    principal: AuthenticatedPrincipal,
  ): Promise<{ tripId: string; busId: string } | null> {
    const driver = await tx.driver.findUnique({ where: { userId: principal.id }, select: { id: true } });
    if (driver) {
      const trip = await tx.trip.findFirst({ where: { driverId: driver.id, status: 'IN_PROGRESS' }, select: { id: true, busId: true } });
      return trip ? { tripId: trip.id, busId: trip.busId } : null;
    }
    const attendant = await tx.attendant.findUnique({ where: { userId: principal.id }, select: { id: true } });
    if (attendant) {
      const trip = await tx.trip.findFirst({ where: { attendantId: attendant.id, status: 'IN_PROGRESS' }, select: { id: true, busId: true } });
      return trip ? { tripId: trip.id, busId: trip.busId } : null;
    }
    return null;
  }

  private async isFieldCrew(tx: Prisma.TransactionClient, principal: AuthenticatedPrincipal): Promise<boolean> {
    const driver = await tx.driver.findUnique({ where: { userId: principal.id }, select: { id: true } });
    if (driver) return true;
    const attendant = await tx.attendant.findUnique({ where: { userId: principal.id }, select: { id: true } });
    return !!attendant;
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  async list(principal: AuthenticatedPrincipal, query: ListEmergenciesQuery): Promise<CursorPage<EmergencyDto>> {
    const rows = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.emergency.findMany({
        where: { status: query.status, busId: query.busId, tripId: query.tripId },
        include: ROW_INCLUDE,
        orderBy: { startedAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(rows, query.limit);
    return { data: page.data.map((r) => this.toDto(r)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<EmergencyDto> {
    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.emergency.findFirst({ where: { id }, include: ROW_INCLUDE }));
    if (!row) throw new NotFoundException();
    return this.toDto(row);
  }

  // ---------------------------------------------------------------------
  // Create (direct trigger)
  // ---------------------------------------------------------------------

  /**
   * The emergency-button path. `busId`/`tripId`/`initiatedBy` are never
   * trusted from the client — DRIVER/BUS_ATTENDANT are always scoped to
   * their own currently in-progress trip (auto-filled if omitted, rejected
   * if a supplied value doesn't match); staff may optionally reference any
   * bus/trip in their own tenant, or none at all (an on-campus emergency
   * unrelated to any specific bus is still valid). If a DRIVER/BUS_ATTENDANT
   * has no current trip and none is resolvable, this fails closed with a
   * clear 400 rather than guessing — see ADR 0019.
   */
  async create(principal: AuthenticatedPrincipal, input: TriggerEmergencyInput, meta: RequestMeta): Promise<EmergencyDto> {
    const row = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const { busId, tripId } = await this.resolveAndVerifyScope(tx, principal, input.busId, input.tripId);
      return tx.emergency.create({
        data: {
          schoolId: principal.schoolId,
          busId,
          tripId,
          initiatedBy: principal.id,
          severity: input.severity ?? 'CRITICAL',
          reason: input.reason,
        },
        include: ROW_INCLUDE,
      });
    });

    await this.afterCreate(principal, row, meta);
    return this.toDto(row);
  }

  /**
   * Shared by `create()` (direct trigger) and `SafetyEventsService.escalate()`
   * — both are "an emergency now exists" events with identical audit/
   * notification handling, just a different origin. `resolveAndVerifyScope`
   * is intentionally NOT applied here: an escalation always inherits the
   * originating SafetyEvent's own already-verified bus/trip, never
   * re-resolves the escalating staff member's own trip.
   */
  private async createRow(
    tx: Prisma.TransactionClient,
    principal: AuthenticatedPrincipal,
    params: {
      busId: string | null;
      tripId: string | null;
      sourceSafetyEventId: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      reason: string | null;
    },
  ): Promise<EmergencyRow> {
    return tx.emergency.create({
      data: {
        schoolId: principal.schoolId,
        busId: params.busId,
        tripId: params.tripId,
        initiatedBy: principal.id,
        sourceSafetyEventId: params.sourceSafetyEventId,
        severity: params.severity,
        reason: params.reason,
      },
      include: ROW_INCLUDE,
    });
  }

  /**
   * Called by `SafetyEventsService.escalate()` from within its own
   * transaction — returns the created row so the caller can trigger
   * `afterCreate` once the outer transaction (which also updates the
   * SafetyEvent's own status) has committed. Never audits/publishes here;
   * that only ever happens post-commit (see `afterCreate`).
   */
  async createFromSafetyEvent(
    tx: Prisma.TransactionClient,
    principal: AuthenticatedPrincipal,
    safetyEvent: { id: string; busId: string | null; tripId: string | null; type: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' },
  ): Promise<EmergencyRow> {
    return this.createRow(tx, principal, {
      busId: safetyEvent.busId,
      tripId: safetyEvent.tripId,
      sourceSafetyEventId: safetyEvent.id,
      severity: safetyEvent.severity,
      reason: `Escalated from safety event: ${safetyEvent.type}`,
    });
  }

  /** Audit + notification for a newly-created emergency, always called after its transaction has committed — never from inside one. */
  async afterCreate(principal: AuthenticatedPrincipal, row: EmergencyRow, meta: RequestMeta): Promise<void> {
    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'EMERGENCY_CREATED',
      subjectType: 'Emergency',
      subjectId: row.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { severity: row.severity, sourceSafetyEventId: row.sourceSafetyEventId },
    });
    this.domainEvents.publish({ type: 'EMERGENCY_CREATED', schoolId: principal.schoolId, emergencyId: row.id });
    this.safetyGateway.emitEmergencyCreated(principal.schoolId, this.toDto(row));
  }

  private async resolveAndVerifyScope(
    tx: Prisma.TransactionClient,
    principal: AuthenticatedPrincipal,
    inputBusId: string | undefined,
    inputTripId: string | undefined,
  ): Promise<{ busId: string | null; tripId: string | null }> {
    const isFieldCrew = await this.isFieldCrew(tx, principal);
    if (isFieldCrew) {
      const own = await this.resolveOwnCurrentTrip(tx, principal);
      if (!own) {
        throw new BadRequestException('You have no active trip — an emergency can only be triggered for your current trip.');
      }
      if ((inputBusId && inputBusId !== own.busId) || (inputTripId && inputTripId !== own.tripId)) {
        throw new ForbiddenException('You can only trigger an emergency for your own currently assigned trip/bus.');
      }
      return { busId: own.busId, tripId: own.tripId };
    }

    if (inputBusId) {
      const bus = await tx.bus.findFirst({ where: { id: inputBusId, deletedAt: null }, select: { id: true } });
      if (!bus) throw new NotFoundException('No such bus.');
    }
    if (inputTripId) {
      const trip = await tx.trip.findFirst({ where: { id: inputTripId }, select: { id: true, busId: true } });
      if (!trip) throw new NotFoundException('No such trip.');
      if (inputBusId && trip.busId !== inputBusId) throw new BadRequestException('tripId does not belong to the supplied busId.');
    }
    return { busId: inputBusId ?? null, tripId: inputTripId ?? null };
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  async acknowledge(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<EmergencyDto> {
    const row = await this.transition(principal, id, 'ACKNOWLEDGED', (tx) =>
      tx.emergency.update({ where: { id }, data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() }, include: ROW_INCLUDE }),
    );
    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'EMERGENCY_ACKNOWLEDGED',
      subjectType: 'Emergency',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
    const dto = this.toDto(row);
    this.safetyGateway.emitEmergencyUpdated(principal.schoolId, dto);
    return dto;
  }

  async addAction(principal: AuthenticatedPrincipal, id: string, input: AddEmergencyActionInput, meta: RequestMeta): Promise<EmergencyDto> {
    const row = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const existing = await tx.emergency.findFirst({ where: { id }, select: { id: true, status: true } });
      if (!existing) throw new NotFoundException();
      if (existing.status === 'RESOLVED' || existing.status === 'CANCELLED') {
        throw new BadRequestException(`Cannot add a response action to a ${existing.status.toLowerCase()} emergency.`);
      }
      await tx.emergencyAction.create({
        data: { schoolId: principal.schoolId, emergencyId: id, actorId: principal.id, actionType: input.actionType, note: input.note },
      });
      return tx.emergency.findFirstOrThrow({ where: { id }, include: ROW_INCLUDE });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'EMERGENCY_ACTION_ADDED',
      subjectType: 'Emergency',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { actionType: input.actionType },
    });
    const dto = this.toDto(row);
    this.safetyGateway.emitEmergencyUpdated(principal.schoolId, dto);
    return dto;
  }

  /**
   * If this emergency originated from a SafetyEvent (`sourceSafetyEventId`),
   * that event's status is also flipped ESCALATED → RESOLVED in the same
   * transaction — the one system-driven path for that transition (see
   * SafetyEventsService's docstring). `resolveFromEmergency` bypasses that
   * service's own manual-transition guard by design, since this is not a
   * direct staff action on the SafetyEvent.
   */
  async resolve(principal: AuthenticatedPrincipal, id: string, input: ResolveEmergencyInput, meta: RequestMeta): Promise<EmergencyDto> {
    const row = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const existing = await tx.emergency.findFirst({ where: { id }, select: { id: true, status: true, sourceSafetyEventId: true } });
      if (!existing) throw new NotFoundException();
      if (!MANUAL_TRANSITIONS[existing.status]?.includes('RESOLVED')) {
        throw new BadRequestException(`Cannot resolve an emergency with status ${existing.status}.`);
      }
      if (existing.sourceSafetyEventId) {
        await this.safetyEventsService.resolveFromEmergency(tx, existing.sourceSafetyEventId);
      }
      return tx.emergency.update({
        where: { id },
        data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: principal.id, resolutionNote: input.resolutionNote },
        include: ROW_INCLUDE,
      });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'EMERGENCY_RESOLVED',
      subjectType: 'Emergency',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
    this.domainEvents.publish({ type: 'EMERGENCY_RESOLVED', schoolId: principal.schoolId, emergencyId: id });
    const dto = this.toDto(row);
    this.safetyGateway.emitEmergencyUpdated(principal.schoolId, dto);
    return dto;
  }

  async cancel(principal: AuthenticatedPrincipal, id: string, input: CancelEmergencyInput, meta: RequestMeta): Promise<EmergencyDto> {
    const row = await this.transition(principal, id, 'CANCELLED', (tx) =>
      tx.emergency.update({
        where: { id },
        data: { status: 'CANCELLED', resolvedAt: new Date(), resolvedBy: principal.id, resolutionNote: input.resolutionNote },
        include: ROW_INCLUDE,
      }),
    );
    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'EMERGENCY_CANCELLED',
      subjectType: 'Emergency',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
    const dto = this.toDto(row);
    this.safetyGateway.emitEmergencyUpdated(principal.schoolId, dto);
    return dto;
  }

  private async transition(
    principal: AuthenticatedPrincipal,
    id: string,
    toStatus: string,
    update: (tx: Prisma.TransactionClient) => Promise<EmergencyRow>,
  ): Promise<EmergencyRow> {
    return this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const existing = await tx.emergency.findFirst({ where: { id }, select: { id: true, status: true } });
      if (!existing) throw new NotFoundException();
      if (!MANUAL_TRANSITIONS[existing.status]?.includes(toStatus)) {
        throw new BadRequestException(`Cannot transition an emergency with status ${existing.status} to ${toStatus}.`);
      }
      return update(tx);
    });
  }

  private toDto(row: EmergencyRow): EmergencyDto {
    return {
      id: row.id,
      tripId: row.tripId,
      busId: row.busId,
      initiatedBy: row.initiatedBy,
      initiatedByName: row.initiator.fullName,
      sourceSafetyEventId: row.sourceSafetyEventId,
      status: row.status as EmergencyDto['status'],
      severity: row.severity as EmergencyDto['severity'],
      reason: row.reason,
      startedAt: row.startedAt.toISOString(),
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      resolvedBy: row.resolvedBy,
      resolvedByName: row.resolver?.fullName ?? null,
      resolutionNote: row.resolutionNote,
      actions: row.actions.map((a) => ({
        id: a.id,
        actorId: a.actorId,
        actorName: a.actor.fullName,
        actionType: a.actionType as EmergencyDto['actions'][number]['actionType'],
        note: a.note,
        createdAt: a.createdAt.toISOString(),
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
