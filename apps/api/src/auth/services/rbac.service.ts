import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Resolves a staff user's roles/permissions fresh from the database on every
 * call — deliberately not cached in the JWT, so revoking a role takes effect
 * on the very next request rather than only after the access token expires.
 * Shared by PermissionsGuard and the /auth/me endpoint so there is exactly
 * one place this query lives — see docs/security.md#22-enforcement--centralized-not-scattered.
 */
@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  async getRolesAndPermissions(
    schoolId: string,
    userId: string,
  ): Promise<{ roles: string[]; permissions: string[] }> {
    const userRoles = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.userRole.findMany({
        where: { userId },
        include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
      }),
    );

    const roles = new Set<string>();
    const permissions = new Set<string>();
    for (const userRole of userRoles) {
      roles.add(userRole.role.key);
      for (const rolePermission of userRole.role.rolePermissions) {
        permissions.add(rolePermission.permission.key);
      }
    }

    return { roles: [...roles], permissions: [...permissions] };
  }

  async hasPermission(schoolId: string, userId: string, permissionKey: string): Promise<boolean> {
    const { permissions } = await this.getRolesAndPermissions(schoolId, userId);
    return permissions.includes(permissionKey);
  }
}
