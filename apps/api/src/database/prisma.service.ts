import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
// ConfigService is a value import on purpose — see the note in
// apps/api/src/health/health.controller.ts (constructor-injected dependency).
import { ConfigService } from '@nestjs/config';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { Env } from '../config/env.schema';

/**
 * The API's ONLY Prisma connection. Deliberately constructed with the
 * restricted `API_DATABASE_URL` (the `app_user` role), never the privileged
 * `DATABASE_URL` the Prisma CLI uses for migrations/seed — see
 * docs/adr/0002-multi-tenancy-strategy.md and
 * docs/adr/0008-prisma-version-pin.md.
 *
 * Row-Level Security policies key off two Postgres session variables that
 * exist only within a transaction (`SET LOCAL` semantics, via `set_config`'s
 * `is_local = true`) — never as a connection-wide `SET`, because Prisma
 * multiplexes requests over a pooled set of connections and a non-local SET
 * would leak one request's tenant scope into another's connection reuse.
 * `runInTenantContext` / `runAsPlatformAdmin` are therefore the only
 * sanctioned way for a repository to run a tenant-scoped query — see
 * docs/security.md#3-tenant-isolation.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService<Env, true>) {
    super({
      datasources: { db: { url: configService.get('API_DATABASE_URL', { infer: true }) } },
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to database (restricted app_user connection).');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Runs `fn` inside a transaction scoped to `schoolId` for RLS purposes. */
  async runInTenantContext<T>(
    schoolId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Runs `fn` with the platform-admin RLS escape hatch enabled — only for
   * genuine SUPER_ADMIN platform operations (see docs/security.md), and
   * always paired with an audit log entry at the call site.
   */
  async runAsPlatformAdmin<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
      return fn(tx);
    });
  }
}
