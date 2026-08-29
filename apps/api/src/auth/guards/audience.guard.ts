import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthPrincipalType } from '@prisma/client';
import { REQUIRE_AUDIENCE_KEY } from '../decorators/require-audience.decorator';

/**
 * Runs after JwtAuthGuard. Enforces `@RequireAudience('STAFF'|'PARENT')` —
 * a staff token on a `@RequireAudience('PARENT')` route (or vice versa) is
 * rejected here, structurally, not by a role-name string comparison
 * scattered in a controller. See docs/adr/0004-auth-strategy.md.
 */
@Injectable()
export class AudienceGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AuthPrincipalType>(REQUIRE_AUDIENCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (request.principal?.type !== required) {
      throw new ForbiddenException('This endpoint is not available for your account type.');
    }
    return true;
  }
}
