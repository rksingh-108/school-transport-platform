import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ParentsModule } from '../parents/parents.module';
import { ParentNotificationsController } from './parent-notifications.controller';
import { StaffNotificationsController } from './staff-notifications.controller';
import { NotificationsQueryService } from './notifications-query.service';
import { NotificationsService } from './notifications.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotConfiguredProvider } from './providers/not-configured.provider';
import { PUSH_PROVIDER, SMS_PROVIDER, EMAIL_PROVIDER } from './providers/notification-provider.interface';

@Module({
  // AuthModule: RbacService (via the global PermissionsGuard already
  // covers this, but RequirePermission needs nothing extra) — imported for
  // consistency with every other feature module. ParentsModule: exports
  // ParentGateway, used by NotificationsService to push realtime child
  // notifications through the existing `/realtime/parent` channel.
  imports: [AuthModule, ParentsModule],
  controllers: [ParentNotificationsController, StaffNotificationsController],
  providers: [
    NotificationsQueryService,
    NotificationsService,
    NotificationDeliveryService,
    // No real PUSH/SMS/EMAIL vendor is configured — see
    // docs/adr/0016-notifications-and-alerts.md. Binding a real provider
    // later means changing these three lines, not any call site.
    { provide: PUSH_PROVIDER, useClass: NotConfiguredProvider },
    { provide: SMS_PROVIDER, useClass: NotConfiguredProvider },
    { provide: EMAIL_PROVIDER, useClass: NotConfiguredProvider },
  ],
})
export class NotificationsModule {}
