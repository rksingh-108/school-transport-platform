import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createTripStudentSchema,
  updateTripStudentSchema,
  type CreateTripStudentInput,
  type UpdateTripStudentInput,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { TripStudentsService } from './trip-students.service';

/**
 * Two route shapes — `/trips/:id/students` (nested, trip-scoped list/add)
 * and `/trips/:id/students/:tripStudentId` (addressed by the manifest
 * entry's own id) — same pattern as BusDevicesController/RouteStopsController.
 * Reuses `trips.read`/`trips.manage` rather than a separate permission — a
 * manifest entry has no lifecycle independent of its trip.
 */
@RequireAudience('STAFF')
@Controller()
export class TripStudentsController {
  constructor(private readonly tripStudentsService: TripStudentsService) {}

  @RequirePermission('trips.read')
  @Get('trips/:tripId/students')
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('tripId') tripId: string) {
    return this.tripStudentsService.list(principal, tripId);
  }

  @RequirePermission('trips.manage')
  @Post('trips/:tripId/students')
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('tripId') tripId: string,
    @Body(new ZodValidationPipe(createTripStudentSchema)) body: CreateTripStudentInput,
    @Req() req: Request,
  ) {
    return this.tripStudentsService.create(principal, tripId, body, this.metaFrom(req));
  }

  @RequirePermission('trips.manage')
  @Patch('trips/:tripId/students/:tripStudentId')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('tripStudentId') tripStudentId: string,
    @Body(new ZodValidationPipe(updateTripStudentSchema)) body: UpdateTripStudentInput,
    @Req() req: Request,
  ) {
    return this.tripStudentsService.update(principal, tripStudentId, body, this.metaFrom(req));
  }

  @RequirePermission('trips.manage')
  @Delete('trips/:tripId/students/:tripStudentId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('tripStudentId') tripStudentId: string,
    @Req() req: Request,
  ) {
    await this.tripStudentsService.remove(principal, tripStudentId, this.metaFrom(req));
    return { success: true };
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
