import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage-provider.interface';
import { Public } from '../common/decorators/public.decorator';

// NOTE: HealthCheckService, HealthIndicatorService, PrismaService, and
// RedisService below are deliberately VALUE imports, not `import type` —
// they're constructor-injected dependencies, and Nest's DI resolves them via
// emitDecoratorMetadata's design:paramtypes, which is stripped along with an
// `import type`. `consistent-type-imports` is disabled for this app's ESLint
// config for exactly this reason — see apps/api/eslint.config.js.

/**
 * Liveness/readiness probes. Deliberately excluded from the `/api` prefix and
 * `v1` versioning (see main.ts) — orchestrators and uptime checks probe a
 * fixed, stable path regardless of API version. See
 * docs/api.md#system and docs/architecture.md#3-cross-cutting-concerns.
 */
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /** Liveness: is the process up and able to respond at all. No I/O. */
  @Get()
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness: are this instance's actual dependencies reachable. */
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      async () => {
        const indicator = this.indicators.check('database');
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return indicator.up();
        } catch (error) {
          return indicator.down({ message: (error as Error).message });
        }
      },
      async () => {
        const indicator = this.indicators.check('redis');
        try {
          const ok = await this.redis.ping();
          return ok ? indicator.up() : indicator.down();
        } catch (error) {
          return indicator.down({ message: (error as Error).message });
        }
      },
      async () => {
        const indicator = this.indicators.check('storage');
        const ok = await this.storage.isReachable();
        return ok ? indicator.up() : indicator.down();
      },
    ]);
  }
}
