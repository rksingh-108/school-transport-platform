import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TripDto, TripStopDto, CursorPage } from '@school-transport/shared-types';
import type { CreateTripInput, UpdateTripInput, ListTripsQuery, CancelTripInput, NoShowTripInput } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { RbacService } from '../auth/services/rbac.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

const tripInclude = {
  route: { select: { name: true, code: true, direction: true } },
  bus: { select: { registrationNumber: true, fleetNumber: true } },
  driver: { include: { user: { select: { fullName: true } } } },
  attendant: { include: { user: { select: { fullName: true } } } },
  _count: { select: { tripStudents: { where: { membershipStatus: { not: 'REMOVED' as const } } } } },
} satisfies Prisma.TripInclude;

type TripRow = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

/** "HH:mm" -> minutes since midnight, for same-day overlap comparison. Trips never cross midnight (validated at the DTO layer). */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

function overlaps(startA: string, endA: string, startB: string, endB: string): boolean {
  return toMinutes(startA) < toMinutes(endB) && toMinutes(startB) < toMinutes(endA);
}

const ACTIVE_TRIP_STATUSES = ['SCHEDULED', 'READY', 'IN_PROGRESS', 'COMPLETED'] as const;

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  /**
   * DRIVER/BUS_ATTENDANT hold `trips.read` but never `trips.manage` (see
   * docs/security.md's trips authorization note) — for them, every list/get
   * is scoped to trips where they are the assigned driver or attendant.
   * Anyone with `trips.manage` (or a read-only management role like
   * PRINCIPAL/TRANSPORT_MANAGER) sees the full school-scoped list — `null`
   * means "no extra restriction."
   */
  private async ownTripFilter(
    tx: Prisma.TransactionClient,
    principal: AuthenticatedPrincipal,
  ): Promise<Prisma.TripWhereInput | null> {
    const canManage = await this.rbacService.hasPermission(principal.schoolId, principal.id, 'trips.manage');
    if (canManage) return null;

    const [driver, attendant] = await Promise.all([
      tx.driver.findUnique({ where: { userId: principal.id } }),
      tx.attendant.findUnique({ where: { userId: principal.id } }),
    ]);
    if (!driver && !attendant) return null;

    const or: Prisma.TripWhereInput[] = [];
    if (driver) or.push({ driverId: driver.id });
    if (attendant) or.push({ attendantId: attendant.id });
    return { OR: or };
  }

  async list(principal: AuthenticatedPrincipal, query: ListTripsQuery): Promise<CursorPage<TripDto>> {
    const trips = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const ownFilter = await this.ownTripFilter(tx, principal);
      return tx.trip.findMany({
        where: {
          ...ownFilter,
          serviceDate: query.serviceDate ? new Date(query.serviceDate) : undefined,
          routeId: query.routeId,
          status: query.status,
          busId: query.busId,
          driverId: query.driverId,
        },
        include: tripInclude,
        orderBy: [{ serviceDate: 'desc' }, { scheduledStartTime: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
    });
    const page = toCursorPage(trips, query.limit);
    return { data: page.data.map((t) => this.toDto(t)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<TripDto> {
    const trip = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const ownFilter = await this.ownTripFilter(tx, principal);
      return tx.trip.findFirst({ where: { id, ...ownFilter }, include: tripInclude });
    });
    if (!trip) throw new NotFoundException();
    return this.toDto(trip);
  }

  /** The immutable snapshot taken at creation — never the live route's current stops. */
  async listStops(principal: AuthenticatedPrincipal, tripId: string): Promise<TripStopDto[]> {
    const stops = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const ownFilter = await this.ownTripFilter(tx, principal);
      const trip = await tx.trip.findFirst({ where: { id: tripId, ...ownFilter } });
      if (!trip) throw new NotFoundException();
      return tx.tripStop.findMany({ where: { tripId }, orderBy: { sequenceNo: 'asc' } });
    });
    return stops.map((s) => ({
      id: s.id,
      tripId: s.tripId,
      sourceRouteStopId: s.sourceRouteStopId,
      sequenceNo: s.sequenceNo,
      name: s.name,
      address: s.address,
      latitude: s.latitude,
      longitude: s.longitude,
      expectedOffsetMinutes: s.expectedOffsetMinutes,
      mode: s.mode as TripStopDto['mode'],
      createdAt: s.createdAt.toISOString(),
    }));
  }

  async create(principal: AuthenticatedPrincipal, input: CreateTripInput, meta: RequestMeta): Promise<TripDto> {
    const trip = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const route = await this.validateRoute(tx, input.routeId);
      await this.validateBus(tx, input.busId);
      await this.validateDriver(tx, input.driverId);
      if (input.attendantId) await this.validateAttendant(tx, input.attendantId);

      await this.assertNoConflicts(
        tx,
        input.serviceDate,
        { busId: input.busId, driverId: input.driverId, attendantId: input.attendantId ?? null },
        input.scheduledStartTime,
        input.scheduledEndTime,
      );

      return tx.trip.create({
        data: {
          schoolId: principal.schoolId,
          routeId: input.routeId,
          busId: input.busId,
          driverId: input.driverId,
          attendantId: input.attendantId,
          serviceDate: new Date(input.serviceDate),
          shift: route.shift,
          scheduledStartTime: input.scheduledStartTime,
          scheduledEndTime: input.scheduledEndTime,
          notes: input.notes,
          tripStops: {
            create: route.stops.map((s) => ({
              schoolId: principal.schoolId,
              sourceRouteStopId: s.id,
              sequenceNo: s.sequenceNo,
              name: s.name,
              address: s.address,
              latitude: s.latitude,
              longitude: s.longitude,
              expectedOffsetMinutes: s.expectedOffsetMinutes,
              mode: s.mode,
            })),
          },
        },
        include: tripInclude,
      });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'TRIP_CREATED',
      subjectType: 'Trip',
      subjectId: trip.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { routeId: input.routeId, serviceDate: input.serviceDate },
    });

    return this.toDto(trip);
  }

  async update(principal: AuthenticatedPrincipal, id: string, input: UpdateTripInput, meta: RequestMeta): Promise<TripDto> {
    const trip = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const existing = await tx.trip.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'SCHEDULED' && existing.status !== 'READY') {
        throw new BadRequestException('Only a scheduled or ready trip can be edited.');
      }

      const busId = input.busId ?? existing.busId;
      const driverId = input.driverId ?? existing.driverId;
      const attendantId = input.attendantId !== undefined ? input.attendantId : existing.attendantId;
      const serviceDate = input.serviceDate ?? existing.serviceDate.toISOString().slice(0, 10);
      const scheduledStartTime = input.scheduledStartTime ?? existing.scheduledStartTime;
      const scheduledEndTime = input.scheduledEndTime ?? existing.scheduledEndTime;

      if (input.busId) await this.validateBus(tx, input.busId);
      if (input.driverId) await this.validateDriver(tx, input.driverId);
      if (input.attendantId) await this.validateAttendant(tx, input.attendantId);

      const assignmentChanged =
        busId !== existing.busId ||
        driverId !== existing.driverId ||
        attendantId !== existing.attendantId ||
        serviceDate !== existing.serviceDate.toISOString().slice(0, 10) ||
        scheduledStartTime !== existing.scheduledStartTime ||
        scheduledEndTime !== existing.scheduledEndTime;

      if (assignmentChanged) {
        await this.assertNoConflicts(
          tx,
          serviceDate,
          { busId, driverId, attendantId },
          scheduledStartTime,
          scheduledEndTime,
          id,
        );
      }

      // Reassigning anything after a trip was marked READY invalidates that
      // confirmation — it must go through /ready again before it can start.
      const nextStatus = existing.status === 'READY' && assignmentChanged ? ('SCHEDULED' as const) : undefined;

      return tx.trip.update({
        where: { id },
        data: {
          busId: input.busId,
          driverId: input.driverId,
          attendantId: input.attendantId === undefined ? undefined : input.attendantId,
          serviceDate: input.serviceDate ? new Date(input.serviceDate) : undefined,
          scheduledStartTime: input.scheduledStartTime,
          scheduledEndTime: input.scheduledEndTime,
          notes: input.notes,
          status: nextStatus,
        },
        include: tripInclude,
      });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'TRIP_UPDATED',
      subjectType: 'Trip',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { fields: Object.keys(input) },
    });

    return this.toDto(trip);
  }

  /** Re-validates every assignment against its CURRENT state — a bus/driver/attendant can be sent to maintenance or deactivated between creation and this checkpoint. */
  async ready(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<TripDto> {
    const trip = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const existing = await tx.trip.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'SCHEDULED') {
        throw new BadRequestException('Only a scheduled trip can be marked ready.');
      }

      await this.validateRoute(tx, existing.routeId);
      await this.validateBus(tx, existing.busId);
      await this.validateDriver(tx, existing.driverId);
      if (existing.attendantId) await this.validateAttendant(tx, existing.attendantId);

      return tx.trip.update({ where: { id }, data: { status: 'READY' }, include: tripInclude });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'TRIP_READY',
      subjectType: 'Trip',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(trip);
  }

  /** trips.manage OR the trip's own assigned driver — see docs/security.md. */
  async start(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<TripDto> {
    const trip = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const existing = await tx.trip.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException();
      await this.assertCanOperate(tx, principal, existing.driverId);
      if (existing.status !== 'READY') {
        throw new BadRequestException('Only a ready trip can be started.');
      }

      await tx.tripStudent.updateMany({
        where: { tripId: id, membershipStatus: 'PLANNED' },
        data: { membershipStatus: 'ACTIVE' },
      });

      return tx.trip.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() }, include: tripInclude });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'TRIP_STARTED',
      subjectType: 'Trip',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    this.domainEvents.publish({ type: 'TRIP_STARTED', schoolId: principal.schoolId, tripId: id });

    return this.toDto(trip);
  }

  /** trips.manage OR the trip's own assigned driver — see docs/security.md. */
  async complete(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<TripDto> {
    const trip = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const existing = await tx.trip.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException();
      await this.assertCanOperate(tx, principal, existing.driverId);
      if (existing.status !== 'IN_PROGRESS') {
        throw new BadRequestException('Only an in-progress trip can be completed.');
      }

      return tx.trip.update({ where: { id }, data: { status: 'COMPLETED', endedAt: new Date() }, include: tripInclude });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'TRIP_COMPLETED',
      subjectType: 'Trip',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    this.domainEvents.publish({ type: 'TRIP_COMPLETED', schoolId: principal.schoolId, tripId: id });

    return this.toDto(trip);
  }

  async cancel(principal: AuthenticatedPrincipal, id: string, input: CancelTripInput, meta: RequestMeta): Promise<TripDto> {
    const trip = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const existing = await tx.trip.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException();
      if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED' || existing.status === 'NO_SHOW') {
        throw new BadRequestException('This trip has already reached a terminal state.');
      }
      return tx.trip.update({
        where: { id },
        data: { status: 'CANCELLED', cancellationReason: input.reason },
        include: tripInclude,
      });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'TRIP_CANCELLED',
      subjectType: 'Trip',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { reason: input.reason },
    });

    this.domainEvents.publish({ type: 'TRIP_CANCELLED', schoolId: principal.schoolId, tripId: id, reason: input.reason });

    return this.toDto(trip);
  }

  /** Only reachable before a trip actually starts — once IN_PROGRESS, it is no longer a "no show" by definition. */
  async noShow(principal: AuthenticatedPrincipal, id: string, input: NoShowTripInput, meta: RequestMeta): Promise<TripDto> {
    const trip = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const existing = await tx.trip.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'SCHEDULED' && existing.status !== 'READY') {
        throw new BadRequestException('Only a scheduled or ready trip can be marked no-show.');
      }
      return tx.trip.update({
        where: { id },
        data: { status: 'NO_SHOW', cancellationReason: input.reason },
        include: tripInclude,
      });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'TRIP_NO_SHOW',
      subjectType: 'Trip',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { reason: input.reason },
    });

    this.domainEvents.publish({ type: 'TRIP_NO_SHOW', schoolId: principal.schoolId, tripId: id, reason: input.reason });

    return this.toDto(trip);
  }

  // -------------------------------------------------------------------
  // Validation helpers
  // -------------------------------------------------------------------

  private async validateRoute(tx: Prisma.TransactionClient, routeId: string) {
    const route = await tx.route.findFirst({ where: { id: routeId, deletedAt: null } });
    if (!route) throw new NotFoundException('No such route.');
    if (route.status !== 'ACTIVE') throw new BadRequestException('The route is not active.');
    const stops = await tx.routeStop.findMany({ where: { routeId, status: 'ACTIVE' }, orderBy: { sequenceNo: 'asc' } });
    if (stops.length === 0) throw new BadRequestException('The route has no active stops.');
    return { ...route, stops };
  }

  private async validateBus(tx: Prisma.TransactionClient, busId: string) {
    const bus = await tx.bus.findFirst({ where: { id: busId, deletedAt: null } });
    if (!bus) throw new NotFoundException('No such bus.');
    if (bus.status !== 'ACTIVE') throw new BadRequestException('The bus is not operational (not ACTIVE).');
    return bus;
  }

  private async validateDriver(tx: Prisma.TransactionClient, driverId: string) {
    const driver = await tx.driver.findFirst({ where: { id: driverId, deletedAt: null }, include: { user: true } });
    if (!driver) throw new NotFoundException('No such driver.');
    if (driver.status !== 'ACTIVE') throw new BadRequestException('The driver is not operationally active.');
    if (driver.user.status !== 'ACTIVE') throw new BadRequestException("The driver's staff account is not active.");
    return driver;
  }

  private async validateAttendant(tx: Prisma.TransactionClient, attendantId: string) {
    const attendant = await tx.attendant.findFirst({ where: { id: attendantId, deletedAt: null }, include: { user: true } });
    if (!attendant) throw new NotFoundException('No such attendant.');
    if (attendant.status !== 'ACTIVE') throw new BadRequestException('The attendant is not operationally active.');
    if (attendant.user.status !== 'ACTIVE') throw new BadRequestException("The attendant's staff account is not active.");
    return attendant;
  }

  /**
   * A bus/driver/attendant cannot be double-booked into overlapping trips
   * on the same service date. Cancelled/no-show trips never occupy a
   * resource (they didn't run), so they are excluded — see
   * docs/adr/0012-trip-stop-snapshot-and-lifecycle.md for the full rule and
   * its accepted concurrency limitation (checked-then-written under the
   * default READ COMMITTED isolation level, the same trade-off already
   * accepted for other duplicate/uniqueness pre-checks in this codebase).
   */
  private async assertNoConflicts(
    tx: Prisma.TransactionClient,
    serviceDate: string,
    resources: { busId: string; driverId: string; attendantId: string | null },
    scheduledStartTime: string,
    scheduledEndTime: string,
    excludeTripId?: string,
  ): Promise<void> {
    const or: Prisma.TripWhereInput[] = [{ busId: resources.busId }, { driverId: resources.driverId }];
    if (resources.attendantId) or.push({ attendantId: resources.attendantId });

    const candidates = await tx.trip.findMany({
      where: {
        serviceDate: new Date(serviceDate),
        status: { in: [...ACTIVE_TRIP_STATUSES] },
        id: excludeTripId ? { not: excludeTripId } : undefined,
        OR: or,
      },
      select: { id: true, busId: true, driverId: true, attendantId: true, scheduledStartTime: true, scheduledEndTime: true },
    });

    for (const other of candidates) {
      if (!overlaps(scheduledStartTime, scheduledEndTime, other.scheduledStartTime, other.scheduledEndTime)) continue;
      if (other.busId === resources.busId) throw new ConflictException('This bus is already assigned to an overlapping trip.');
      if (other.driverId === resources.driverId) throw new ConflictException('This driver is already assigned to an overlapping trip.');
      if (resources.attendantId && other.attendantId === resources.attendantId) {
        throw new ConflictException('This attendant is already assigned to an overlapping trip.');
      }
    }
  }

  private async assertCanOperate(tx: Prisma.TransactionClient, principal: AuthenticatedPrincipal, tripDriverId: string): Promise<void> {
    const canManage = await this.rbacService.hasPermission(principal.schoolId, principal.id, 'trips.manage');
    if (canManage) return;
    const driver = await tx.driver.findUnique({ where: { userId: principal.id } });
    if (!driver || driver.id !== tripDriverId) {
      throw new ForbiddenException('Only the assigned driver or trip management staff can do this.');
    }
  }

  private toDto(trip: TripRow): TripDto {
    return {
      id: trip.id,
      routeId: trip.routeId,
      routeName: trip.route.name,
      routeCode: trip.route.code,
      direction: trip.route.direction as TripDto['direction'],
      busId: trip.busId,
      busRegistrationNumber: trip.bus.registrationNumber,
      busFleetNumber: trip.bus.fleetNumber,
      driverId: trip.driverId,
      driverName: trip.driver.user.fullName,
      attendantId: trip.attendantId,
      attendantName: trip.attendant?.user.fullName ?? null,
      serviceDate: trip.serviceDate.toISOString().slice(0, 10),
      shift: trip.shift,
      scheduledStartTime: trip.scheduledStartTime,
      scheduledEndTime: trip.scheduledEndTime,
      status: trip.status,
      startedAt: trip.startedAt?.toISOString() ?? null,
      endedAt: trip.endedAt?.toISOString() ?? null,
      cancellationReason: trip.cancellationReason,
      notes: trip.notes,
      studentCount: trip._count.tripStudents,
      createdAt: trip.createdAt.toISOString(),
      updatedAt: trip.updatedAt.toISOString(),
    };
  }
}
