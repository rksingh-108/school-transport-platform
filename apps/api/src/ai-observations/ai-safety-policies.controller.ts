import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createAiSafetyPolicySchema,
  listAiSafetyPoliciesQuerySchema,
  updateAiSafetyPolicySchema,
  type CreateAiSafetyPolicyInput,
  type ListAiSafetyPoliciesQuery,
  type UpdateAiSafetyPolicyInput,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { AiSafetyPoliciesService } from './ai-safety-policies.service';

/**
 * Per-school AI promotion policy configuration (Phase 3 Step 15) — gated by
 * `ai_safety_policies.read`/`.manage`, mirroring the geofences/safety_rules
 * permission split exactly (configuring what's promotable is a distinct,
 * narrower-audience capability from reviewing/promoting individual
 * observations, which uses `ai_events.review`). See
 * docs/adr/0022-ai-observation-review-and-safety-analytics.md.
 */
@RequireAudience('STAFF')
@Controller('ai-safety-policies')
export class AiSafetyPoliciesController {
  constructor(private readonly policiesService: AiSafetyPoliciesService) {}

  @RequirePermission('ai_safety_policies.read')
  @Get()
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Query(new ZodValidationPipe(listAiSafetyPoliciesQuerySchema)) query: ListAiSafetyPoliciesQuery) {
    return this.policiesService.list(principal, query);
  }

  @RequirePermission('ai_safety_policies.read')
  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.policiesService.get(principal, id);
  }

  @RequirePermission('ai_safety_policies.manage')
  @Post()
  async create(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Body(new ZodValidationPipe(createAiSafetyPolicySchema)) body: CreateAiSafetyPolicyInput, @Req() req: Request) {
    return this.policiesService.create(principal, body, this.metaFrom(req));
  }

  @RequirePermission('ai_safety_policies.manage')
  @Patch(':id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAiSafetyPolicySchema)) body: UpdateAiSafetyPolicyInput,
    @Req() req: Request,
  ) {
    return this.policiesService.update(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('ai_safety_policies.manage')
  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  async enable(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.policiesService.enable(principal, id, this.metaFrom(req));
  }

  @RequirePermission('ai_safety_policies.manage')
  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  async disable(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.policiesService.disable(principal, id, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
