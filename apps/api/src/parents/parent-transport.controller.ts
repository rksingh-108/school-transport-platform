import { Controller, Get, Param } from '@nestjs/common';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequireVerifiedChild } from '../auth/decorators/require-verified-child.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { ParentTransportService } from './parent-transport.service';

/**
 * The one detail endpoint for a child's transport state (Phase 1 Step 8) —
 * deliberately just this single route rather than separate
 * `/transport`/`/active-trip` endpoints, since a trip's status, the child's
 * attendance, and the bus location are never independently useful without
 * each other. `@RequireVerifiedChild('studentId')` (ParentChildAccessGuard,
 * already global) returns 404 — not the studentId, not a bus/trip/device id
 * — for anything the caller doesn't have a verified link to, before this
 * controller ever runs.
 */
@RequireAudience('PARENT')
@Controller('parent/children')
export class ParentTransportController {
  constructor(private readonly parentTransportService: ParentTransportService) {}

  @RequireVerifiedChild('studentId')
  @Get(':studentId/transport')
  async getTransport(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('studentId') studentId: string) {
    return this.parentTransportService.getTransport(principal.schoolId, studentId);
  }
}
