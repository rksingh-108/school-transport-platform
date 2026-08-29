import { Injectable, NotFoundException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_VERIFIED_CHILD_KEY } from '../decorators/require-verified-child.decorator';
import { ParentAccessService } from '../services/parent-access.service';

/**
 * Runs after JwtAuthGuard. Enforces `@RequireVerifiedChild('studentId')` —
 * see the decorator's docstring. Returns 404, never 403, on failure: the
 * response must not reveal whether the studentId exists at all, only that
 * this parent can't see it — indistinguishable from "no such student"
 * (docs/security.md#3-tenant-isolation's cross-tenant 404 convention applied
 * to the parent-child boundary).
 */
@Injectable()
export class ParentChildAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly parentAccessService: ParentAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const studentIdParam = this.reflector.getAllAndOverride<string>(REQUIRE_VERIFIED_CHILD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!studentIdParam) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const principal = request.principal;
    const rawParam = request.params[studentIdParam];
    const studentId = Array.isArray(rawParam) ? rawParam[0] : rawParam;

    if (!principal || principal.type !== 'PARENT' || !studentId) {
      throw new NotFoundException();
    }

    const isVerified = await this.parentAccessService.isVerifiedChild(principal.schoolId, principal.id, studentId);
    if (!isVerified) {
      throw new NotFoundException();
    }
    return true;
  }
}
