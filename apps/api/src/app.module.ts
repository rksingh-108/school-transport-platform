import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './common/audit/audit.module';
import { DomainEventsModule } from './common/events/domain-events.module';
import { InvitationsModule } from './invitations/invitations.module';
import { SchoolsModule } from './schools/schools.module';
import { UsersModule } from './users/users.module';
import { StudentsModule } from './students/students.module';
import { ParentsModule } from './parents/parents.module';
import { BusesModule } from './buses/buses.module';
import { DriversModule } from './drivers/drivers.module';
import { AttendantsModule } from './attendants/attendants.module';
import { BusDevicesModule } from './bus-devices/bus-devices.module';
import { RoutesModule } from './routes/routes.module';
import { RouteStopsModule } from './route-stops/route-stops.module';
import { TripsModule } from './trips/trips.module';
import { GpsModule } from './gps/gps.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CamerasModule } from './cameras/cameras.module';
import { SafetyModule } from './safety/safety.module';
import { AiObservationsModule } from './ai-observations/ai-observations.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

@Module({
  imports: [
    AppConfigModule,
    // Conservative global default; the auth module's login/refresh/reset
    // endpoints apply a much stricter per-route @Throttle() override on top
    // of this — see docs/security.md#1-authentication and
    // apps/api/src/auth/auth.controller.ts.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    DatabaseModule,
    RedisModule,
    StorageModule,
    AuditModule,
    DomainEventsModule,
    HealthModule,
    AuthModule,
    InvitationsModule,
    SchoolsModule,
    UsersModule,
    StudentsModule,
    ParentsModule,
    BusesModule,
    DriversModule,
    AttendantsModule,
    BusDevicesModule,
    RoutesModule,
    RouteStopsModule,
    TripsModule,
    GpsModule,
    NotificationsModule,
    CamerasModule,
    SafetyModule,
    AiObservationsModule,
    AnalyticsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
