import { Injectable } from '@nestjs/common';
import type { ActorType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type AuthAuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'LOGOUT_ALL'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'REFRESH_TOKEN_ROTATED'
  | 'REFRESH_TOKEN_REUSE_DETECTED'
  | 'ACCOUNT_SUSPENDED_LOGIN_ATTEMPT';

/**
 * Thin wrapper over the existing audit_logs table (docs/security.md#22) for
 * authentication events specifically. Never receives a password, token, or
 * secret in `metadata` — callers pass only safe, already-redacted context.
 */
@Injectable()
export class AuthAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** For events where the tenant/actor IS known (successful or near-miss auth on a real account). */
  async recordInTenant(
    schoolId: string,
    params: {
      actorType: ActorType;
      actorId?: string;
      action: AuthAuditAction;
      requestId?: string;
      ipAddress?: string;
      metadata?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.auditLog.create({
        data: {
          schoolId,
          actorType: params.actorType,
          actorId: params.actorId,
          action: params.action,
          requestId: params.requestId,
          ipAddress: params.ipAddress,
          metadata: params.metadata,
        },
      }),
    );
  }

  /**
   * For events where no tenant can be established (e.g. a failed login
   * attempt against an identifier that doesn't match any account in any
   * school) — a narrow, audited use of the platform-admin path, matching
   * docs/adr/0010-credential-resolution-rls-bypass.md.
   */
  async recordWithoutTenant(params: {
    action: AuthAuditAction;
    requestId?: string;
    ipAddress?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.runAsPlatformAdmin((tx) =>
      tx.auditLog.create({
        data: {
          schoolId: null,
          actorType: 'SYSTEM',
          action: params.action,
          requestId: params.requestId,
          ipAddress: params.ipAddress,
          metadata: params.metadata,
        },
      }),
    );
  }
}
