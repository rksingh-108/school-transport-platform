import { Controller, Get, Param } from '@nestjs/common';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequireVerifiedChild } from '../auth/decorators/require-verified-child.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { ParentSelfService } from './parent-self.service';

/**
 * Parent's own view — no `@RequirePermission(...)` here at all, by design:
 * parent access is relationship-based, not RBAC-permission-based
 * (docs/security.md#4-parent-data-access-boundary and
 * docs/security.md#9-parent-authorization). `@RequireAudience('PARENT')`
 * alone is the gate; every query inside is further scoped to the
 * authenticated parent's own verified links, never a client-supplied id.
 */
@RequireAudience('PARENT')
@Controller('parent')
export class ParentSelfController {
  constructor(private readonly parentSelfService: ParentSelfService) {}

  @Get('children')
  async getMyChildren(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.parentSelfService.getMyChildren(principal);
  }

  @RequireVerifiedChild('studentId')
  @Get('children/:studentId')
  async getMyChild(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('studentId') studentId: string) {
    return this.parentSelfService.getMyChild(principal, studentId);
  }
}
