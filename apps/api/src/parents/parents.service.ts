import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ParentDto, ParentStudentLinkDto, CursorPage } from '@school-transport/shared-types';
import type { CreateParentInput, UpdateParentInput, LinkStudentInput, ListParentsQuery } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { InvitationsService } from '../invitations/invitations.service';
import { AuditService } from '../common/audit/audit.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

@Injectable()
export class ParentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitationsService: InvitationsService,
    private readonly auditService: AuditService,
  ) {}

  async list(principal: AuthenticatedPrincipal, query: ListParentsQuery): Promise<CursorPage<ParentDto>> {
    const parents = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parent.findMany({
        where: {
          deletedAt: null,
          ...(query.search
            ? { OR: [{ fullName: { contains: query.search, mode: 'insensitive' } }, { phone: { contains: query.search } }] }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(parents, query.limit);
    return { data: page.data.map((p) => this.toDto(p)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<ParentDto> {
    const parent = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parent.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!parent) throw new NotFoundException();
    return this.toDto(parent);
  }

  async create(principal: AuthenticatedPrincipal, input: CreateParentInput, meta: RequestMeta): Promise<ParentDto> {
    const parent = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parent.create({
        data: {
          schoolId: principal.schoolId,
          phone: input.phone.trim(),
          fullName: input.fullName,
          email: input.email?.trim().toLowerCase(),
          status: 'INVITED',
        },
      }),
    );

    await this.invitationsService.issue({
      schoolId: principal.schoolId,
      principalType: 'PARENT',
      principalId: parent.id,
      fullName: parent.fullName,
      to: { email: parent.email, phone: parent.phone },
      invitedBy: principal.id,
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'PARENT_CREATED',
      subjectType: 'Parent',
      subjectId: parent.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(parent);
  }

  async update(principal: AuthenticatedPrincipal, id: string, input: UpdateParentInput, meta: RequestMeta): Promise<ParentDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parent.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException();

    const parent = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parent.update({
        where: { id },
        data: { fullName: input.fullName, email: input.email?.trim().toLowerCase() },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'PARENT_UPDATED',
      subjectType: 'Parent',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { fields: Object.keys(input) },
    });

    return this.toDto(parent);
  }

  async listLinks(principal: AuthenticatedPrincipal, parentId: string): Promise<ParentStudentLinkDto[]> {
    const parent = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parent.findFirst({ where: { id: parentId, deletedAt: null } }),
    );
    if (!parent) throw new NotFoundException();

    const links = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parentStudent.findMany({ where: { parentId }, include: { student: true }, orderBy: { createdAt: 'desc' } }),
    );
    return links.map((l) => this.linkToDto(l));
  }

  async linkStudent(
    principal: AuthenticatedPrincipal,
    parentId: string,
    input: LinkStudentInput,
    meta: RequestMeta,
  ): Promise<ParentStudentLinkDto> {
    const [parent, student] = await Promise.all([
      this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.parent.findFirst({ where: { id: parentId, deletedAt: null } })),
      this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.student.findFirst({ where: { id: input.studentId, deletedAt: null } })),
    ]);
    if (!parent || !student) throw new NotFoundException();

    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parentStudent.findFirst({ where: { parentId, studentId: input.studentId } }),
    );
    if (existing) {
      throw new BadRequestException('This parent is already linked to this student.');
    }

    const link = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parentStudent.create({
        data: {
          schoolId: principal.schoolId,
          parentId,
          studentId: input.studentId,
          relationship: input.relationship,
          verified: false,
        },
        include: { student: true },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'PARENT_STUDENT_LINKED',
      subjectType: 'ParentStudent',
      subjectId: link.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { parentId, studentId: input.studentId },
    });

    return this.linkToDto(link);
  }

  /** A school staff member confirms a pending link — see docs/database.md's parent_students.verified semantics. */
  async verifyLink(principal: AuthenticatedPrincipal, linkId: string, meta: RequestMeta): Promise<ParentStudentLinkDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parentStudent.findUnique({ where: { id: linkId } }),
    );
    if (!existing) throw new NotFoundException();

    const link = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parentStudent.update({
        where: { id: linkId },
        data: { verified: true, verifiedBy: principal.id, verifiedAt: new Date() },
        include: { student: true },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'PARENT_STUDENT_VERIFIED',
      subjectType: 'ParentStudent',
      subjectId: linkId,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.linkToDto(link);
  }

  async unlink(principal: AuthenticatedPrincipal, linkId: string, meta: RequestMeta): Promise<void> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parentStudent.findUnique({ where: { id: linkId } }),
    );
    if (!existing) throw new NotFoundException();

    await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.parentStudent.delete({ where: { id: linkId } }));

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'PARENT_STUDENT_UNLINKED',
      subjectType: 'ParentStudent',
      subjectId: linkId,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { parentId: existing.parentId, studentId: existing.studentId },
    });
  }

  private toDto(parent: {
    id: string;
    phone: string;
    email: string | null;
    fullName: string;
    status: string;
    createdAt: Date;
  }): ParentDto {
    return {
      id: parent.id,
      phone: parent.phone,
      email: parent.email,
      fullName: parent.fullName,
      status: parent.status as ParentDto['status'],
      createdAt: parent.createdAt.toISOString(),
    };
  }

  private linkToDto(link: {
    id: string;
    studentId: string;
    relationship: string;
    verified: boolean;
    verifiedAt: Date | null;
    createdAt: Date;
    student: { fullName: string };
  }): ParentStudentLinkDto {
    return {
      id: link.id,
      studentId: link.studentId,
      studentFullName: link.student.fullName,
      relationship: link.relationship,
      verified: link.verified,
      verifiedAt: link.verifiedAt?.toISOString() ?? null,
      createdAt: link.createdAt.toISOString(),
    };
  }
}
