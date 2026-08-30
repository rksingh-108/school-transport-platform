import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createTripSchema,
  updateTripSchema,
  listTripsQuerySchema,
  cancelTripSchema,
  noShowTripSchema,
  type CreateTripInput,
  type UpdateTripInput,
  type ListTripsQuery,
  type CancelTripInput,
  type NoShowTripInput,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { TripsService } from './trips.service';

/**
 * `/start` and `/complete` are gated by the weaker `trips.read` (which
 * DRIVER also holds) rather than `trips.manage` — the real authorization
 * ("trips.manage OR the trip's own assigned driver") is enforced inside
 * TripsService, not the route guard, the same way UsersService enforces
 * "you cannot suspend your own account" beyond what the permission guard
 * alone can express. See docs/security.md.
 */
@RequireAudience('STAFF')
@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @RequirePermission('trips.read')
  @Get()
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(listTripsQuerySchema)) query: ListTripsQuery,
  ) {
    return this.tripsService.list(principal, query);
  }

  @RequirePermission('trips.read')
  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.tripsService.get(principal, id);
  }

  @RequirePermission('trips.read')
  @Get(':id/stops')
  async listStops(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.tripsService.listStops(principal, id);
  }

  @RequirePermission('trips.manage')
  @Post()
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createTripSchema)) body: CreateTripInput,
    @Req() req: Request,
  ) {
    return this.tripsService.create(principal, body, this.metaFrom(req));
  }

  @RequirePermission('trips.manage')
  @Patch(':id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTripSchema)) body: UpdateTripInput,
    @Req() req: Request,
  ) {
    return this.tripsService.update(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('trips.manage')
  @Post(':id/ready')
  @HttpCode(HttpStatus.OK)
  async ready(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.tripsService.ready(principal, id, this.metaFrom(req));
  }

  @RequirePermission('trips.read')
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  async start(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.tripsService.start(principal, id, this.metaFrom(req));
  }

  @RequirePermission('trips.read')
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  async complete(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.tripsService.complete(principal, id, this.metaFrom(req));
  }

  @RequirePermission('trips.manage')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelTripSchema)) body: CancelTripInput,
    @Req() req: Request,
  ) {
    return this.tripsService.cancel(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('trips.manage')
  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  async noShow(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(noShowTripSchema)) body: NoShowTripInput,
    @Req() req: Request,
  ) {
    return this.tripsService.noShow(principal, id, body, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
