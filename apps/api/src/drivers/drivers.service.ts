import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DriverDto, CursorPage } from '@school-transport/shared-types';
import type { CreateDriverInput, UpdateDriverInput, ListDriversQuery } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

type DriverRow = {
  id: string;
  userId: string;
  licenseNumber: string;
  licenseExpiry: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  user: { fullName: string; email: string };
};

const driverInclude = { user: { select: { fullName: true, email: true } } } as const;

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(principal: AuthenticatedPrincipal, query: ListDriversQuery): Promise<CursorPage<DriverDto>> {
    const drivers = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.driver.findMany({
        where: {
          deletedAt: null,
          status: query.status,
          ...(query.search
            ? {
                OR: [
                  { licenseNumber: { contains: query.search, mode: 'insensitive' } },
                  { user: { fullName: { contains: query.search, mode: 'insensitive' } } },
                  { user: { email: { contains: query.search, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        include: driverInclude,
        orderBy: { createdAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(drivers, query.limit);
    return { data: page.data.map((d) => this.toDto(d)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<DriverDto> {
    const driver = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.driver.findFirst({ where: { id, deletedAt: null }, include: driverInclude }),
    );
    if (!driver) throw new NotFoundException();
    return this.toDto(driver);
  }

  async create(principal: AuthenticatedPrincipal, input: CreateDriverInput, meta: RequestMeta): Promise<DriverDto> {
    const [user, existingProfile] = await Promise.all([
      this.prisma.runInTenantContext(principal.schoolId, (tx) =>
        tx.user.findFirst({ where: { id: input.userId, deletedAt: null } }),
      ),
      this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.driver.findUnique({ where: { userId: input.userId } })),
    ]);
    if (!user) throw new NotFoundException('No such staff member in this school.');
    if (existingProfile) throw new BadRequestException('This staff member already has a driver profile.');

    const driver = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.driver.create({
        data: {
          schoolId: principal.schoolId,
          userId: input.userId,
          licenseNumber: input.licenseNumber,
          licenseExpiry: input.licenseExpiry ? new Date(input.licenseExpiry) : undefined,
        },
        include: driverInclude,
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'DRIVER_CREATED',
      subjectType: 'Driver',
      subjectId: driver.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(driver);
  }

  async update(
    principal: AuthenticatedPrincipal,
    id: string,
    input: UpdateDriverInput,
    meta: RequestMeta,
  ): Promise<DriverDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.driver.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException();

    const driver = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.driver.update({
        where: { id },
        data: {
          licenseNumber: input.licenseNumber,
          licenseExpiry: input.licenseExpiry ? new Date(input.licenseExpiry) : undefined,
        },
        include: driverInclude,
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'DRIVER_UPDATED',
      subjectType: 'Driver',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { fields: Object.keys(input) },
    });

    return this.toDto(driver);
  }

  async activate(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<DriverDto> {
    return this.setStatus(principal, id, 'ACTIVE', 'DRIVER_ACTIVATED', meta);
  }

  async deactivate(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<DriverDto> {
    return this.setStatus(principal, id, 'INACTIVE', 'DRIVER_DEACTIVATED', meta);
  }

  private async setStatus(
    principal: AuthenticatedPrincipal,
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
    action: 'DRIVER_ACTIVATED' | 'DRIVER_DEACTIVATED',
    meta: RequestMeta,
  ): Promise<DriverDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.driver.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException();

    const driver = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.driver.update({ where: { id }, data: { status }, include: driverInclude }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action,
      subjectType: 'Driver',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(driver);
  }

  private toDto(driver: DriverRow): DriverDto {
    return {
      id: driver.id,
      userId: driver.userId,
      fullName: driver.user.fullName,
      email: driver.user.email,
      licenseNumber: driver.licenseNumber,
      licenseExpiry: driver.licenseExpiry?.toISOString().slice(0, 10) ?? null,
      status: driver.status as DriverDto['status'],
      createdAt: driver.createdAt.toISOString(),
      updatedAt: driver.updatedAt.toISOString(),
    };
  }
}
