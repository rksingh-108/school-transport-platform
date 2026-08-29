import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { RbacService } from './services/rbac.service';
import { ParentAccessService } from './services/parent-access.service';
import { FailedLoginTrackerService } from './services/failed-login-tracker.service';
import { AuthAuditService } from './services/auth-audit.service';
import { AUTH_NOTIFICATION_ADAPTER } from './notifications/notification-adapter.interface';
import { ConsoleNotificationAdapter } from './notifications/console-notification.adapter';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AudienceGuard } from './guards/audience.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { ParentChildAccessGuard } from './guards/parent-child-access.guard';

/**
 * All four guards are registered GLOBALLY (APP_GUARD), in this order:
 * JwtAuthGuard (populates request.principal, no-ops on @Public() routes) →
 * AudienceGuard (no-ops without @RequireAudience) → PermissionsGuard
 * (no-ops without @RequirePermission) → ParentChildAccessGuard (no-ops
 * without @RequireVerifiedChild). Making them global — rather than requiring
 * every controller to remember `@UseGuards(...)` — means a future module can
 * enforce a check with the decorator ALONE; forgetting `@UseGuards()` can no
 * longer silently disable a check. See docs/security.md#22.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PasswordService,
    RbacService,
    ParentAccessService,
    FailedLoginTrackerService,
    AuthAuditService,
    { provide: AUTH_NOTIFICATION_ADAPTER, useClass: ConsoleNotificationAdapter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AudienceGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ParentChildAccessGuard },
  ],
  exports: [AuthService, RbacService, ParentAccessService],
})
export class AuthModule {}
