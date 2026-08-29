import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * The single place that answers "is this parent allowed to touch this
 * student" — see docs/security.md#4-parent-data-access-boundary. Every
 * future parent-facing endpoint that takes a studentId MUST go through this
 * (directly, or via ParentChildAccessGuard), never trust a studentId from
 * the request as pre-authorized on its own.
 */
@Injectable()
export class ParentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Verified, non-revoked child links for a parent — used by /auth/me's linkedChildrenCount. */
  async getVerifiedChildIds(schoolId: string, parentId: string): Promise<string[]> {
    const links = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.parentStudent.findMany({
        where: { parentId, verified: true },
        select: { studentId: true },
      }),
    );
    return links.map((l) => l.studentId);
  }

  /**
   * Throws-free check for a specific student — the building block for
   * ParentChildAccessGuard and any future service method. Returns false for
   * an unverified link exactly the same as for no link at all, so a request
   * for a not-yet-verified sibling behaves identically to one for a
   * stranger's child (no information about the unverified link's existence
   * leaks either way).
   */
  async isVerifiedChild(schoolId: string, parentId: string, studentId: string): Promise<boolean> {
    const link = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.parentStudent.findFirst({
        where: { parentId, studentId, verified: true },
        select: { id: true },
      }),
    );
    return link !== null;
  }
}
