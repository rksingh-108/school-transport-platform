import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { StaffDto, CursorPage } from '@school-transport/shared-types';
import type {
  InviteStaffInput,
  UpdateStaffInput,
  AssignStaffRolesInput,
  ListStaffQuery,
} from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { RbacService } from '../auth/services/rbac.service';
import { InvitationsService } from '../invitations/invitations.service';
import { AuditService } from '../common/audit/audit.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
    private readonly invitationsService: InvitationsService,
    private readonly auditService: AuditService,
  ) {}

  async list(principal: AuthenticatedPrincipal, query: ListStaffQuery): Promise<CursorPage<StaffDto>> {
    const users = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.user.findMany({
        where: {
          deletedAt: null,
          status: query.status,
          ...(query.search
            ? { OR: [{ fullName: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }] }
            : {}),
        },
        include: { userRoles: { include: { role: true } } },
        orderBy: { createdAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(users, query.limit);
    return { data: page.data.map((u) => this.toDto(u)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<StaffDto> {
    const user = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.user.findFirst({ where: { id, deletedAt: null }, include: { userRoles: { include: { role: true } } } }),
    );
    if (!user) throw new NotFoundException();
    return this.toDto(user);
  }

  async invite(principal: AuthenticatedPrincipal, input: InviteStaffInput, meta: RequestMeta): Promise<StaffDto> {
    await this.assertCanAssignRoles(principal, input.roleKeys);

    const normalizedEmail = input.email.trim().toLowerCase();
    const roles = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.role.findMany({ where: { key: { in: input.roleKeys }, schoolId: null } }),
    );
    if (roles.length !== new Set(input.roleKeys).size) {
      throw new BadRequestException('One or more roles are not recognized.');
    }

    const user = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.user.create({
        data: {
          schoolId: principal.schoolId,
          email: normalizedEmail,
          fullName: input.fullName,
          status: 'INVITED',
          userRoles: { create: roles.map((role) => ({ roleId: role.id })) },
        },
        include: { userRoles: { include: { role: true } } },
      }),
    );

    await this.invitationsService.issue({
      schoolId: principal.schoolId,
      principalType: 'STAFF',
      principalId: user.id,
      fullName: user.fullName,
      to: { email: user.email },
      invitedBy: principal.id,
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'STAFF_INVITED',
      subjectType: 'User',
      subjectId: user.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { roles: input.roleKeys },
    });

    return this.toDto(user);
  }

  async resendInvitation(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.user.findFirst({ where: { id, deletedAt: null, status: 'INVITED' } }),
    );
    if (!user) throw new NotFoundException();

    await this.invitationsService.issue({
      schoolId: principal.schoolId,
      principalType: 'STAFF',
      principalId: user.id,
      fullName: user.fullName,
      to: { email: user.email },
      invitedBy: principal.id,
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'STAFF_INVITATION_RESENT',
      subjectType: 'User',
      subjectId: user.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
  }

  async update(principal: AuthenticatedPrincipal, id: string, input: UpdateStaffInput, meta: RequestMeta): Promise<StaffDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.user.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException();

    const user = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.user.update({
        where: { id },
        data: { fullName: input.fullName, email: input.email?.trim().toLowerCase() },
        include: { userRoles: { include: { role: true } } },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'STAFF_UPDATED',
      subjectType: 'User',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { fields: Object.keys(input) },
    });

    return this.toDto(user);
  }

  async assignRoles(
    principal: AuthenticatedPrincipal,
    id: string,
    input: AssignStaffRolesInput,
    meta: RequestMeta,
  ): Promise<StaffDto> {
    await this.assertCanAssignRoles(principal, input.roleKeys);

    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.user.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException();

    const roles = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.role.findMany({ where: { key: { in: input.roleKeys }, schoolId: null } }),
    );
    if (roles.length !== new Set(input.roleKeys).size) {
      throw new BadRequestException('One or more roles are not recognized.');
    }

    const user = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      return tx.user.update({
        where: { id },
        data: { userRoles: { create: roles.map((role) => ({ roleId: role.id })) } },
        include: { userRoles: { include: { role: true } } },
      });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'STAFF_ROLES_UPDATED',
      subjectType: 'User',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { roles: input.roleKeys },
    });

    return this.toDto(user);
  }

  async suspend(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<StaffDto> {
    if (id === principal.id) {
      throw new BadRequestException('You cannot suspend your own account.');
    }
    return this.setStatus(principal, id, 'SUSPENDED', 'STAFF_SUSPENDED', meta);
  }

  async activate(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<StaffDto> {
    return this.setStatus(principal, id, 'ACTIVE', 'STAFF_ACTIVATED', meta);
  }

  private async setStatus(
    principal: AuthenticatedPrincipal,
    id: string,
    status: 'ACTIVE' | 'SUSPENDED',
    action: 'STAFF_SUSPENDED' | 'STAFF_ACTIVATED',
    meta: RequestMeta,
  ): Promise<StaffDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.user.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException();
    if (existing.status === 'INVITED') {
      throw new BadRequestException('An invited account must accept its invitation before its status can change.');
    }

    const user = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.user.update({ where: { id }, data: { status }, include: { userRoles: { include: { role: true } } } }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action,
      subjectType: 'User',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(user);
  }

  /**
   * Privilege-escalation guard (docs/security.md#8-staff-authorization):
   * granting SUPER_ADMIN is never available through ordinary role
   * assignment, regardless of the caller's own permissions — only a
   * SUPER_ADMIN can grant SUPER_ADMIN. PARENT is never assignable here at
   * all (structurally excluded by the DTO's role enum already, but checked
   * again here as defense-in-depth).
   */
  private async assertCanAssignRoles(principal: AuthenticatedPrincipal, roleKeys: readonly string[]): Promise<void> {
    if (roleKeys.includes('PARENT')) {
      throw new BadRequestException('PARENT is not a staff role.');
    }
    if (roleKeys.includes('SUPER_ADMIN')) {
      const { roles } = await this.rbacService.getRolesAndPermissions(principal.schoolId, principal.id);
      if (!roles.includes('SUPER_ADMIN')) {
        throw new ForbiddenException('Only a platform administrator can grant the SUPER_ADMIN role.');
      }
    }
  }

  private toDto(user: {
    id: string;
    email: string;
    fullName: string;
    status: string;
    lastLoginAt: Date | null;
    createdAt: Date;
    userRoles: { role: { key: string } }[];
  }): StaffDto {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      status: user.status as StaffDto['status'],
      roles: user.userRoles.map((ur) => ur.role.key) as StaffDto['roles'],
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
