import { Injectable, NotFoundException } from '@nestjs/common';
import type { ParentLinkedChildDto } from '@school-transport/shared-types';
import { PrismaService } from '../database/prisma.service';
import type { AuthenticatedPrincipal } from '../auth/types/principal';

/**
 * Parent-facing reads only — every query is scoped through the parent's own
 * VERIFIED parent_students links (docs/security.md#4-parent-data-access-boundary),
 * never a raw studentId. The DTO returned is deliberately minimal: no
 * school-internal fields, no other students, nothing beyond what a parent
 * needs to identify their own child. Bus/trip/attendance fields are not
 * added here — those features don't exist yet (Phase 1 later steps); the
 * shape is prepared (docs/security.md#12-parent-data-exposure) but not
 * populated ahead of the features that would supply real data for it.
 */
@Injectable()
export class ParentSelfService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyChildren(principal: AuthenticatedPrincipal): Promise<ParentLinkedChildDto[]> {
    const links = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parentStudent.findMany({
        where: { parentId: principal.id, verified: true },
        include: { student: { select: { id: true, fullName: true, grade: true, section: true, deletedAt: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );

    return links
      .filter((link) => !link.student.deletedAt)
      .map((link) => ({
        id: link.student.id,
        fullName: link.student.fullName,
        grade: link.student.grade,
        section: link.student.section,
      }));
  }

  /**
   * ParentChildAccessGuard (`@RequireVerifiedChild('studentId')` on the
   * controller route) has already confirmed this parent has a verified link
   * to this exact studentId before this method ever runs — this is belt-and-
   * braces re-verification, not the primary control, matching the same
   * "narrow, redundant is fine for the highest-sensitivity boundary" posture
   * as docs/security.md#4.
   */
  async getMyChild(principal: AuthenticatedPrincipal, studentId: string): Promise<ParentLinkedChildDto> {
    const link = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parentStudent.findFirst({
        where: { parentId: principal.id, studentId, verified: true },
        include: { student: { select: { id: true, fullName: true, grade: true, section: true, deletedAt: true } } },
      }),
    );
    if (!link || link.student.deletedAt) throw new NotFoundException();

    return { id: link.student.id, fullName: link.student.fullName, grade: link.student.grade, section: link.student.section };
  }
}
