import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SchoolDto } from '@school-transport/shared-types';
import type { UpdateSchoolInput, UpdateSchoolStatusInput } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { RbacService } from '../auth/services/rbac.service';
import { AuditService } from '../common/audit/audit.service';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

@Injectable()
export class SchoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * A staff principal reading their OWN school goes through the normal
   * tenant-scoped path. Reading a DIFFERENT school requires
   * `platform.schools.read` and switches to the audited platform-admin path
   * — see docs/adr/0002-multi-tenancy-strategy.md and
   * docs/adr/0010-credential-resolution-rls-bypass.md. Returns 404 (never
   * 403) for a school that exists but the caller isn't authorized to see,
   * matching the cross-tenant-404 convention.
   */
  async getSchool(principal: AuthenticatedPrincipal, targetSchoolId: string): Promise<SchoolDto> {
    const school =
      targetSchoolId === principal.schoolId
        ? await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.school.findUnique({ where: { id: targetSchoolId } }))
        : await this.getOtherSchoolAsPlatformAdmin(principal, targetSchoolId);

    if (!school) throw new NotFoundException();
    return this.toDto(school);
  }

  async updateSchool(
    principal: AuthenticatedPrincipal,
    targetSchoolId: string,
    input: UpdateSchoolInput,
    meta: RequestMeta,
  ): Promise<SchoolDto> {
    if (targetSchoolId !== principal.schoolId) {
      // Routine profile updates are never a cross-tenant platform action,
      // even for SUPER_ADMIN — that would blur "platform operator" with
      // "this school's administrator." Out of scope for this phase.
      throw new NotFoundException();
    }

    const updated = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.school.update({
        where: { id: targetSchoolId },
        data: { ...input, address: input.address as Prisma.InputJsonValue | undefined },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'SCHOOL_UPDATED',
      subjectType: 'School',
      subjectId: targetSchoolId,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { fields: Object.keys(input) },
    });

    return this.toDto(updated);
  }

  /**
   * Status/lifecycle changes are platform-managed — see ADR 0011.
   * `@RequirePermission('platform.schools.manage')` on the controller is the
   * enforcement point (docs/security.md#22 — centralized, not scattered);
   * this method trusts that it already ran.
   */
  async updateStatus(
    principal: AuthenticatedPrincipal,
    targetSchoolId: string,
    input: UpdateSchoolStatusInput,
    meta: RequestMeta,
  ): Promise<SchoolDto> {
    const updated = await this.prisma.runAsPlatformAdmin((tx) =>
      tx.school.update({ where: { id: targetSchoolId }, data: { status: input.status } }),
    );

    await this.auditService.record(targetSchoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'SCHOOL_STATUS_CHANGED',
      subjectType: 'School',
      subjectId: targetSchoolId,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { newStatus: input.status, reason: input.reason },
    });

    return this.toDto(updated);
  }

  private async getOtherSchoolAsPlatformAdmin(principal: AuthenticatedPrincipal, targetSchoolId: string) {
    const hasPlatformRead = await this.rbacService.hasPermission(principal.schoolId, principal.id, 'platform.schools.read');
    if (!hasPlatformRead) throw new NotFoundException();

    const school = await this.prisma.runAsPlatformAdmin((tx) => tx.school.findUnique({ where: { id: targetSchoolId } }));

    if (school) {
      await this.auditService.record(targetSchoolId, {
        actorType: 'USER',
        actorId: principal.id,
        action: 'PLATFORM_SCHOOL_ACCESSED',
        subjectType: 'School',
        subjectId: targetSchoolId,
        metadata: { note: 'cross-tenant read via platform.schools.read', byUserId: principal.id },
      });
    }
    return school;
  }

  private toDto(school: {
    id: string;
    name: string;
    slug: string;
    status: string;
    contactEmail: string;
    contactPhone: string | null;
    address: unknown;
    timezone: string;
    createdAt: Date;
    updatedAt: Date;
  }): SchoolDto {
    return {
      id: school.id,
      name: school.name,
      slug: school.slug,
      status: school.status as SchoolDto['status'],
      contactEmail: school.contactEmail,
      contactPhone: school.contactPhone,
      address: (school.address as Record<string, unknown> | null) ?? null,
      timezone: school.timezone,
      createdAt: school.createdAt.toISOString(),
      updatedAt: school.updatedAt.toISOString(),
    };
  }
}
