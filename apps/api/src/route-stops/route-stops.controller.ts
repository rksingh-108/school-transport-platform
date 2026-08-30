import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createStopSchema,
  updateStopSchema,
  reorderStopsSchema,
  type CreateStopInput,
  type UpdateStopInput,
  type ReorderStopsInput,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { RouteStopsService } from './route-stops.service';

/**
 * Two route shapes on one controller — `/routes/:routeId/stops` (nested,
 * route-scoped list/create/reorder) and `/stops/:id` (flat, addressed by
 * the stop's own id) — same pattern as BusDevicesController. Gated by
 * `routes.read`/`routes.manage`, not a separate `stops.*` permission: a
 * stop has no lifecycle independent of the route it belongs to.
 */
@RequireAudience('STAFF')
@Controller()
export class RouteStopsController {
  constructor(private readonly routeStopsService: RouteStopsService) {}

  @RequirePermission('routes.read')
  @Get('routes/:routeId/stops')
  async listForRoute(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('routeId') routeId: string) {
    return this.routeStopsService.listForRoute(principal, routeId);
  }

  @RequirePermission('routes.manage')
  @Post('routes/:routeId/stops')
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('routeId') routeId: string,
    @Body(new ZodValidationPipe(createStopSchema)) body: CreateStopInput,
    @Req() req: Request,
  ) {
    return this.routeStopsService.create(principal, routeId, body, this.metaFrom(req));
  }

  @RequirePermission('routes.manage')
  @Post('routes/:routeId/stops/reorder')
  @HttpCode(HttpStatus.OK)
  async reorder(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('routeId') routeId: string,
    @Body(new ZodValidationPipe(reorderStopsSchema)) body: ReorderStopsInput,
    @Req() req: Request,
  ) {
    return this.routeStopsService.reorder(principal, routeId, body, this.metaFrom(req));
  }

  @RequirePermission('routes.read')
  @Get('stops/:id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.routeStopsService.get(principal, id);
  }

  @RequirePermission('routes.manage')
  @Patch('stops/:id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStopSchema)) body: UpdateStopInput,
    @Req() req: Request,
  ) {
    return this.routeStopsService.update(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('routes.manage')
  @Delete('stops/:id')
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    await this.routeStopsService.remove(principal, id, this.metaFrom(req));
    return { success: true };
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
