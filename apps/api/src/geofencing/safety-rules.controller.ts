import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createSafetyRuleSchema,
  updateSafetyRuleSchema,
  listSafetyRulesQuerySchema,
  type CreateSafetyRuleInput,
  type UpdateSafetyRuleInput,
  type ListSafetyRulesQuery,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { SafetyRulesService } from './safety-rules.service';

/**
 * Staff-only, gated by `safety_rules.read`/`safety_rules.manage` — never
 * exposed to parents. `enabled` cannot be set via `PATCH`, only the
 * dedicated `/enable`/`/disable` endpoints — see
 * docs/adr/0020-geofencing-and-operational-safety-rules.md.
 */
@RequireAudience('STAFF')
@Controller('safety-rules')
export class SafetyRulesController {
  constructor(private readonly safetyRulesService: SafetyRulesService) {}

  @RequirePermission('safety_rules.read')
  @Get()
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Query(new ZodValidationPipe(listSafetyRulesQuerySchema)) query: ListSafetyRulesQuery) {
    return this.safetyRulesService.list(principal, query);
  }

  @RequirePermission('safety_rules.read')
  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.safetyRulesService.get(principal, id);
  }

  @RequirePermission('safety_rules.manage')
  @Post()
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createSafetyRuleSchema)) body: CreateSafetyRuleInput,
    @Req() req: Request,
  ) {
    return this.safetyRulesService.create(principal, body, this.metaFrom(req));
  }

  @RequirePermission('safety_rules.manage')
  @Patch(':id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSafetyRuleSchema)) body: UpdateSafetyRuleInput,
    @Req() req: Request,
  ) {
    return this.safetyRulesService.update(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('safety_rules.manage')
  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  async enable(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.safetyRulesService.enable(principal, id, this.metaFrom(req));
  }

  @RequirePermission('safety_rules.manage')
  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  async disable(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.safetyRulesService.disable(principal, id, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
