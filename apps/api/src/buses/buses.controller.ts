import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createBusSchema,
  updateBusSchema,
  listBusesQuerySchema,
  type CreateBusInput,
  type UpdateBusInput,
  type ListBusesQuery,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { BusesService } from './buses.service';

@RequireAudience('STAFF')
@Controller('buses')
export class BusesController {
  constructor(private readonly busesService: BusesService) {}

  @RequirePermission('buses.read')
  @Get()
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(listBusesQuerySchema)) query: ListBusesQuery,
  ) {
    return this.busesService.list(principal, query);
  }

  @RequirePermission('buses.read')
  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.busesService.get(principal, id);
  }

  @RequirePermission('buses.manage')
  @Post()
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createBusSchema)) body: CreateBusInput,
    @Req() req: Request,
  ) {
    return this.busesService.create(principal, body, this.metaFrom(req));
  }

  @RequirePermission('buses.manage')
  @Patch(':id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBusSchema)) body: UpdateBusInput,
    @Req() req: Request,
  ) {
    return this.busesService.update(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('buses.manage')
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.busesService.archive(principal, id, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
