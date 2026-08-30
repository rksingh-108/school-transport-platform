import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createParentSchema,
  updateParentSchema,
  linkStudentSchema,
  listParentsQuerySchema,
  type CreateParentInput,
  type UpdateParentInput,
  type LinkStudentInput,
  type ListParentsQuery,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { ParentsService } from './parents.service';

/** Staff-facing parent administration. See parent-self.controller.ts for the parent's own view. */
@RequireAudience('STAFF')
@Controller('parents')
export class ParentsController {
  constructor(private readonly parentsService: ParentsService) {}

  @RequirePermission('parents.read')
  @Get()
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(listParentsQuerySchema)) query: ListParentsQuery,
  ) {
    return this.parentsService.list(principal, query);
  }

  @RequirePermission('parents.read')
  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.parentsService.get(principal, id);
  }

  @RequirePermission('parents.create')
  @Post()
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createParentSchema)) body: CreateParentInput,
    @Req() req: Request,
  ) {
    return this.parentsService.create(principal, body, this.metaFrom(req));
  }

  @RequirePermission('parents.update')
  @Patch(':id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateParentSchema)) body: UpdateParentInput,
    @Req() req: Request,
  ) {
    return this.parentsService.update(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('parents.read')
  @Get(':id/children')
  async listLinks(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.parentsService.listLinks(principal, id);
  }

  @RequirePermission('parents.manage_relationships')
  @Post(':id/children')
  async linkStudent(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(linkStudentSchema)) body: LinkStudentInput,
    @Req() req: Request,
  ) {
    return this.parentsService.linkStudent(principal, id, body, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
