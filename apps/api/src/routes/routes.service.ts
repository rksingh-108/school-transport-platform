import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { RouteDto, CursorPage } from '@school-transport/shared-types';
import type { CreateRouteInput, UpdateRouteInput, ListRoutesQuery } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

type RouteRow = {
  id: string;
  code: string | null;
  name: string;
  direction: string;
  shift: string;
  status: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { stops: number };
};

const routeInclude = { _count: { select: { stops: true } } } as const;

@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(principal: AuthenticatedPrincipal, query: ListRoutesQuery): Promise<CursorPage<RouteDto>> {
    const routes = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.route.findMany({
        where: {
          deletedAt: null,
          status: query.status,
          direction: query.direction,
          ...(query.search
            ? {
                OR: [
                  { name: { contains: query.search, mode: 'insensitive' } },
                  { code: { contains: query.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: routeInclude,
        orderBy: { createdAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(routes, query.limit);
    return { data: page.data.map((r) => this.toDto(r)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<RouteDto> {
    const route = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.route.findFirst({ where: { id, deletedAt: null }, include: routeInclude }),
    );
    if (!route) throw new NotFoundException();
    return this.toDto(route);
  }

  async create(principal: AuthenticatedPrincipal, input: CreateRouteInput, meta: RequestMeta): Promise<RouteDto> {
    const route = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.route.create({
        data: {
          schoolId: principal.schoolId,
          code: input.code,
          name: input.name,
          direction: input.direction,
          shift: input.shift,
          description: input.description,
        },
        include: routeInclude,
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'ROUTE_CREATED',
      subjectType: 'Route',
      subjectId: route.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(route);
  }

  async update(principal: AuthenticatedPrincipal, id: string, input: UpdateRouteInput, meta: RequestMeta): Promise<RouteDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.route.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException();

    const statusChanged = input.status !== undefined && input.status !== existing.status;

    const route = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.route.update({
        where: { id },
        data: {
          code: input.code,
          name: input.name,
          direction: input.direction,
          shift: input.shift,
          status: input.status,
          description: input.description,
        },
        include: routeInclude,
      }),
    );

    const routineFields = Object.keys(input).filter((f) => f !== 'status');
    if (routineFields.length > 0) {
      await this.auditService.record(principal.schoolId, {
        actorType: 'USER',
        actorId: principal.id,
        action: 'ROUTE_UPDATED',
        subjectType: 'Route',
        subjectId: id,
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { fields: routineFields },
      });
    }
    if (statusChanged) {
      await this.auditService.record(principal.schoolId, {
        actorType: 'USER',
        actorId: principal.id,
        action: 'ROUTE_STATUS_CHANGED',
        subjectType: 'Route',
        subjectId: id,
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { from: existing.status, to: input.status },
      });
    }

    return this.toDto(route);
  }

  /** Terminal state — the only way to set status ARCHIVED. Never physically deletes the row (docs/database.md). */
  async archive(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<RouteDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.route.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException();
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('This route is already archived.');
    }

    const route = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.route.update({ where: { id }, data: { status: 'ARCHIVED' }, include: routeInclude }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'ROUTE_ARCHIVED',
      subjectType: 'Route',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(route);
  }

  private toDto(route: RouteRow): RouteDto {
    return {
      id: route.id,
      code: route.code,
      name: route.name,
      direction: route.direction as RouteDto['direction'],
      shift: route.shift as RouteDto['shift'],
      status: route.status as RouteDto['status'],
      description: route.description,
      stopCount: route._count.stops,
      createdAt: route.createdAt.toISOString(),
      updatedAt: route.updatedAt.toISOString(),
    };
  }
}
