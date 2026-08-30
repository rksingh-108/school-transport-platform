import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AttendantDto, CursorPage } from '@school-transport/shared-types';
import type { CreateAttendantInput, ListAttendantsQuery } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

type AttendantRow = {
  id: string;
  userId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  user: { fullName: string; email: string };
};

const attendantInclude = { user: { select: { fullName: true, email: true } } } as const;

@Injectable()
export class AttendantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(principal: AuthenticatedPrincipal, query: ListAttendantsQuery): Promise<CursorPage<AttendantDto>> {
    const attendants = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.attendant.findMany({
        where: {
          deletedAt: null,
          status: query.status,
          ...(query.search
            ? {
                OR: [
                  { user: { fullName: { contains: query.search, mode: 'insensitive' } } },
                  { user: { email: { contains: query.search, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        include: attendantInclude,
        orderBy: { createdAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(attendants, query.limit);
    return { data: page.data.map((a) => this.toDto(a)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<AttendantDto> {
    const attendant = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.attendant.findFirst({ where: { id, deletedAt: null }, include: attendantInclude }),
    );
    if (!attendant) throw new NotFoundException();
    return this.toDto(attendant);
  }

  async create(principal: AuthenticatedPrincipal, input: CreateAttendantInput, meta: RequestMeta): Promise<AttendantDto> {
    const [user, existingProfile] = await Promise.all([
      this.prisma.runInTenantContext(principal.schoolId, (tx) =>
        tx.user.findFirst({ where: { id: input.userId, deletedAt: null } }),
      ),
      this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.attendant.findUnique({ where: { userId: input.userId } })),
    ]);
    if (!user) throw new NotFoundException('No such staff member in this school.');
    if (existingProfile) throw new BadRequestException('This staff member already has an attendant profile.');

    const attendant = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.attendant.create({
        data: { schoolId: principal.schoolId, userId: input.userId },
        include: attendantInclude,
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'ATTENDANT_CREATED',
      subjectType: 'Attendant',
      subjectId: attendant.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(attendant);
  }

  async activate(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<AttendantDto> {
    return this.setStatus(principal, id, 'ACTIVE', 'ATTENDANT_ACTIVATED', meta);
  }

  async deactivate(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<AttendantDto> {
    return this.setStatus(principal, id, 'INACTIVE', 'ATTENDANT_DEACTIVATED', meta);
  }

  private async setStatus(
    principal: AuthenticatedPrincipal,
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
    action: 'ATTENDANT_ACTIVATED' | 'ATTENDANT_DEACTIVATED',
    meta: RequestMeta,
  ): Promise<AttendantDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.attendant.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException();

    const attendant = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.attendant.update({ where: { id }, data: { status }, include: attendantInclude }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action,
      subjectType: 'Attendant',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(attendant);
  }

  private toDto(attendant: AttendantRow): AttendantDto {
    return {
      id: attendant.id,
      userId: attendant.userId,
      fullName: attendant.user.fullName,
      email: attendant.user.email,
      status: attendant.status as AttendantDto['status'],
      createdAt: attendant.createdAt.toISOString(),
      updatedAt: attendant.updatedAt.toISOString(),
    };
  }
}
