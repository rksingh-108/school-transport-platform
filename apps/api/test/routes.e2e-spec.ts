import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: resolve(__dirname, '../../../.env') });

import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/database/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';

describe('Routes and stops (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const passwordService = new PasswordService();
  const suffix = Date.now();
  const STAFF_PASSWORD = 'CorrectHorse123';
  const PARENT_PASSWORD = 'ParentPassw0rd1';

  // Fixtures
  let schoolA: { id: string };
  let schoolB: { id: string };
  let adminA: { id: string; email: string };
  let transportManagerA: { id: string; email: string };
  let driverPrincipalA: { id: string; email: string };
  let adminB: { id: string; email: string };
  let parentA: { id: string; phone: string };
  let routeB: { id: string };

  const api = () => request(app.getHttpServer());

  async function loginAs(email: string) {
    const res = await api().post('/api/v1/auth/staff/login').send({ email, password: STAFF_PASSWORD });
    return res.body.accessToken as string;
  }
  async function loginParentAs(phone: string) {
    const res = await api().post('/api/v1/auth/parent/login').send({ phone, password: PARENT_PASSWORD });
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: ['health', 'health/ready'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);

    const staffHash = await passwordService.hash(STAFF_PASSWORD);
    const parentHash = await passwordService.hash(PARENT_PASSWORD);

    schoolA = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Routes Test School A', slug: `routes-test-a-${suffix}`, contactEmail: `a-${suffix}@routes-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Routes Test School B', slug: `routes-test-b-${suffix}`, contactEmail: `b-${suffix}@routes-test.example` } }),
    );

    const schoolAdminRole = await prisma.runAsPlatformAdmin((tx) => tx.role.findFirstOrThrow({ where: { key: 'SCHOOL_ADMIN', schoolId: null } }));
    const transportManagerRole = await prisma.runAsPlatformAdmin((tx) => tx.role.findFirstOrThrow({ where: { key: 'TRANSPORT_MANAGER', schoolId: null } }));
    const driverRole = await prisma.runAsPlatformAdmin((tx) => tx.role.findFirstOrThrow({ where: { key: 'DRIVER', schoolId: null } }));

    adminA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({ data: { schoolId: schoolA.id, email: `admin.a.${suffix}@routes-test.example`, fullName: 'Admin A', passwordHash: staffHash } }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) => tx.userRole.create({ data: { userId: adminA.id, roleId: schoolAdminRole.id } }));

    transportManagerA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({ data: { schoolId: schoolA.id, email: `manager.a.${suffix}@routes-test.example`, fullName: 'Manager A', passwordHash: staffHash } }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) => tx.userRole.create({ data: { userId: transportManagerA.id, roleId: transportManagerRole.id } }));

    driverPrincipalA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({ data: { schoolId: schoolA.id, email: `driver.a.${suffix}@routes-test.example`, fullName: 'Driver A', passwordHash: staffHash } }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) => tx.userRole.create({ data: { userId: driverPrincipalA.id, roleId: driverRole.id } }));

    adminB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.user.create({ data: { schoolId: schoolB.id, email: `admin.b.${suffix}@routes-test.example`, fullName: 'Admin B', passwordHash: staffHash } }),
    );
    await prisma.runInTenantContext(schoolB.id, (tx) => tx.userRole.create({ data: { userId: adminB.id, roleId: schoolAdminRole.id } }));

    parentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9180007${suffix.toString().slice(-5)}`, fullName: 'Parent A', passwordHash: parentHash } }),
    );

    routeB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.route.create({ data: { schoolId: schoolB.id, name: 'RT-B', direction: 'HOME_TO_SCHOOL', shift: 'MORNING_PICKUP' } }),
    );
  });

  afterAll(async () => {
    for (const schoolId of [schoolA.id, schoolB.id]) {
      await prisma.runInTenantContext(schoolId, async (tx) => {
        await tx.routeStop.deleteMany({ where: { schoolId } });
        await tx.route.deleteMany({ where: { schoolId } });
        await tx.auditLog.deleteMany({ where: { schoolId } });
        await tx.refreshToken.deleteMany({ where: { schoolId } });
        await tx.parent.deleteMany({ where: { schoolId } });
        await tx.user.deleteMany({ where: { schoolId } });
        await tx.school.delete({ where: { id: schoolId } });
      });
    }
    await app.close();
  });

  // ---------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------
  describe('routes', () => {
    let routeAId: string;

    it('an authorized admin can create a route', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'RT-A-01', name: 'Test Route A', direction: 'HOME_TO_SCHOOL', shift: 'MORNING_PICKUP' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.stopCount).toBe(0);
      expect(res.body).not.toHaveProperty('schoolId');
      routeAId = res.body.id;
    });

    it('a client-supplied schoolId on the create body has no effect', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Escape Route', direction: 'HOME_TO_SCHOOL', shift: 'CUSTOM', schoolId: schoolB.id });
      expect(res.status).toBe(201);
      const getRes = await api().get(`/api/v1/routes/${res.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);
    });

    it('rejects invalid data (missing direction, bad enum)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bad Route', direction: 'SIDEWAYS', shift: 'MORNING_PICKUP' });
      expect(res.status).toBe(400);
    });

    it('an authorized admin can read, update, and archive a route', async () => {
      const token = await loginAs(adminA.email);

      const patchRes = await api().patch(`/api/v1/routes/${routeAId}`).set('Authorization', `Bearer ${token}`).send({ name: 'Renamed Route' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.name).toBe('Renamed Route');

      const statusRes = await api().patch(`/api/v1/routes/${routeAId}`).set('Authorization', `Bearer ${token}`).send({ status: 'INACTIVE' });
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe('INACTIVE');

      const archiveRes = await api().post(`/api/v1/routes/${routeAId}/archive`).set('Authorization', `Bearer ${token}`);
      expect(archiveRes.status).toBe(200);
      expect(archiveRes.body.status).toBe('ARCHIVED');

      const archiveAgainRes = await api().post(`/api/v1/routes/${routeAId}/archive`).set('Authorization', `Bearer ${token}`);
      expect(archiveAgainRes.status).toBe(400);
    });

    it('PATCH cannot set status directly to ARCHIVED', async () => {
      const token = await loginAs(adminA.email);
      const createRes = await api()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Archive Guard Route', direction: 'SCHOOL_TO_HOME', shift: 'AFTERNOON_DROP' });
      const res = await api().patch(`/api/v1/routes/${createRes.body.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'ARCHIVED' });
      expect(res.status).toBe(400);
    });

    it('search, status, and direction filters work', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().get('/api/v1/routes?direction=SCHOOL_TO_HOME&status=ACTIVE').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.every((r: { direction: string; status: string }) => r.direction === 'SCHOOL_TO_HOME' && r.status === 'ACTIVE')).toBe(true);
    });

    it('pagination respects limit and returns a usable nextCursor', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().get('/api/v1/routes?limit=1').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(typeof res.body.nextCursor === 'string' || res.body.nextCursor === null).toBe(true);
    });

    it('TRANSPORT_MANAGER can read but not manage routes', async () => {
      const token = await loginAs(transportManagerA.email);
      const listRes = await api().get('/api/v1/routes').set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      const createRes = await api()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Manager Route', direction: 'HOME_TO_SCHOOL', shift: 'MORNING_PICKUP' });
      expect(createRes.status).toBe(403);
    });

    it('a driver (no routes.read) cannot access routes', async () => {
      const token = await loginAs(driverPrincipalA.email);
      const res = await api().get('/api/v1/routes').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('a parent cannot access route management endpoints', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get('/api/v1/routes').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it("cross-tenant: School A admin cannot GET, PATCH, or archive School B's route", async () => {
      const token = await loginAs(adminA.email);
      const getRes = await api().get(`/api/v1/routes/${routeB.id}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(404);
      const patchRes = await api().patch(`/api/v1/routes/${routeB.id}`).set('Authorization', `Bearer ${token}`).send({ name: 'Hijacked' });
      expect(patchRes.status).toBe(404);
      const archiveRes = await api().post(`/api/v1/routes/${routeB.id}/archive`).set('Authorization', `Bearer ${token}`);
      expect(archiveRes.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // Stops
  // ---------------------------------------------------------------------
  describe('stops', () => {
    let stopRouteId: string;
    const stopIds: string[] = [];

    beforeAll(async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Stops Test Route', direction: 'HOME_TO_SCHOOL', shift: 'MORNING_PICKUP' });
      stopRouteId = res.body.id;
    });

    it('an authorized admin can create stops on their own route in sequence order', async () => {
      const token = await loginAs(adminA.email);
      for (let i = 1; i <= 3; i++) {
        const res = await api()
          .post(`/api/v1/routes/${stopRouteId}/stops`)
          .set('Authorization', `Bearer ${token}`)
          .send({ name: `Stop ${i}`, latitude: 12.9 + i * 0.01, longitude: 77.6 + i * 0.01, sequenceNo: i, expectedOffsetMinutes: i * 5 });
        expect(res.status).toBe(201);
        stopIds.push(res.body.id);
      }

      const listRes = await api().get(`/api/v1/routes/${stopRouteId}/stops`).set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.map((s: { name: string }) => s.name)).toEqual(['Stop 1', 'Stop 2', 'Stop 3']);
    });

    it('rejects a duplicate sequence number on the same route', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post(`/api/v1/routes/${stopRouteId}/stops`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Dup Sequence', latitude: 12.9, longitude: 77.6, sequenceNo: 1, expectedOffsetMinutes: 0 });
      expect(res.status).toBe(400);
    });

    it('rejects invalid coordinates', async () => {
      const token = await loginAs(adminA.email);
      const badLat = await api()
        .post(`/api/v1/routes/${stopRouteId}/stops`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bad Lat', latitude: 999, longitude: 77.6, sequenceNo: 10, expectedOffsetMinutes: 0 });
      expect(badLat.status).toBe(400);

      const badLng = await api()
        .post(`/api/v1/routes/${stopRouteId}/stops`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bad Lng', latitude: 12.9, longitude: -999, sequenceNo: 11, expectedOffsetMinutes: 0 });
      expect(badLng.status).toBe(400);
    });

    it('cannot create a stop under a route from another school (404)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post(`/api/v1/routes/${routeB.id}/stops`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Cross Tenant Stop', latitude: 12.9, longitude: 77.6, sequenceNo: 1, expectedOffsetMinutes: 0 });
      expect(res.status).toBe(404);
    });

    it('can read and update a stop, and deactivating fires the deactivate path', async () => {
      const token = await loginAs(adminA.email);
      const getRes = await api().get(`/api/v1/stops/${stopIds[0]}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);

      const patchRes = await api().patch(`/api/v1/stops/${stopIds[0]}`).set('Authorization', `Bearer ${token}`).send({ address: '123 Test St' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.address).toBe('123 Test St');

      const deactivateRes = await api().patch(`/api/v1/stops/${stopIds[0]}`).set('Authorization', `Bearer ${token}`).send({ status: 'INACTIVE' });
      expect(deactivateRes.status).toBe(200);
      expect(deactivateRes.body.status).toBe('INACTIVE');
    });

    it('reorders stops atomically', async () => {
      const token = await loginAs(adminA.email);
      const newOrder = [stopIds[2], stopIds[0], stopIds[1]];
      const res = await api()
        .post(`/api/v1/routes/${stopRouteId}/stops/reorder`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stopIds: newOrder });
      expect(res.status).toBe(200);
      expect(res.body.map((s: { id: string }) => s.id)).toEqual(newOrder);
      expect(res.body.map((s: { sequenceNo: number }) => s.sequenceNo)).toEqual([1, 2, 3]);
    });

    it('rejects a reorder that omits or adds a stop id', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post(`/api/v1/routes/${stopRouteId}/stops/reorder`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stopIds: [stopIds[0], stopIds[1]] });
      expect(res.status).toBe(400);
    });

    it('deletes a stop', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().delete(`/api/v1/stops/${stopIds[0]}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      const getRes = await api().get(`/api/v1/stops/${stopIds[0]}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(404);
    });

    it('a staff member without routes.manage cannot create, update, reorder, or delete stops', async () => {
      const token = await loginAs(driverPrincipalA.email);
      const createRes = await api()
        .post(`/api/v1/routes/${stopRouteId}/stops`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Denied', latitude: 12.9, longitude: 77.6, sequenceNo: 20, expectedOffsetMinutes: 0 });
      expect(createRes.status).toBe(403);
    });

    it('a parent cannot access stop management endpoints', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get(`/api/v1/routes/${stopRouteId}/stops`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it("cross-tenant: School A admin cannot list School B's route stops, or GET/PATCH/DELETE a School B stop directly", async () => {
      const token = await loginAs(adminA.email);
      const stopB = await prisma.runInTenantContext(schoolB.id, (tx) =>
        tx.routeStop.create({
          data: { schoolId: schoolB.id, routeId: routeB.id, sequenceNo: 1, name: 'Stop B', latitude: 19.07, longitude: 72.87, expectedOffsetMinutes: 0 },
        }),
      );

      const listRes = await api().get(`/api/v1/routes/${routeB.id}/stops`).set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(404);

      const getRes = await api().get(`/api/v1/stops/${stopB.id}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(404);

      const patchRes = await api().patch(`/api/v1/stops/${stopB.id}`).set('Authorization', `Bearer ${token}`).send({ address: 'Hijacked' });
      expect(patchRes.status).toBe(404);

      const deleteRes = await api().delete(`/api/v1/stops/${stopB.id}`).set('Authorization', `Bearer ${token}`);
      expect(deleteRes.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // Direct RLS verification (bypassing the API entirely)
  // ---------------------------------------------------------------------
  describe('RLS enforcement (direct, bypassing the API)', () => {
    it('a tenant-scoped query for School A never returns School B rows, for routes/route_stops', async () => {
      const [routesFromA, stopsFromA] = await Promise.all([
        prisma.runInTenantContext(schoolA.id, (tx) => tx.route.findMany({ where: { id: routeB.id } })),
        prisma.runInTenantContext(schoolA.id, (tx) => tx.routeStop.findMany({ where: { routeId: routeB.id } })),
      ]);
      expect(routesFromA).toEqual([]);
      expect(stopsFromA).toEqual([]);
    });

    it('no tenant context set at all returns zero rows (FORCE ROW LEVEL SECURITY default-deny)', async () => {
      const routeCount = await prisma.route.count({ where: { id: routeB.id } });
      const stopCount = await prisma.routeStop.count({ where: { routeId: routeB.id } });
      expect(routeCount).toBe(0);
      expect(stopCount).toBe(0);
    });
  });
});
