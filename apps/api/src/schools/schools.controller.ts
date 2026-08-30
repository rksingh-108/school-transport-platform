import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  updateSchoolSchema,
  updateSchoolStatusSchema,
  type UpdateSchoolInput,
  type UpdateSchoolStatusInput,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { SchoolsService } from './schools.service';

@RequireAudience('STAFF')
@Controller('schools')
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  @RequirePermission('schools.read')
  @Get(':id')
  async getOne(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.schoolsService.getSchool(principal, id);
  }

  @RequirePermission('schools.update')
  @Patch(':id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchoolSchema)) body: UpdateSchoolInput,
    @Req() req: Request,
  ) {
    return this.schoolsService.updateSchool(principal, id, body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.id,
    });
  }

  @RequirePermission('platform.schools.manage')
  @Patch(':id/status')
  async updateStatus(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchoolStatusSchema)) body: UpdateSchoolStatusInput,
    @Req() req: Request,
  ) {
    return this.schoolsService.updateStatus(principal, id, body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.id,
    });
  }
}
