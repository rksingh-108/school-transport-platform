/**
 * Tenant-isolation test foundation. Exercises the actual PostgreSQL
 * Row-Level Security policies (docs/database.md#5-row-level-security) through
 * PrismaService's runInTenantContext helper — the same mechanism every future
 * tenant-scoped repository method will use. This runs against a real
 * database (the restricted `app_user` connection), not a mock, because RLS
 * enforcement is a database-level guarantee that a mock cannot verify.
 *
 * As business modules land in Phase 1, add one cross-tenant-404 case per
 * tenant-scoped resource type here or in that module's own e2e suite — see
 * docs/security.md#6-testing-requirements.
 */
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/database/prisma.service';
import { validateEnv, type Env } from '../src/config/env.schema';

loadDotenv({ path: resolve(__dirname, '../../../.env') });

describe('Tenant isolation (Row-Level Security)', () => {
  let prisma: PrismaService;
  let schoolAId: string;
  let schoolBId: string;

  beforeAll(async () => {
    const env = validateEnv(process.env);
    const configService = new ConfigService<Env, true>(env);
    prisma = new PrismaService(configService);
    await prisma.onModuleInit();

    // Seed two throwaway schools directly as the privileged migration
    // connection would — here we reuse the restricted connection's
    // platform-admin escape hatch instead, since it's already wired and
    // exercises the same policy the real SUPER_ADMIN path will use.
    const a = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({
        data: { name: 'RLS Test School A', slug: `rls-test-a-${Date.now()}`, contactEmail: 'a@rls-test.example' },
      }),
    );
    const b = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({
        data: { name: 'RLS Test School B', slug: `rls-test-b-${Date.now()}`, contactEmail: 'b@rls-test.example' },
      }),
    );
    schoolAId = a.id;
    schoolBId = b.id;
  });

  afterAll(async () => {
    await prisma.runAsPlatformAdmin((tx) =>
      tx.school.deleteMany({ where: { id: { in: [schoolAId, schoolBId] } } }),
    );
    await prisma.onModuleDestroy();
  });

  it('a query scoped to school A cannot see school B, even though both rows exist', async () => {
    const visibleFromA = await prisma.runInTenantContext(schoolAId, (tx) =>
      tx.school.findMany({ where: { id: { in: [schoolAId, schoolBId] } } }),
    );
    expect(visibleFromA.map((s) => s.id)).toEqual([schoolAId]);

    const visibleFromB = await prisma.runInTenantContext(schoolBId, (tx) =>
      tx.school.findMany({ where: { id: { in: [schoolAId, schoolBId] } } }),
    );
    expect(visibleFromB.map((s) => s.id)).toEqual([schoolBId]);
  });

  it('a query with no tenant context set sees nothing (fails closed, not open)', async () => {
    const visible = await prisma.school.findMany({ where: { id: { in: [schoolAId, schoolBId] } } });
    expect(visible).toEqual([]);
  });
});
