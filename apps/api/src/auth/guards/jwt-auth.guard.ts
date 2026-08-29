import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { TokenService } from '../services/token.service';
import { AuthService } from '../services/auth.service';

/**
 * Accepts a valid access token of EITHER audience (staff or parent) and
 * populates `request.principal` — the single shared entry point for both
 * audiences on routes that don't care which one is calling (docs/api.md's
 * `/auth/me`, `/auth/logout`, etc.). Routes that must be audience-specific
 * additionally apply AudienceGuard.
 *
 * `request.principal` is built from a REAL, fresh database read on every
 * request (via AuthService.loadAuthenticatedPrincipal), not just decoded JWT
 * claims — this is what makes a suspended/disabled account stop working
 * within one access-token lifetime rather than only at its next login or
 * refresh. See docs/security.md#7-account-states.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing access token.');
    }

    const claims = this.tokenService.verifyAccessToken(authHeader.slice('Bearer '.length));
    const principal = await this.authService.loadAuthenticatedPrincipal(claims.schoolId, claims.type, claims.sub);
    if (!principal) {
      throw new UnauthorizedException('Account is no longer active.');
    }

    request.principal = principal;
    return true;
  }
}
