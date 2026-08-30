import { Injectable, NotFoundException } from '@nestjs/common';
import type { ParentChildWithTransportDto, ParentLinkedChildDto } from '@school-transport/shared-types';
import { PrismaService } from '../database/prisma.service';
import { ParentTransportService } from './parent-transport.service';
import type { AuthenticatedPrincipal } from '../auth/types/principal';

/**
 * Parent-facing reads only — every query is scoped through the parent's own
 * VERIFIED parent_students links (docs/security.md#4-parent-data-access-boundary),
 * never a raw studentId. The DTO returned is deliberately minimal: no
 * school-internal fields, no other students, nothing beyond what a parent
 * needs to identify their own child (plus, since Phase 1 Step 8, a
 * transport summary — see `getMyChildren` below and
 * docs/adr/0015-parent-transport-tracking.md).
 */
@Injectable()
export class ParentSelfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parentTransportService: ParentTransportService,
  ) {}

  /**
   * Enriched with a per-child transport summary (Phase 1 Step 8) so the "My
   * Children" dashboard never needs a follow-up request per child. Resolved
   * once per verified child in parallel — bounded by how many children this
   * one parent has (never school-wide), not the N+1 pattern the "avoid
   * N+1" requirement is about.
   */
  async getMyChildren(principal: AuthenticatedPrincipal): Promise<ParentChildWithTransportDto[]> {
    const links = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.parentStudent.findMany({
        where: { parentId: principal.id, verified: true },
        include: { student: { select: { id: true, fullName: true, grade: true, section: true, deletedAt: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );

    const activeLinks = links.filter((link) => !link.student.deletedAt);
    return Promise.all(
      activeLinks.map(async (link) => ({
        id: link.student.id,
        fullName: link.student.fullName,
        grade: link.student.grade,
        section: link.student.section,
        transport: await this.parentTransportService.getSummary(principal.schoolId, link.student.id),
      })),
    );
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
