import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { listNotificationsQuerySchema, type ListNotificationsQuery } from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { NotificationsQueryService } from './notifications-query.service';

/**
 * Parent's own notification inbox (Phase 1 Step 9) — no
 * `@RequirePermission` at all, same relationship-based (not RBAC-based)
 * posture as every other parent endpoint (docs/security.md §4). The
 * recipient is always `principal.id` — there is no route parameter or body
 * field anywhere in this controller that could name a different parent, so
 * there is nothing to forge. `POST /parent/notifications` (creating one)
 * intentionally does not exist — notifications are a backend/domain
 * operation, never a client-callable one.
 */
@RequireAudience('PARENT')
@Controller('parent/notifications')
export class ParentNotificationsController {
  constructor(private readonly notificationsQueryService: NotificationsQueryService) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ) {
    return this.notificationsQueryService.list(principal.schoolId, 'PARENT', principal.id, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.notificationsQueryService.unreadCount(principal.schoolId, 'PARENT', principal.id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.notificationsQueryService.markRead(principal.schoolId, 'PARENT', principal.id, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.notificationsQueryService.markAllRead(principal.schoolId, 'PARENT', principal.id);
  }
}
