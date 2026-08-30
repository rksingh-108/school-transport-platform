import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { listNotificationsQuerySchema, type ListNotificationsQuery } from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { NotificationsQueryService } from './notifications-query.service';

/**
 * Staff's own operational alert inbox (Phase 1 Step 9) — gated by the
 * existing `notifications.read` permission (SCHOOL_ADMIN since Phase 0;
 * PRINCIPAL/TRANSPORT_ADMIN/TRANSPORT_MANAGER added while reviewing
 * existing grants for this phase, see docs/security.md §5.8). The
 * recipient is always `principal.id` — a School A administrator can only
 * ever see their own alerts, never another admin's or another school's,
 * regardless of permission; there is no endpoint that lists another
 * user's notifications.
 */
@RequireAudience('STAFF')
@RequirePermission('notifications.read')
@Controller('notifications')
export class StaffNotificationsController {
  constructor(private readonly notificationsQueryService: NotificationsQueryService) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ) {
    return this.notificationsQueryService.list(principal.schoolId, 'USER', principal.id, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.notificationsQueryService.unreadCount(principal.schoolId, 'USER', principal.id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.notificationsQueryService.markRead(principal.schoolId, 'USER', principal.id, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.notificationsQueryService.markAllRead(principal.schoolId, 'USER', principal.id);
  }
}
