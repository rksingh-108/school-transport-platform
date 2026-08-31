import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CursorPage, SafetyEventDto } from '@school-transport/shared-types';
import type { CreateSafetyEventInput, DismissSafetyEventInput, ListSafetyEventsQuery, ResolveSafetyEventInput } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';
import { EmergenciesService } from './emergencies.service';
import { SafetyGateway } from './safety.gateway';

type SafetyEventRow = {
  id: string;
  busId: string | null;
  tripId: string | null;
  cameraId: string | null;
  type: string;
  severity: string;
  status: string;
  source: string;
  occurredAt: Date;
  detectedAt: Date;
  description: string | null;
  metadata: Prisma.JsonValue;
  createdBy: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  resolutionNote: string | null;
  sourceAiObservationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  creator: { fullName: string } | null;
  reviewer: { fullName: string } | null;
  emergency: { id: string } | null;
};

const ROW_INCLUDE = {
  creator: { select: { fullName: true } },
  reviewer: { select: { fullName: true } },
  emergency: { select: { id: true } },
} satisfies Prisma.SafetyEventInclude;

type AiPromotionParams = {
  schoolId: string;
  busId: string;
  tripId: string | null;
  cameraId: string;
  type: SafetyEventDto['type'];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  metadata?: Record<string, unknown>;
  createdBy: string;
  sourceAiObservationId: string;
};

/** Only these transitions are reachable through a direct staff endpoint call — see the class docstring below and ADR 0019. */
const MANUAL_TRANSITIONS: Record<string, string[]> = {
  NEW: ['ACKNOWLEDGED', 'DISMISSED', 'ESCALATED', 'RESOLVED'],
  ACKNOWLEDGED: ['DISMISSED', 'ESCALATED', 'RESOLVED'],
  DISMISSED: [],
  ESCALATED: [],
  RESOLVED: [],
};

/**
 * "A potentially relevant safety observation occurred" — see
 * docs/adr/0019-safety-events-and-emergency-management.md for the full
 * SafetyEvent-vs-Emergency separation and state machine. `ESCALATED →
 * RESOLVED` is a real, valid transition, but is reachable ONLY as a
 * side-effect of `EmergenciesService.resolve()` on the emergency this event
 * escalated into (`resolveFromEmergency` below) — never through a direct
 * `POST /safety-events/:id/resolve` call, which is why `MANUAL_TRANSITIONS`
 * above excludes it: once escalated, the Emergency is the live record.
 */
