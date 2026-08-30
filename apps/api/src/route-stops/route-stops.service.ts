import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { RouteStopDto } from '@school-transport/shared-types';
import type { CreateStopInput, UpdateStopInput, ReorderStopsInput } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

type StopRow = {
  id: string;
  routeId: string;
  sequenceNo: number;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  expectedOffsetMinutes: number;
  radiusMeters: number;
  mode: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

/** A large, never-legitimately-reached offset used to shift sequence numbers out of the way during an atomic reorder, avoiding a transient unique-constraint collision. */
const REORDER_OFFSET = 1_000_000;

@Injectable()
export class RouteStopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Every operation first confirms the route itself belongs to the caller's tenant — a stop can never be reached through a foreign route id. */
  private async assertRouteInTenant(schoolId: string, routeId: string): Promise<void> {
    const route = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.route.findFirst({ where: { id: routeId, deletedAt: null } }),
    );
    if (!route) throw new NotFoundException('No such route.');
  }

  async listForRoute(principal: AuthenticatedPrincipal, routeId: string): Promise<RouteStopDto[]> {
    await this.assertRouteInTenant(principal.schoolId, routeId);
    const stops = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.routeStop.findMany({ where: { routeId }, orderBy: { sequenceNo: 'asc' } }),
    );
    return stops.map((s) => this.toDto(s));
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<RouteStopDto> {
    const stop = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.routeStop.findFirst({ where: { id } }));
    if (!stop) throw new NotFoundException();
    return this.toDto(stop);
  }

  async create(
    principal: AuthenticatedPrincipal,
    routeId: string,
    input: CreateStopInput,
    meta: RequestMeta,
  ): Promise<RouteStopDto> {
    await this.assertRouteInTenant(principal.schoolId, routeId);

    const conflict = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.routeStop.findUnique({ where: { routeId_sequenceNo: { routeId, sequenceNo: input.sequenceNo } } }),
    );
    if (conflict) {
      throw new BadRequestException(`Sequence ${input.sequenceNo} is already used on this route.`);
    }

    const stop = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.routeStop.create({
        data: {
          schoolId: principal.schoolId,
          routeId,
          sequenceNo: input.sequenceNo,
          name: input.name,
          address: input.address,
          latitude: input.latitude,
          longitude: input.longitude,
          expectedOffsetMinutes: input.expectedOffsetMinutes,
          radiusMeters: input.radiusMeters,
          mode: input.mode,
        },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'STOP_CREATED',
      subjectType: 'RouteStop',
      subjectId: stop.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { routeId },
    });

    return this.toDto(stop);
  }

  async update(principal: AuthenticatedPrincipal, id: string, input: UpdateStopInput, meta: RequestMeta): Promise<RouteStopDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.routeStop.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();

    const statusChanged = input.status !== undefined && input.status !== existing.status;

    const stop = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.routeStop.update({
        where: { id },
        data: {
          name: input.name,
          address: input.address,
          latitude: input.latitude,
          longitude: input.longitude,
          expectedOffsetMinutes: input.expectedOffsetMinutes,
          radiusMeters: input.radiusMeters,
          mode: input.mode,
          status: input.status,
        },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: statusChanged && input.status === 'INACTIVE' ? 'STOP_DEACTIVATED' : 'STOP_UPDATED',
      subjectType: 'RouteStop',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { fields: Object.keys(input) },
    });

    return this.toDto(stop);
  }

  /**
   * Atomic full reorder: `stopIds` must be exactly the set of stop ids
   * currently on the route, in their new order. Sequence numbers are first
   * shifted by a large offset (still inside the same transaction) so the
   * final pass of setting real sequence numbers 1..N can never collide with
   * an existing value — the classic two-phase technique for reordering rows
   * under a unique constraint. See docs/api.md's reorder section.
   */
  async reorder(
    principal: AuthenticatedPrincipal,
    routeId: string,
    input: ReorderStopsInput,
    meta: RequestMeta,
  ): Promise<RouteStopDto[]> {
    await this.assertRouteInTenant(principal.schoolId, routeId);

    const existingStops = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.routeStop.findMany({ where: { routeId }, select: { id: true } }),
    );
    const existingIds = new Set(existingStops.map((s) => s.id));
    const inputIds = new Set(input.stopIds);
    if (existingIds.size !== inputIds.size || [...existingIds].some((id) => !inputIds.has(id))) {
      throw new BadRequestException('stopIds must be exactly the set of stops currently on this route.');
    }

    const stops = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      for (let i = 0; i < input.stopIds.length; i++) {
        await tx.routeStop.update({ where: { id: input.stopIds[i] }, data: { sequenceNo: REORDER_OFFSET + i } });
      }
      for (let i = 0; i < input.stopIds.length; i++) {
        await tx.routeStop.update({ where: { id: input.stopIds[i] }, data: { sequenceNo: i + 1 } });
      }
      return tx.routeStop.findMany({ where: { routeId }, orderBy: { sequenceNo: 'asc' } });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'STOP_REORDERED',
      subjectType: 'Route',
      subjectId: routeId,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { stopIds: input.stopIds },
    });

    return stops.map((s) => this.toDto(s));
  }

  /** Hard-deletes only if nothing historical references this stop yet; otherwise the caller must deactivate it instead (docs/database.md). */
  async remove(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<void> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.routeStop.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();

    const referenced = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.tripStudent.findFirst({ where: { stopId: id } }),
    );
    if (referenced) {
      throw new BadRequestException('This stop has historical trip records and cannot be deleted — deactivate it instead.');
    }

    await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.routeStop.delete({ where: { id } }));

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'STOP_DELETED',
      subjectType: 'RouteStop',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
  }

  private toDto(stop: StopRow): RouteStopDto {
    return {
      id: stop.id,
      routeId: stop.routeId,
      sequenceNo: stop.sequenceNo,
      name: stop.name,
      address: stop.address,
      latitude: stop.latitude,
      longitude: stop.longitude,
      expectedOffsetMinutes: stop.expectedOffsetMinutes,
      radiusMeters: stop.radiusMeters,
      mode: stop.mode as RouteStopDto['mode'],
      status: stop.status as RouteStopDto['status'],
      createdAt: stop.createdAt.toISOString(),
      updatedAt: stop.updatedAt.toISOString(),
    };
  }
}
