import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PermissionKey } from '@school-transport/shared-types';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { RbacService } from '../services/rbac.service';

/**
 * Runs after JwtAuthGuard (+ AudienceGuard if present). Enforces
 * `@RequirePermission('students.read')` by resolving the staff principal's
 * permissions fresh from the database — see docs/security.md#22. Parents
 * never carry RBAC permissions (their access is relationship-based, not
 * permission-based — docs/security.md#4), so any principal that isn't STAFF
 * is rejected here regardless of the specific permission requested.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const principal = request.principal;
    if (!principal || principal.type !== 'STAFF') {
      throw new ForbiddenException('Insufficient permissions.');
    }

    const granted = await this.rbacService.hasPermission(principal.schoolId, principal.id, required);
    if (!granted) {
      throw new ForbiddenException('Insufficient permissions.');
    }
    return true;
  }
}
