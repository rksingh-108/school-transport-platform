import { Controller, Get, Query } from '@nestjs/common';
import { safetyAnalyticsQuerySchema, type SafetyAnalyticsQuery } from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { SafetyAnalyticsService } from './safety-analytics.service';

/**
 * Staff-only, aggregated-only operational safety analytics (Phase 3 Step
 * 15). Gated by `safety_analytics.read`. Never returns raw AIObservation/
 * SafetyEvent rows — see
 * docs/adr/0022-ai-observation-review-and-safety-analytics.md. There is no
 * parent-facing analytics endpoint anywhere in this codebase, by design.
 */
@RequireAudience('STAFF')
@Controller('analytics')
export class SafetyAnalyticsController {
  constructor(private readonly analyticsService: SafetyAnalyticsService) {}

  @RequirePermission('safety_analytics.read')
  @Get('safety')
  async getSafetyAnalytics(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Query(new ZodValidationPipe(safetyAnalyticsQuerySchema)) query: SafetyAnalyticsQuery) {
    return this.analyticsService.getSummary(principal, query);
  }
}
