import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createAttendantSchema,
  listAttendantsQuerySchema,
  type CreateAttendantInput,
  type ListAttendantsQuery,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { AttendantsService } from './attendants.service';

@RequireAudience('STAFF')
@Controller('attendants')
export class AttendantsController {
  constructor(private readonly attendantsService: AttendantsService) {}

  @RequirePermission('attendants.read')
  @Get()
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(listAttendantsQuerySchema)) query: ListAttendantsQuery,
  ) {
    return this.attendantsService.list(principal, query);
  }

  @RequirePermission('attendants.read')
  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.attendantsService.get(principal, id);
  }

  @RequirePermission('attendants.manage')
  @Post()
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createAttendantSchema)) body: CreateAttendantInput,
    @Req() req: Request,
  ) {
    return this.attendantsService.create(principal, body, this.metaFrom(req));
  }

  @RequirePermission('attendants.manage')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  async activate(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.attendantsService.activate(principal, id, this.metaFrom(req));
  }

  @RequirePermission('attendants.manage')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.attendantsService.deactivate(principal, id, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
