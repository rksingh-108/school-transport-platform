import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  inviteStaffSchema,
  updateStaffSchema,
  assignStaffRolesSchema,
  listStaffQuerySchema,
  type InviteStaffInput,
  type UpdateStaffInput,
  type AssignStaffRolesInput,
  type ListStaffQuery,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { UsersService } from './users.service';

@RequireAudience('STAFF')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @RequirePermission('users.read')
  @Get()
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(listStaffQuerySchema)) query: ListStaffQuery,
  ) {
    return this.usersService.list(principal, query);
  }

  @RequirePermission('users.read')
  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.usersService.get(principal, id);
  }

  @RequirePermission('users.create')
  @Post('invite')
  @HttpCode(HttpStatus.CREATED)
  async invite(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(inviteStaffSchema)) body: InviteStaffInput,
    @Req() req: Request,
  ) {
    return this.usersService.invite(principal, body, this.metaFrom(req));
  }

  @RequirePermission('users.create')
  @Post(':id/resend-invitation')
  @HttpCode(HttpStatus.OK)
  async resendInvitation(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    await this.usersService.resendInvitation(principal, id, this.metaFrom(req));
    return { success: true };
  }

  @RequirePermission('users.update')
  @Patch(':id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStaffSchema)) body: UpdateStaffInput,
    @Req() req: Request,
  ) {
    return this.usersService.update(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('users.manage_roles')
  @Post(':id/roles')
  @HttpCode(HttpStatus.OK)
  async assignRoles(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignStaffRolesSchema)) body: AssignStaffRolesInput,
    @Req() req: Request,
  ) {
    return this.usersService.assignRoles(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('users.update')
  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspend(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.usersService.suspend(principal, id, this.metaFrom(req));
  }

  @RequirePermission('users.update')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  async activate(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.usersService.activate(principal, id, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
