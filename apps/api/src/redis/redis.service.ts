import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
// ConfigService is a value import on purpose — see the note in
// apps/api/src/health/health.controller.ts (constructor-injected dependency).
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.schema';

/**
 * Connection abstraction only for Phase 0 — no caching or session/business
 * usage is wired up yet (see docs/roadmap.md). Modules that need Redis later
 * (sessions, WebSocket fan-out via the Socket.IO Redis adapter, rate-limit
 * counters) inject this service rather than constructing their own client, so
 * connection lifecycle and config stay in one place. See
 * docs/adr/0005-realtime-and-telemetry-ingestion.md.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(configService: ConfigService<Env, true>) {
    this.client = new Redis(configService.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    // Without an 'error' listener ioredis re-throws connection/auth errors as
    // uncaught exceptions, which takes the whole API process down (observed in
    // production on a bad REDIS_URL). Redis is not required for the API to
    // serve HTTP traffic — /health/ready reports the degradation instead.
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  async onModuleInit() {
    try {
      await this.client.connect();
      this.logger.log('Connected to Redis.');
    } catch (error) {
      this.logger.error(`Redis connection failed: ${(error as Error).message}`);
    }
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  async ping(): Promise<boolean> {
    const reply = await this.client.ping();
    return reply === 'PONG';
  }
}
