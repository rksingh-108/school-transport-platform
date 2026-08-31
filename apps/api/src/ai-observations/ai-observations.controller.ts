import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  dismissAiObservationSchema,
  listAiObservationsQuerySchema,
  promoteAiObservationSchema,
  reviewAiObservationSchema,
  type DismissAiObservationInput,
  type ListAiObservationsQuery,
  type PromoteAiObservationInput,
  type ReviewAiObservationInput,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { AiObservationsService } from './ai-observations.service';

/**
 * Staff-only read + human-review access to AI observations (Phase 3 Steps
 * 14-15). Reads are gated by `ai_events.read` — the pre-existing permission
 * reserved since Phase 0 for exactly this concept. The three review
 * transitions are gated by `ai_events.review` — dedicated state-transition
 * endpoints, never a generic PATCH; the original AI detection is immutable
 * through every one of them. See
 * docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md and
 * docs/adr/0022-ai-observation-review-and-safety-analytics.md. Parents have
 * no access to any route on this controller — there is no parent-audience
 * AI endpoint anywhere in this codebase, by design.
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

  @RequirePermission('ai_events.review')
  @Post('ai-observations/:id/review')
  @HttpCode(HttpStatus.OK)
  async review(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewAiObservationSchema)) body: ReviewAiObservationInput,
    @Req() req: Request,
  ) {
    return this.aiObservationsService.review(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('ai_events.review')
  @Post('ai-observations/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  async dismiss(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(dismissAiObservationSchema)) body: DismissAiObservationInput,
    @Req() req: Request,
  ) {
    return this.aiObservationsService.dismiss(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('ai_events.review')
  @Post('ai-observations/:id/promote')
  @HttpCode(HttpStatus.OK)
  async promote(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(promoteAiObservationSchema)) body: PromoteAiObservationInput,
    @Req() req: Request,
  ) {
    return this.aiObservationsService.promote(principal, id, body, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
