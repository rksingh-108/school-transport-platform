import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createGeofenceSchema,
  updateGeofenceSchema,
  listGeofencesQuerySchema,
  type CreateGeofenceInput,
  type UpdateGeofenceInput,
  type ListGeofencesQuery,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { GeofencesService } from './geofences.service';

/** Staff-only, gated by `geofences.read`/`geofences.manage` — never exposed to parents in any form. See docs/adr/0020-geofencing-and-operational-safety-rules.md. */
@RequireAudience('STAFF')
@Controller('geofences')
export class GeofencesController {
  constructor(private readonly geofencesService: GeofencesService) {}

  @RequirePermission('geofences.read')
  @Get()
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Query(new ZodValidationPipe(listGeofencesQuerySchema)) query: ListGeofencesQuery) {
    return this.geofencesService.list(principal, query);
  }

  @RequirePermission('geofences.read')
  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.geofencesService.get(principal, id);
  }

  @RequirePermission('geofences.manage')
  @Post()
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createGeofenceSchema)) body: CreateGeofenceInput,
    @Req() req: Request,
  ) {
    return this.geofencesService.create(principal, body, this.metaFrom(req));
  }

  @RequirePermission('geofences.manage')
  @Patch(':id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateGeofenceSchema)) body: UpdateGeofenceInput,
    @Req() req: Request,
  ) {
    return this.geofencesService.update(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('geofences.manage')
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.geofencesService.archive(principal, id, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
