import { Controller, Delete, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { ParentsService } from './parents.service';

/** Actions on a specific parent_students relationship record, addressed by its own id — matches docs/api.md's `/parent-students/:id/verify`. */
@RequireAudience('STAFF')
@Controller('parent-students')
export class ParentStudentLinksController {
  constructor(private readonly parentsService: ParentsService) {}

  @RequirePermission('parents.manage_relationships')
  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  async verify(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.parentsService.verifyLink(principal, id, this.metaFrom(req));
  }

  @RequirePermission('parents.manage_relationships')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async unlink(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    await this.parentsService.unlink(principal, id, this.metaFrom(req));
    return { success: true };
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