@Injectable()
export class SafetyEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly domainEvents: DomainEventsService,
    private readonly safetyGateway: SafetyGateway,
    @Inject(forwardRef(() => EmergenciesService)) private readonly emergenciesService: EmergenciesService,
  ) {}

  // ---------------------------------------------------------------------
  // Own-scope resolution (DRIVER/BUS_ATTENDANT) — same profile-based
  // pattern as GpsService.resolveGpsScope / TripsService.assertCanOperate.
  // ---------------------------------------------------------------------

  private async resolveOwnCurrentTrip(
    tx: Prisma.TransactionClient,
    principal: AuthenticatedPrincipal,
  ): Promise<{ source: 'DRIVER' | 'ATTENDANT'; tripId: string; busId: string } | null> {
    const driver = await tx.driver.findUnique({ where: { userId: principal.id }, select: { id: true } });
    if (driver) {
      const trip = await tx.trip.findFirst({ where: { driverId: driver.id, status: 'IN_PROGRESS' }, select: { id: true, busId: true } });
      return trip ? { source: 'DRIVER', tripId: trip.id, busId: trip.busId } : null;
    }
    const attendant = await tx.attendant.findUnique({ where: { userId: principal.id }, select: { id: true } });
    if (attendant) {
      const trip = await tx.trip.findFirst({ where: { attendantId: attendant.id, status: 'IN_PROGRESS' }, select: { id: true, busId: true } });
      return trip ? { source: 'ATTENDANT', tripId: trip.id, busId: trip.busId } : null;
    }
    return null;
  }

  /** True for DRIVER/BUS_ATTENDANT specifically — used to decide which authorization branch applies, never which permission was granted. */
  private async isFieldCrew(tx: Prisma.TransactionClient, principal: AuthenticatedPrincipal): Promise<boolean> {
    const driver = await tx.driver.findUnique({ where: { userId: principal.id }, select: { id: true } });
    if (driver) return true;
    const attendant = await tx.attendant.findUnique({ where: { userId: principal.id }, select: { id: true } });
    return !!attendant;
  }

  // ---------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------

  async list(principal: AuthenticatedPrincipal, query: ListSafetyEventsQuery): Promise<CursorPage<SafetyEventDto>> {
    const rows = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.safetyEvent.findMany({
        where: {
          status: query.status,
          severity: query.severity,
          type: query.type,
          busId: query.busId,
          tripId: query.tripId,
          ...(query.from || query.to
            ? { occurredAt: { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } }
            : {}),
        },
        include: ROW_INCLUDE,
        orderBy: { occurredAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(rows, query.limit);
    return { data: page.data.map((r) => this.toDto(r)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<SafetyEventDto> {
    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.safetyEvent.findFirst({ where: { id }, include: ROW_INCLUDE }),
    );
    if (!row) throw new NotFoundException();
    return this.toDto(row);
  }

  async create(principal: AuthenticatedPrincipal, input: CreateSafetyEventInput, meta: RequestMeta): Promise<SafetyEventDto> {
    const row = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const own = await this.resolveOwnCurrentTrip(tx, principal);
      const isFieldCrew = await this.isFieldCrew(tx, principal);

      let busId: string | undefined = input.busId;
      let tripId: string | undefined = input.tripId;
      let source: 'HUMAN_OPERATOR' | 'DRIVER' | 'ATTENDANT';

      if (isFieldCrew) {
        if (!own) {
          throw new BadRequestException('You have no active trip — a safety event can only be reported for your current trip.');
        }
        if ((input.busId && input.busId !== own.busId) || (input.tripId && input.tripId !== own.tripId)) {
          throw new ForbiddenException('You can only report a safety event for your own currently assigned trip/bus.');
        }
        busId = own.busId;
        tripId = own.tripId;
        source = own.source;
      } else {
        source = 'HUMAN_OPERATOR';
        if (busId) {
          const bus = await tx.bus.findFirst({ where: { id: busId, deletedAt: null }, select: { id: true } });
          if (!bus) throw new NotFoundException('No such bus.');
        }
        if (tripId) {
          const trip = await tx.trip.findFirst({ where: { id: tripId }, select: { id: true, busId: true } });
          if (!trip) throw new NotFoundException('No such trip.');
          if (busId && trip.busId !== busId) throw new BadRequestException('tripId does not belong to the supplied busId.');
        }
      }

      if (input.cameraId) {
        const camera = await tx.camera.findFirst({ where: { id: input.cameraId }, select: { id: true, busId: true } });
        if (!camera) throw new NotFoundException('No such camera.');
        if (busId && camera.busId !== busId) throw new BadRequestException('cameraId does not belong to the supplied/resolved busId.');
      }

      return tx.safetyEvent.create({
        data: {
          schoolId: principal.schoolId,
          busId,
          tripId,
          cameraId: input.cameraId,
          type: input.type,
          severity: input.severity,
          source,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
          description: input.description,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
          createdBy: principal.id,
        },
        include: ROW_INCLUDE,
      });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'SAFETY_EVENT_CREATED',
      subjectType: 'SafetyEvent',
      subjectId: row.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { type: row.type, severity: row.severity },
    });

    if (row.severity === 'CRITICAL') {
      this.domainEvents.publish({ type: 'SAFETY_EVENT_CRITICAL', schoolId: principal.schoolId, safetyEventId: row.id });
    }

    const dto = this.toDto(row);
    this.safetyGateway.emitSafetyEventCreated(principal.schoolId, dto);
    return dto;
  }

  async acknowledge(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<SafetyEventDto> {
    const row = await this.transition(principal, id, ['NEW'], 'ACKNOWLEDGED', (tx, existing) =>
      tx.safetyEvent.update({
        where: { id: existing.id },
        data: { status: 'ACKNOWLEDGED', reviewedBy: principal.id, reviewedAt: new Date() },
        include: ROW_INCLUDE,
      }),
    );
    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'SAFETY_EVENT_ACKNOWLEDGED',
      subjectType: 'SafetyEvent',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
    const dto = this.toDto(row);
    this.safetyGateway.emitSafetyEventUpdated(principal.schoolId, dto);
    return dto;
  }

  async dismiss(principal: AuthenticatedPrincipal, id: string, input: DismissSafetyEventInput, meta: RequestMeta): Promise<SafetyEventDto> {
    const row = await this.transition(principal, id, ['NEW', 'ACKNOWLEDGED'], 'DISMISSED', (tx, existing) =>
      tx.safetyEvent.update({
        where: { id: existing.id },
        data: { status: 'DISMISSED', reviewedBy: principal.id, reviewedAt: new Date(), resolutionNote: input.resolutionNote },
        include: ROW_INCLUDE,
      }),
    );
    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'SAFETY_EVENT_DISMISSED',
      subjectType: 'SafetyEvent',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
    const dto = this.toDto(row);
    this.safetyGateway.emitSafetyEventUpdated(principal.schoolId, dto);
    return dto;
  }

  async resolve(principal: AuthenticatedPrincipal, id: string, input: ResolveSafetyEventInput, meta: RequestMeta): Promise<SafetyEventDto> {
    const row = await this.transition(principal, id, ['NEW', 'ACKNOWLEDGED'], 'RESOLVED', (tx, existing) =>
      tx.safetyEvent.update({
        where: { id: existing.id },
        data: { status: 'RESOLVED', reviewedBy: principal.id, reviewedAt: new Date(), resolutionNote: input.resolutionNote },
        include: ROW_INCLUDE,
      }),
    );
    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'SAFETY_EVENT_RESOLVED',
      subjectType: 'SafetyEvent',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
    const dto = this.toDto(row);
    this.safetyGateway.emitSafetyEventUpdated(principal.schoolId, dto);
    return dto;
  }

  /**
   * Creates an Emergency from this event in the same transaction as the
   * status transition — "escalate" is the one controlled path from
   * SafetyEvent into the Emergency workflow (never automatic on severity
   * alone). Delegates the Emergency row's creation/audit/notification to
   * `EmergenciesService.createFromSafetyEvent` so the two "an emergency was
   * created" paths (direct trigger vs. escalation) share one implementation.
   */
  async escalate(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<SafetyEventDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.safetyEvent.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();
    if (!MANUAL_TRANSITIONS[existing.status]?.includes('ESCALATED')) {
      throw new BadRequestException(`Cannot escalate a safety event with status ${existing.status}.`);
    }

    let createdEmergency!: Awaited<ReturnType<EmergenciesService['createFromSafetyEvent']>>;
    const row = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      createdEmergency = await this.emergenciesService.createFromSafetyEvent(tx, principal, existing);
      return tx.safetyEvent.update({
        where: { id },
        data: { status: 'ESCALATED', reviewedBy: principal.id, reviewedAt: new Date() },
        include: ROW_INCLUDE,
      });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'SAFETY_EVENT_ESCALATED',
      subjectType: 'SafetyEvent',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
    // The emergency's own audit/notification/realtime emit, always
    // post-commit — see EmergenciesService.afterCreate.
    await this.emergenciesService.afterCreate(principal, createdEmergency, meta);

    const dto = this.toDto(row);
    this.safetyGateway.emitSafetyEventUpdated(principal.schoolId, dto);
    return dto;
  }

  /** Called only by EmergenciesService.resolve() when that emergency has a `sourceSafetyEventId` — the one system-driven path to ESCALATED → RESOLVED. Not reachable from any controller. */
  async resolveFromEmergency(tx: Prisma.TransactionClient, safetyEventId: string): Promise<void> {
    await tx.safetyEvent.updateMany({ where: { id: safetyEventId, status: 'ESCALATED' }, data: { status: 'RESOLVED' } });
  }

  /**
   * Creates a `source: 'SYSTEM'` SafetyEvent with no human actor — called
   * only by `OperationalSafetyService` when a deterministic geofence/
   * route-deviation/speed/stop rule fires (Phase 2 Step 13). Bypasses the
   * principal-based own-trip scoping entirely: there is no principal, and
   * `schoolId`/`busId`/`tripId` are already resolved server-side by the GPS
   * ingestion pipeline that owns this call, never client input. Audited
   * with `actorType: 'SYSTEM'` — a real, pre-reserved audit actor type,
   * not `USER` with a null id. Deliberately NOT wrapped in the caller's
   * try/catch — this method's own errors are the caller's responsibility to
   * isolate (see OperationalSafetyService), so ingestion never breaks even
   * if this throws.
   */
  async createSystemEvent(params: {
    schoolId: string;
    busId: string;
    tripId: string | null;
    type: 'ROUTE_DEVIATION' | 'GEOFENCE_ENTRY' | 'GEOFENCE_EXIT' | 'EXCESSIVE_SPEED' | 'UNEXPECTED_STOP';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<SafetyEventDto> {
    const row = await this.prisma.runInTenantContext(params.schoolId, (tx) =>
      tx.safetyEvent.create({
        data: {
          schoolId: params.schoolId,
          busId: params.busId,
          tripId: params.tripId,
          type: params.type,
          severity: params.severity,
          source: 'SYSTEM',
          occurredAt: new Date(),
          description: params.description,
          metadata: params.metadata as Prisma.InputJsonValue | undefined,
          createdBy: null,
        },
        include: ROW_INCLUDE,
      }),
    );

    await this.auditService.record(params.schoolId, {
      actorType: 'SYSTEM',
      action: 'SAFETY_EVENT_CREATED',
      subjectType: 'SafetyEvent',
      subjectId: row.id,
      metadata: { type: row.type, severity: row.severity, source: 'SYSTEM' },
    });

    if (row.severity === 'CRITICAL') {
      this.domainEvents.publish({ type: 'SAFETY_EVENT_CRITICAL', schoolId: params.schoolId, safetyEventId: row.id });
    }

    const dto = this.toDto(row);
    this.safetyGateway.emitSafetyEventCreated(params.schoolId, dto);
    return dto;
  }

  /**
   * DB-only creation of an AI-promoted SafetyEvent, called from inside
   * `AiObservationsService.promote()`'s own transaction (same "child
   * service does the row insert, caller controls the transaction boundary"
   * shape as `EmergenciesService.createFromSafetyEvent`). `source: 'AI'`
   * and `sourceAiObservationId` are set here and ONLY here — this is the
   * single code path in the entire codebase that can ever produce an
   * AI-sourced SafetyEvent, and it is only ever reached from a human's
   * explicit `POST /ai-observations/:id/promote` call, never automatically.
   * The `@unique` constraint on `sourceAiObservationId` means a second
   * concurrent attempt to promote the same observation fails here with a
   * Postgres unique-violation, which the caller translates into a clean
   * 409/400 — see docs/adr/0022-ai-observation-review-and-safety-analytics.md's
   * concurrency decision.
   */
  async createRowFromAiObservation(tx: Prisma.TransactionClient, params: AiPromotionParams): Promise<SafetyEventRow> {
    return tx.safetyEvent.create({
      data: {
        schoolId: params.schoolId,
        busId: params.busId,
        tripId: params.tripId,
        cameraId: params.cameraId,
        type: params.type,
        severity: params.severity,
        source: 'AI',
        occurredAt: new Date(),
        description: params.description,
        metadata: params.metadata as Prisma.InputJsonValue | undefined,
        createdBy: params.createdBy,
        sourceAiObservationId: params.sourceAiObservationId,
      },
      include: ROW_INCLUDE,
    });
  }

  /**
   * Audit + notification + realtime for a newly-created AI-promoted event —
   * always called after the outer transaction (which also marks the
   * AIObservation PROMOTED) has committed, the same "DB write, then
   * post-commit side effects" split `EmergenciesService.afterCreate` uses.
   * `actorId` is the reviewer who promoted it (a real human decision), even
   * though `source` on the row itself is `'AI'` — `source` describes what
   * originally detected the underlying signal, `createdBy`/this audit's
   * actor describe who is accountable for creating the SafetyEvent record.
   */
  async afterAiPromotion(schoolId: string, reviewerId: string, row: SafetyEventRow, meta: RequestMeta): Promise<SafetyEventDto> {
    await this.auditService.record(schoolId, {
      actorType: 'USER',
      actorId: reviewerId,
      action: 'SAFETY_EVENT_CREATED',
      subjectType: 'SafetyEvent',
      subjectId: row.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { type: row.type, severity: row.severity, source: 'AI', sourceAiObservationId: row.sourceAiObservationId },
    });

    if (row.severity === 'CRITICAL') {
      this.domainEvents.publish({ type: 'SAFETY_EVENT_CRITICAL', schoolId, safetyEventId: row.id });
    }

    const dto = this.toDto(row);
    this.safetyGateway.emitSafetyEventCreated(schoolId, dto);
    return dto;
  }

  private async transition(
    principal: AuthenticatedPrincipal,
    id: string,
    fromStatuses: string[],
    _toStatus: string,
    update: (tx: Prisma.TransactionClient, existing: { id: string; status: string }) => Promise<SafetyEventRow>,
  ): Promise<SafetyEventRow> {
    return this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const existing = await tx.safetyEvent.findFirst({ where: { id }, select: { id: true, status: true } });
      if (!existing) throw new NotFoundException();
      if (!fromStatuses.includes(existing.status)) {
        throw new BadRequestException(`Cannot transition a safety event with status ${existing.status}.`);
      }
      return update(tx, existing);
    });
  }

  private toDto(row: SafetyEventRow): SafetyEventDto {
    return {
      id: row.id,
      busId: row.busId,
      tripId: row.tripId,
      cameraId: row.cameraId,
      type: row.type as SafetyEventDto['type'],
      severity: row.severity as SafetyEventDto['severity'],
      status: row.status as SafetyEventDto['status'],
      source: row.source as SafetyEventDto['source'],
      occurredAt: row.occurredAt.toISOString(),
      detectedAt: row.detectedAt.toISOString(),
      description: row.description,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      createdBy: row.createdBy,
      createdByName: row.creator?.fullName ?? 'System',
      reviewedBy: row.reviewedBy,
      reviewedByName: row.reviewer?.fullName ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      resolutionNote: row.resolutionNote,
      emergencyId: row.emergency?.id ?? null,
      sourceAiObservationId: row.sourceAiObservationId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
