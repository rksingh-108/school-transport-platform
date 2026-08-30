import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { BusDto, CursorPage } from '@school-transport/shared-types';
import type { CreateBusInput, UpdateBusInput, ListBusesQuery } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

type BusRow = {
  id: string;
  fleetNumber: string | null;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  manufactureYear: number | null;
  capacity: number;
  status: string;
  permitExpiry: Date | null;
  insuranceExpiry: Date | null;
  fitnessExpiry: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class BusesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(principal: AuthenticatedPrincipal, query: ListBusesQuery): Promise<CursorPage<BusDto>> {
    const buses = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.bus.findMany({
        where: {
          deletedAt: null,
          status: query.status,
          ...(query.minCapacity ? { capacity: { gte: query.minCapacity } } : {}),
          ...(query.search
            ? {
                OR: [
                  { registrationNumber: { contains: query.search, mode: 'insensitive' } },
                  { fleetNumber: { contains: query.search, mode: 'insensitive' } },
                  { make: { contains: query.search, mode: 'insensitive' } },
                  { model: { contains: query.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(buses, query.limit);
    return { data: page.data.map((b) => this.toDto(b)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<BusDto> {
    const bus = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.bus.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!bus) throw new NotFoundException();
    return this.toDto(bus);
  }

  async create(principal: AuthenticatedPrincipal, input: CreateBusInput, meta: RequestMeta): Promise<BusDto> {
    const bus = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.bus.create({
        data: {
          schoolId: principal.schoolId,
          fleetNumber: input.fleetNumber,
          registrationNumber: input.registrationNumber,
          capacity: input.capacity,
          make: input.make,
          model: input.model,
          manufactureYear: input.manufactureYear,
          permitExpiry: input.permitExpiry ? new Date(input.permitExpiry) : undefined,
          insuranceExpiry: input.insuranceExpiry ? new Date(input.insuranceExpiry) : undefined,
          fitnessExpiry: input.fitnessExpiry ? new Date(input.fitnessExpiry) : undefined,
          notes: input.notes,
        },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'BUS_CREATED',
      subjectType: 'Bus',
      subjectId: bus.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(bus);
  }

  async update(principal: AuthenticatedPrincipal, id: string, input: UpdateBusInput, meta: RequestMeta): Promise<BusDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.bus.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException();

    const statusChanged = input.status !== undefined && input.status !== existing.status;

    const bus = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.bus.update({
        where: { id },
        data: {
          fleetNumber: input.fleetNumber,
          registrationNumber: input.registrationNumber,
          capacity: input.capacity,
          make: input.make,
          model: input.model,
          manufactureYear: input.manufactureYear,
          status: input.status,
          permitExpiry: input.permitExpiry ? new Date(input.permitExpiry) : undefined,
          insuranceExpiry: input.insuranceExpiry ? new Date(input.insuranceExpiry) : undefined,
          fitnessExpiry: input.fitnessExpiry ? new Date(input.fitnessExpiry) : undefined,
          notes: input.notes,
        },
      }),
    );

    const routineFields = Object.keys(input).filter((f) => f !== 'status');
    if (routineFields.length > 0) {
      await this.auditService.record(principal.schoolId, {
        actorType: 'USER',
        actorId: principal.id,
        action: 'BUS_UPDATED',
        subjectType: 'Bus',
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
        action: 'BUS_STATUS_CHANGED',
        subjectType: 'Bus',
        subjectId: id,
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { from: existing.status, to: input.status },
      });
    }

    return this.toDto(bus);
  }

  /** Terminal state (docs/database.md) — the only way to set status RETIRED. */
  async archive(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<BusDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.bus.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException();
    if (existing.status === 'RETIRED') {
      throw new BadRequestException('This bus is already retired.');
    }

    const bus = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.bus.update({ where: { id }, data: { status: 'RETIRED' } }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'BUS_ARCHIVED',
      subjectType: 'Bus',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(bus);
  }

  private toDto(bus: BusRow): BusDto {
    return {
      id: bus.id,
      fleetNumber: bus.fleetNumber,
      registrationNumber: bus.registrationNumber,
      make: bus.make,
      model: bus.model,
      manufactureYear: bus.manufactureYear,
      capacity: bus.capacity,
      status: bus.status as BusDto['status'],
      permitExpiry: bus.permitExpiry?.toISOString().slice(0, 10) ?? null,
      insuranceExpiry: bus.insuranceExpiry?.toISOString().slice(0, 10) ?? null,
      fitnessExpiry: bus.fitnessExpiry?.toISOString().slice(0, 10) ?? null,
      notes: bus.notes,
      createdAt: bus.createdAt.toISOString(),
      updatedAt: bus.updatedAt.toISOString(),
    };
  }
}
