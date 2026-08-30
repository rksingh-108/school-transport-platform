import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createDriverSchema,
  updateDriverSchema,
  listDriversQuerySchema,
  type CreateDriverInput,
  type UpdateDriverInput,
  type ListDriversQuery,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { DriversService } from './drivers.service';

@RequireAudience('STAFF')
@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @RequirePermission('drivers.read')
  @Get()
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(listDriversQuerySchema)) query: ListDriversQuery,
  ) {
    return this.driversService.list(principal, query);
  }

  @RequirePermission('drivers.read')
  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.driversService.get(principal, id);
  }

  @RequirePermission('drivers.manage')
  @Post()
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createDriverSchema)) body: CreateDriverInput,
    @Req() req: Request,
  ) {
    return this.driversService.create(principal, body, this.metaFrom(req));
  }

  @RequirePermission('drivers.manage')
  @Patch(':id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDriverSchema)) body: UpdateDriverInput,
    @Req() req: Request,
  ) {
    return this.driversService.update(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('drivers.manage')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  async activate(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.driversService.activate(principal, id, this.metaFrom(req));
  }

  @RequirePermission('drivers.manage')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.driversService.deactivate(principal, id, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
