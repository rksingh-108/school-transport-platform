import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { AuthPrincipalType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';
import {
  AUTH_NOTIFICATION_ADAPTER,
  type AuthNotificationAdapter,
} from '../auth/notifications/notification-adapter.interface';
import { AuditService } from '../common/audit/audit.service';
import type { RequestMeta } from '../auth/services/auth.service';

export interface IssueInvitationParams {
  schoolId: string;
  principalType: AuthPrincipalType;
  principalId: string;
  fullName: string;
  to: { email?: string | null; phone?: string | null };
  invitedBy: string;
}

/**
 * Shared onboarding mechanism for BOTH staff (User) and parent (Parent)
 * accounts — see the Invitation model's doc comment in schema.prisma. Reused
 * by UsersService (explicit invite) and ParentsService (implicit invite on
 * create), rather than duplicated, since the token/expiry/notification
 * mechanics are identical for both audiences.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly passwordService: PasswordService,
    private readonly auditService: AuditService,
    @Inject(AUTH_NOTIFICATION_ADAPTER) private readonly notificationAdapter: AuthNotificationAdapter,
  ) {}

  /** Creates a fresh invitation, or re-issues (new token/expiry) an existing unaccepted one. */
  async issue(params: IssueInvitationParams): Promise<void> {
    const { raw, hash } = this.tokenService.generateOpaqueToken();
    const expiresAt = this.tokenService.invitationTokenExpiresAt();

    await this.prisma.runInTenantContext(params.schoolId, (tx) =>
      tx.invitation.upsert({
        where: {
          principalType_principalId: { principalType: params.principalType, principalId: params.principalId },
        },
        update: { tokenHash: hash, expiresAt, invitedBy: params.invitedBy, acceptedAt: null, revokedAt: null },
        create: {
          schoolId: params.schoolId,
          principalType: params.principalType,
          principalId: params.principalId,
          tokenHash: hash,
          expiresAt,
          invitedBy: params.invitedBy,
        },
      }),
    );

    await this.notificationAdapter.sendInvitationLink({
      to: params.to,
      principalType: params.principalType,
      fullName: params.fullName,
      invitationToken: raw,
    });
  }

  async revoke(schoolId: string, invitationId: string): Promise<void> {
    await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.invitation.update({ where: { id: invitationId }, data: { revokedAt: new Date() } }),
    );
  }

  /**
   * The invitee is not authenticated — this is the same pre-tenant
   * credential-resolution shape as password-reset-confirm (docs/adr/0010),
   * so the lookup goes through runAsPlatformAdmin() and every subsequent
   * write switches to the tenant-scoped path once the schoolId is known.
   */
  async accept(rawToken: string, newPassword: string, meta: RequestMeta): Promise<{ principalType: AuthPrincipalType }> {
    const hash = this.tokenService.hashOpaqueToken(rawToken);
    const invitation = await this.prisma.runAsPlatformAdmin((tx) => tx.invitation.findUnique({ where: { tokenHash: hash } }));

    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired invitation link.');
    }

    const passwordHash = await this.passwordService.hash(newPassword);

    await this.prisma.runInTenantContext(invitation.schoolId, async (tx) => {
      if (invitation.principalType === 'STAFF') {
        await tx.user.update({ where: { id: invitation.principalId }, data: { passwordHash, status: 'ACTIVE' } });
      } else {
        await tx.parent.update({ where: { id: invitation.principalId }, data: { passwordHash, status: 'ACTIVE' } });
      }
      await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    });

    await this.auditService.record(invitation.schoolId, {
      actorType: invitation.principalType === 'STAFF' ? 'USER' : 'PARENT',
      actorId: invitation.principalId,
      action: invitation.principalType === 'STAFF' ? 'STAFF_INVITATION_ACCEPTED' : 'PARENT_INVITATION_ACCEPTED',
      subjectType: invitation.principalType,
      subjectId: invitation.principalId,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return { principalType: invitation.principalType };
  }
}
