import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthPrincipalType } from '@prisma/client';
import type { MeResponse } from '@school-transport/shared-types';
import { PrismaService } from '../../database/prisma.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { RbacService } from './rbac.service';
import { ParentAccessService } from './parent-access.service';
import { FailedLoginTrackerService } from './failed-login-tracker.service';
import { AuthAuditService } from './auth-audit.service';
import { AUTH_NOTIFICATION_ADAPTER, type AuthNotificationAdapter } from '../notifications/notification-adapter.interface';
import type { AuthenticatedPrincipal } from '../types/principal';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export type LoginResult =
  | {
      status: 'OK';
      accessToken: string;
      accessTokenExpiresAt: Date;
      refreshTokenRaw: string;
      refreshTokenExpiresAt: Date;
      principal: MeResponse;
    }
  | { status: 'MFA_REQUIRED' };

export interface RefreshResult {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenRaw: string;
  refreshTokenExpiresAt: Date;
  principal: MeResponse;
}

const GENERIC_INVALID_CREDENTIALS = 'Invalid email/phone or password.';
const GENERIC_INVALID_REFRESH = 'Invalid refresh token.';
const GENERIC_RESET_RESPONSE = 'If an account exists, a password reset link has been sent.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly rbacService: RbacService,
    private readonly parentAccessService: ParentAccessService,
    private readonly failedLoginTracker: FailedLoginTrackerService,
    private readonly auditService: AuthAuditService,
    @Inject(AUTH_NOTIFICATION_ADAPTER) private readonly notificationAdapter: AuthNotificationAdapter,
  ) {}

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  async loginStaff(email: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const normalizedEmail = email.trim().toLowerCase();

    if (await this.failedLoginTracker.isLocked('STAFF', normalizedEmail)) {
      throw new UnauthorizedException('Too many attempts. Please try again later.');
    }

    // Credential resolution necessarily crosses tenant boundaries — see
    // docs/adr/0010-credential-resolution-rls-bypass.md. email is unique
    // per-school, not globally, so more than one match is a real (if rare)
    // possibility; we fail closed rather than guess.
    const matches = await this.prisma.runAsPlatformAdmin((tx) =>
      tx.user.findMany({ where: { email: normalizedEmail, deletedAt: null } }),
    );

    if (matches.length !== 1) {
      await this.failedLoginTracker.recordFailure('STAFF', normalizedEmail);
      await this.auditService.recordWithoutTenant({
        action: 'LOGIN_FAILURE',
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { audience: 'STAFF', reason: matches.length === 0 ? 'NOT_FOUND' : 'AMBIGUOUS', matchCount: matches.length },
      });
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS);
    }

    const user = matches[0]!;

    if (user.status !== 'ACTIVE' || !(await this.isSchoolOperational(user.schoolId))) {
      await this.failedLoginTracker.recordFailure('STAFF', normalizedEmail);
      await this.auditService.recordInTenant(user.schoolId, {
        actorType: 'USER',
        actorId: user.id,
        action: 'LOGIN_FAILURE',
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { reason: 'ACCOUNT_NOT_ACTIVE', status: user.status },
      });
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS);
    }

    if (!user.passwordHash || !(await this.passwordService.verify(user.passwordHash, password))) {
      await this.failedLoginTracker.recordFailure('STAFF', normalizedEmail);
      await this.auditService.recordInTenant(user.schoolId, {
        actorType: 'USER',
        actorId: user.id,
        action: 'LOGIN_FAILURE',
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { reason: 'BAD_PASSWORD' },
      });
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS);
    }

    // MFA-ready state machine (docs/adr/0004-auth-strategy.md): no TOTP
    // enrollment/verification exists yet, so this branch cannot currently be
    // reached by any seeded or ordinarily-created account — but the check
    // itself is real, not a stub, and is exercised in tests by flipping
    // mfaEnabled directly. See docs/roadmap.md for the deferred MFA verify step.
    if (user.mfaEnabled) {
      return { status: 'MFA_REQUIRED' };
    }

    await this.failedLoginTracker.reset('STAFF', normalizedEmail);

    const session = await this.createSession('STAFF', user.id, user.schoolId, meta);

    await this.prisma.runInTenantContext(user.schoolId, (tx) =>
      tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    );

    await this.auditService.recordInTenant(user.schoolId, {
      actorType: 'USER',
      actorId: user.id,
      action: 'LOGIN_SUCCESS',
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    const { roles, permissions } = await this.rbacService.getRolesAndPermissions(user.schoolId, user.id);

    return {
      status: 'OK',
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshTokenRaw: session.refreshTokenRaw,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt,
      principal: await this.buildStaffMeResponse(user.schoolId, user.id, roles, permissions),
    };
  }

  async loginParent(phone: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const normalizedPhone = phone.trim();

    if (await this.failedLoginTracker.isLocked('PARENT', normalizedPhone)) {
      throw new UnauthorizedException('Too many attempts. Please try again later.');
    }

    const matches = await this.prisma.runAsPlatformAdmin((tx) =>
      tx.parent.findMany({ where: { phone: normalizedPhone, deletedAt: null } }),
    );

    if (matches.length !== 1) {
      await this.failedLoginTracker.recordFailure('PARENT', normalizedPhone);
      await this.auditService.recordWithoutTenant({
        action: 'LOGIN_FAILURE',
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { audience: 'PARENT', reason: matches.length === 0 ? 'NOT_FOUND' : 'AMBIGUOUS', matchCount: matches.length },
      });
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS);
    }

    const parent = matches[0]!;

    if (parent.status !== 'ACTIVE' || !parent.passwordHash || !(await this.isSchoolOperational(parent.schoolId))) {
      await this.failedLoginTracker.recordFailure('PARENT', normalizedPhone);
      await this.auditService.recordInTenant(parent.schoolId, {
        actorType: 'PARENT',
        actorId: parent.id,
        action: 'LOGIN_FAILURE',
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { reason: 'ACCOUNT_NOT_ACTIVE', status: parent.status },
      });
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS);
    }

    if (!(await this.passwordService.verify(parent.passwordHash, password))) {
      await this.failedLoginTracker.recordFailure('PARENT', normalizedPhone);
      await this.auditService.recordInTenant(parent.schoolId, {
        actorType: 'PARENT',
        actorId: parent.id,
        action: 'LOGIN_FAILURE',
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { reason: 'BAD_PASSWORD' },
      });
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS);
    }

    await this.failedLoginTracker.reset('PARENT', normalizedPhone);

    const session = await this.createSession('PARENT', parent.id, parent.schoolId, meta);

    await this.auditService.recordInTenant(parent.schoolId, {
      actorType: 'PARENT',
      actorId: parent.id,
      action: 'LOGIN_SUCCESS',
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return {
      status: 'OK',
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshTokenRaw: session.refreshTokenRaw,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt,
      principal: await this.buildParentMeResponse(parent.schoolId, parent.id),
    };
  }

  private async createSession(
    principalType: AuthPrincipalType,
    principalId: string,
    schoolId: string,
    meta: RequestMeta,
  ) {
    const { raw, hash } = this.tokenService.generateOpaqueToken();
    const sessionId = randomUUID();
    const refreshTokenExpiresAt = this.tokenService.refreshTokenExpiresAt();

    await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.refreshToken.create({
        data: {
          schoolId,
          principalType,
          principalId,
          sessionId,
          tokenHash: hash,
          expiresAt: refreshTokenExpiresAt,
          userAgent: meta.userAgent,
          ipAddress: meta.ip,
        },
      }),
    );

    const { token: accessToken, expiresAt: accessTokenExpiresAt } = this.tokenService.signAccessToken({
      type: principalType,
      id: principalId,
      schoolId,
    });

    return { accessToken, accessTokenExpiresAt, refreshTokenRaw: raw, refreshTokenExpiresAt };
  }

  // -------------------------------------------------------------------------
  // Refresh (rotation + reuse detection)
  // -------------------------------------------------------------------------

  async refresh(rawRefreshToken: string, meta: RequestMeta): Promise<RefreshResult> {
    const hash = this.tokenService.hashOpaqueToken(rawRefreshToken);

    const existing = await this.prisma.runAsPlatformAdmin((tx) =>
      tx.refreshToken.findUnique({ where: { tokenHash: hash } }),
    );

    if (!existing) {
      throw new UnauthorizedException(GENERIC_INVALID_REFRESH);
    }

    if (existing.revokedAt) {
      // Any presentation of an already-revoked token — rotated away, logged
      // out, or otherwise — is treated as reuse and revokes the whole
      // session family. This is the standard OAuth2 refresh-rotation
      // reuse-detection pattern: a legitimate client never has a reason to
      // replay a token it already exchanged or that it used to log out.
      await this.prisma.runInTenantContext(existing.schoolId, (tx) =>
        tx.refreshToken.updateMany({
          where: { sessionId: existing.sessionId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
        }),
      );
      await this.auditService.recordInTenant(existing.schoolId, {
        actorType: existing.principalType === 'STAFF' ? 'USER' : 'PARENT',
        actorId: existing.principalId,
        action: 'REFRESH_TOKEN_REUSE_DETECTED',
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { sessionId: existing.sessionId, previousRevokedReason: existing.revokedReason },
      });
      throw new UnauthorizedException(GENERIC_INVALID_REFRESH);
    }

    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException(GENERIC_INVALID_REFRESH);
    }

    const principal = await this.loadPrincipal(existing.schoolId, existing.principalType, existing.principalId);
    if (!principal || principal.status !== 'ACTIVE' || !(await this.isSchoolOperational(existing.schoolId))) {
      await this.prisma.runInTenantContext(existing.schoolId, (tx) =>
        tx.refreshToken.update({
          where: { id: existing.id },
          data: { revokedAt: new Date(), revokedReason: 'ACCOUNT_SUSPENDED' },
        }),
      );
      throw new UnauthorizedException(GENERIC_INVALID_REFRESH);
    }

    const { raw: newRaw, hash: newHash } = this.tokenService.generateOpaqueToken();
    const newExpiresAt = this.tokenService.refreshTokenExpiresAt();

    await this.prisma.runInTenantContext(existing.schoolId, async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          schoolId: existing.schoolId,
          principalType: existing.principalType,
          principalId: existing.principalId,
          sessionId: existing.sessionId,
          tokenHash: newHash,
          expiresAt: newExpiresAt,
          userAgent: meta.userAgent,
          ipAddress: meta.ip,
        },
      });
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED', replacedByTokenId: created.id },
      });
    });

    const { token: accessToken, expiresAt: accessTokenExpiresAt } = this.tokenService.signAccessToken({
      type: existing.principalType,
      id: existing.principalId,
      schoolId: existing.schoolId,
    });

    await this.auditService.recordInTenant(existing.schoolId, {
      actorType: existing.principalType === 'STAFF' ? 'USER' : 'PARENT',
      actorId: existing.principalId,
      action: 'REFRESH_TOKEN_ROTATED',
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { sessionId: existing.sessionId },
    });

    const meResponse = await this.buildMeResponse(existing.schoolId, existing.principalType, existing.principalId);

    return {
      accessToken,
      accessTokenExpiresAt,
      refreshTokenRaw: newRaw,
      refreshTokenExpiresAt: newExpiresAt,
      principal: meResponse,
    };
  }

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------

  async logout(rawRefreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (!rawRefreshToken) return; // idempotent — nothing to revoke, not an error

    const hash = this.tokenService.hashOpaqueToken(rawRefreshToken);
    const existing = await this.prisma.runAsPlatformAdmin((tx) => tx.refreshToken.findUnique({ where: { tokenHash: hash } }));
    if (!existing || existing.revokedAt) return;

    await this.prisma.runInTenantContext(existing.schoolId, (tx) =>
      tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      }),
    );

    await this.auditService.recordInTenant(existing.schoolId, {
      actorType: existing.principalType === 'STAFF' ? 'USER' : 'PARENT',
      actorId: existing.principalId,
      action: 'LOGOUT',
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { sessionId: existing.sessionId },
    });
  }

  async logoutAll(principal: AuthenticatedPrincipal, meta: RequestMeta): Promise<void> {
    await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.refreshToken.updateMany({
        where: { principalType: principal.type, principalId: principal.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' },
      }),
    );

    await this.auditService.recordInTenant(principal.schoolId, {
      actorType: principal.type === 'STAFF' ? 'USER' : 'PARENT',
      actorId: principal.id,
      action: 'LOGOUT_ALL',
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
  }

  // -------------------------------------------------------------------------
  // Password change / reset
  // -------------------------------------------------------------------------

  async changePassword(
    principal: AuthenticatedPrincipal,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    const record = await this.loadPrincipal(principal.schoolId, principal.type, principal.id);
    if (!record || !record.passwordHash || !(await this.passwordService.verify(record.passwordHash, currentPassword))) {
      throw new BadRequestException('Current password is incorrect.');
    }

    const newHash = await this.passwordService.hash(newPassword);

    await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      if (principal.type === 'STAFF') {
        await tx.user.update({ where: { id: principal.id }, data: { passwordHash: newHash } });
      } else {
        await tx.parent.update({ where: { id: principal.id }, data: { passwordHash: newHash } });
      }
      // Changing your password invalidates every existing session (including
      // the one used to make this request) — a simple, conservative default
      // that avoids having to track "this request's own session" separately.
      // The frontend redirects to login with a "please sign in again" message.
      await tx.refreshToken.updateMany({
        where: { principalType: principal.type, principalId: principal.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
      });
    });

    await this.auditService.recordInTenant(principal.schoolId, {
      actorType: principal.type === 'STAFF' ? 'USER' : 'PARENT',
      actorId: principal.id,
      action: 'PASSWORD_CHANGED',
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
  }

  /** Always returns the same generic message — see docs/security.md#6-password-security. */
  async requestPasswordReset(
    audience: AuthPrincipalType,
    identifier: string,
    meta: RequestMeta,
  ): Promise<{ message: string }> {
    const normalized = identifier.trim().toLowerCase();

    const matches =
      audience === 'STAFF'
        ? await this.prisma.runAsPlatformAdmin((tx) => tx.user.findMany({ where: { email: normalized, deletedAt: null } }))
        : await this.prisma.runAsPlatformAdmin((tx) =>
            tx.parent.findMany({ where: { phone: identifier.trim(), deletedAt: null } }),
          );

    if (matches.length === 1 && matches[0]!.status === 'ACTIVE') {
      const principal = matches[0]!;
      const { raw, hash } = this.tokenService.generateOpaqueToken();
      const expiresAt = this.tokenService.passwordResetTokenExpiresAt();

      await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
        tx.passwordResetToken.create({
          data: {
            schoolId: principal.schoolId,
            principalType: audience,
            principalId: principal.id,
            tokenHash: hash,
            expiresAt,
            requestedIp: meta.ip,
          },
        }),
      );

      await this.notificationAdapter.sendPasswordResetLink({
        to: audience === 'STAFF' ? { email: (principal as { email: string }).email } : { phone: (principal as { phone: string }).phone },
        principalType: audience,
        resetToken: raw,
      });

      await this.auditService.recordInTenant(principal.schoolId, {
        actorType: audience === 'STAFF' ? 'USER' : 'PARENT',
        actorId: principal.id,
        action: 'PASSWORD_RESET_REQUESTED',
        requestId: meta.requestId,
        ipAddress: meta.ip,
      });
    } else {
      await this.auditService.recordWithoutTenant({
        action: 'PASSWORD_RESET_REQUESTED',
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { audience, matchCount: matches.length, note: 'no reset issued — no unique active match' },
      });
    }

    // Deliberately identical regardless of the branch taken above — see
    // docs/security.md#6-password-security (no account enumeration).
    return { message: GENERIC_RESET_RESPONSE };
  }

  async confirmPasswordReset(rawToken: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const hash = this.tokenService.hashOpaqueToken(rawToken);
    const record = await this.prisma.runAsPlatformAdmin((tx) => tx.passwordResetToken.findUnique({ where: { tokenHash: hash } }));

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset link.');
    }

    const newHash = await this.passwordService.hash(newPassword);

    await this.prisma.runInTenantContext(record.schoolId, async (tx) => {
      if (record.principalType === 'STAFF') {
        await tx.user.update({ where: { id: record.principalId }, data: { passwordHash: newHash } });
      } else {
        await tx.parent.update({ where: { id: record.principalId }, data: { passwordHash: newHash } });
      }
      await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      await tx.refreshToken.updateMany({
        where: { principalType: record.principalType, principalId: record.principalId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
      });
    });

    await this.auditService.recordInTenant(record.schoolId, {
      actorType: record.principalType === 'STAFF' ? 'USER' : 'PARENT',
      actorId: record.principalId,
      action: 'PASSWORD_RESET_COMPLETED',
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
  }

  // -------------------------------------------------------------------------
  // /auth/me
  // -------------------------------------------------------------------------

  async buildMeResponse(schoolId: string, type: AuthPrincipalType, id: string): Promise<MeResponse> {
    if (type === 'STAFF') {
      const { roles, permissions } = await this.rbacService.getRolesAndPermissions(schoolId, id);
      return this.buildStaffMeResponse(schoolId, id, roles, permissions);
    }
    return this.buildParentMeResponse(schoolId, id);
  }

  private async buildStaffMeResponse(
    schoolId: string,
    userId: string,
    roles: string[],
    permissions: string[],
  ): Promise<MeResponse> {
    const user = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId }, include: { school: true } }),
    );
    return {
      type: 'STAFF',
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      school: { id: user.school.id, name: user.school.name },
      roles,
      permissions,
    };
  }

  private async buildParentMeResponse(schoolId: string, parentId: string): Promise<MeResponse> {
    const parent = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.parent.findUniqueOrThrow({ where: { id: parentId }, include: { school: true } }),
    );
    const linkedChildIds = await this.parentAccessService.getVerifiedChildIds(schoolId, parentId);
    return {
      type: 'PARENT',
      id: parent.id,
      phone: parent.phone,
      email: parent.email,
      fullName: parent.fullName,
      school: { id: parent.school.id, name: parent.school.name },
      linkedChildrenCount: linkedChildIds.length,
    };
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  /** Used by JwtAuthGuard to re-verify the principal on every request. */
  async loadAuthenticatedPrincipal(
    schoolId: string,
    type: AuthPrincipalType,
    id: string,
  ): Promise<AuthenticatedPrincipal | null> {
    const record = await this.loadPrincipal(schoolId, type, id);
    if (!record || record.status !== 'ACTIVE') return null;
    return {
      type,
      id: record.id,
      schoolId,
      fullName: record.fullName,
      email: record.email ?? null,
      phone: record.phone ?? null,
    };
  }

  private async loadPrincipal(schoolId: string, type: AuthPrincipalType, id: string) {
    if (type === 'STAFF') {
      return this.prisma.runInTenantContext(schoolId, (tx) => tx.user.findUnique({ where: { id } }));
    }
    return this.prisma.runInTenantContext(schoolId, (tx) => tx.parent.findUnique({ where: { id } }));
  }

  /**
   * ACTIVE and TRIAL are both operationally normal; SUSPENDED/INACTIVE block
   * every user and parent of that school from logging in or refreshing,
   * regardless of their own account status — see
   * docs/security.md#3-school-status.
   */
  private async isSchoolOperational(schoolId: string): Promise<boolean> {
    const school = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { status: true } }),
    );
    return school?.status === 'ACTIVE' || school?.status === 'TRIAL';
  }
}
