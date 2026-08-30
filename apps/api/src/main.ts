import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PinoLoggerService } from './common/logger/pino-logger.service';
import type { Env } from './config/env.schema';

async function bootstrap() {
  const logger = new PinoLoggerService();
  const app = await NestFactory.create(AppModule, { logger });

  const configService = app.get(ConfigService<Env, true>);

  // Lets Postgres/Redis connections (PrismaService/RedisService's
  // onModuleDestroy) close cleanly on SIGTERM/SIGINT — required for a
  // container orchestrator's graceful-shutdown window to actually work,
  // rather than the process being hard-killed with connections still open.
  app.enableShutdownHooks();

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: configService.get('CORS_ORIGIN', { infer: true }), credentials: true });

  // /health and /health/ready are liveness/readiness probes for orchestrators —
  // deliberately outside the versioned API surface. See docs/api.md#system.
  app.setGlobalPrefix('api', { exclude: ['health', 'health/ready'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = configService.get('API_PORT', { infer: true });
  await app.listen(port);
  logger.log(`API listening on port ${port}`, 'Bootstrap');
}

bootstrap();
