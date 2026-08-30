import { Injectable, NotFoundException } from '@nestjs/common';
import type { StudentDto, CursorPage } from '@school-transport/shared-types';
import type { CreateStudentInput, UpdateStudentInput, ListStudentsQuery } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(principal: AuthenticatedPrincipal, query: ListStudentsQuery): Promise<CursorPage<StudentDto>> {
    const students = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.student.findMany({
        where: {
          deletedAt: null,
          grade: query.grade,
          section: query.section,
          status: query.status,
          ...(query.search
            ? {
                OR: [
                  { fullName: { contains: query.search, mode: 'insensitive' } },
                  { admissionNumber: { contains: query.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(students, query.limit);
    return { data: page.data.map((s) => this.toDto(s)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<StudentDto> {
    const student = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.student.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!student) throw new NotFoundException();
    return this.toDto(student);
  }

  async create(principal: AuthenticatedPrincipal, input: CreateStudentInput, meta: RequestMeta): Promise<StudentDto> {
    const student = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.student.create({
        data: {
          schoolId: principal.schoolId,
          admissionNumber: input.admissionNumber,
          fullName: input.fullName,
          dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
          grade: input.grade,
          section: input.section,
        },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'STUDENT_CREATED',
      subjectType: 'Student',
      subjectId: student.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(student);
  }

  async update(
    principal: AuthenticatedPrincipal,
    id: string,
    input: UpdateStudentInput,
    meta: RequestMeta,
  ): Promise<StudentDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.student.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException();

    const student = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.student.update({
        where: { id },
        data: {
          admissionNumber: input.admissionNumber,
          fullName: input.fullName,
          dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
          grade: input.grade,
          section: input.section,
        },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'STUDENT_UPDATED',
      subjectType: 'Student',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { fields: Object.keys(input) },
    });

    return this.toDto(student);
  }

  async archive(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<StudentDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.student.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException();

    const student = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.student.update({ where: { id }, data: { status: 'INACTIVE' } }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'STUDENT_ARCHIVED',
      subjectType: 'Student',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(student);
  }

  private toDto(student: {
    id: string;
    admissionNumber: string;
    fullName: string;
    dateOfBirth: Date | null;
    grade: string | null;
    section: string | null;
    status: string;
    createdAt: Date;
  }): StudentDto {
    return {
      id: student.id,
      admissionNumber: student.admissionNumber,
      fullName: student.fullName,
      dateOfBirth: student.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      grade: student.grade,
      section: student.section,
      status: student.status as StudentDto['status'],
      createdAt: student.createdAt.toISOString(),
    };
  }
}
