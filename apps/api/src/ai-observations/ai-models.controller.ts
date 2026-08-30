import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { createAiModelSchema, listAiModelsQuerySchema, type CreateAiModelInput, type ListAiModelsQuery } from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { AiModelsService } from './ai-models.service';

/**
 * The platform-wide AI model registry (Phase 3 Step 14) —
 * `platform.ai_models.read`/`.manage`, SUPER_ADMIN only. No school-level
 * staff role ever holds either permission (see packages/shared-types/src/rbac.ts)
 * — this is deliberately not a per-school resource. See
 * docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md.
 */
@RequireAudience('STAFF')
@Controller('ai-models')
export class AiModelsController {
  constructor(private readonly aiModelsService: AiModelsService) {}

  @RequirePermission('platform.ai_models.read')
  @Get()
  async list(@Query(new ZodValidationPipe(listAiModelsQuerySchema)) query: ListAiModelsQuery) {
    return this.aiModelsService.list(query);
  }

  @RequirePermission('platform.ai_models.read')
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.aiModelsService.get(id);
  }

  @RequirePermission('platform.ai_models.manage')
  @Post()
  async register(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Body(new ZodValidationPipe(createAiModelSchema)) body: CreateAiModelInput, @Req() req: Request) {
    return this.aiModelsService.register(principal, body, this.metaFrom(req));
  }

  @RequirePermission('platform.ai_models.manage')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  async activate(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.aiModelsService.activate(principal, id, this.metaFrom(req));
  }

  @RequirePermission('platform.ai_models.manage')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.aiModelsService.deactivate(principal, id, this.metaFrom(req));
  }

  @RequirePermission('platform.ai_models.manage')
  @Post(':id/deprecate')
  @HttpCode(HttpStatus.OK)
  async deprecate(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.aiModelsService.deprecate(principal, id, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
