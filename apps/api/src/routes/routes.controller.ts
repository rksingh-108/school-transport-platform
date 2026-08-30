import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createRouteSchema,
  updateRouteSchema,
  listRoutesQuerySchema,
  type CreateRouteInput,
  type UpdateRouteInput,
  type ListRoutesQuery,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { RoutesService } from './routes.service';

@RequireAudience('STAFF')
@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @RequirePermission('routes.read')
  @Get()
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(listRoutesQuerySchema)) query: ListRoutesQuery,
  ) {
    return this.routesService.list(principal, query);
  }

  @RequirePermission('routes.read')
  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.routesService.get(principal, id);
  }

  @RequirePermission('routes.manage')
  @Post()
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createRouteSchema)) body: CreateRouteInput,
    @Req() req: Request,
  ) {
    return this.routesService.create(principal, body, this.metaFrom(req));
  }

  @RequirePermission('routes.manage')
  @Patch(':id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRouteSchema)) body: UpdateRouteInput,
    @Req() req: Request,
  ) {
    return this.routesService.update(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('routes.manage')
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.routesService.archive(principal, id, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
