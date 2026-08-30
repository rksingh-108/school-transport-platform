import { Controller, Get, Param, Query } from '@nestjs/common';
import { listAiObservationsQuerySchema, type ListAiObservationsQuery } from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { AiObservationsService } from './ai-observations.service';

/**
 * Staff-only read access to AI observations (Phase 3 Step 14). Gated by
 * `ai_events.read` — the pre-existing permission reserved since Phase 0 for
 * exactly this concept (see architecture.md's module table and
 * docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md). No
 * create/update/delete route exists here at all: observations are written
 * only through the device-facing EdgeAiController, and no review/promote
 * endpoint exists yet — that is Step 15's job. Parents have no access to
 * any route on this controller — there is no parent-audience AI endpoint
 * anywhere in this codebase, by design.
 */
@RequireAudience('STAFF')
@Controller()
export class AiObservationsController {
  constructor(private readonly aiObservationsService: AiObservationsService) {}

  @RequirePermission('ai_events.read')
  @Get('ai-observations')
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Query(new ZodValidationPipe(listAiObservationsQuerySchema)) query: ListAiObservationsQuery) {
    return this.aiObservationsService.list(principal, query);
  }

  /**
   * Concise health status only — `AI_NOT_CONFIGURED`/`AI_READY`, never a
   * provider-internal error or anything implying real centralized inference
   * exists in this deployment. See ComputerVisionProvider. Declared before
   * `:id` below so it is never shadowed by the id-param route.
   */
  @RequirePermission('ai_events.read')
  @Get('ai-observations/provider-status')
  getProviderStatus() {
    return this.aiObservationsService.getProviderHealth();
  }

  @RequirePermission('ai_events.read')
  @Get('ai-observations/:id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.aiObservationsService.get(principal, id);
  }
}
