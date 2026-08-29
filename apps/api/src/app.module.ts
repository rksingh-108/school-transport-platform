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
    HealthModule,
    AuthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
