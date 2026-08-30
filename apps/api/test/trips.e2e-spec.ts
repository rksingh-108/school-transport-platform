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

describe('Trips, trip stops, and student manifests (e2e)', () => {
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
  let driverUserA: { id: string; email: string };
  let driverA: { id: string };
  let driverUserA2: { id: string; email: string };
  let driverA2: { id: string };
  let attendantUserA: { id: string; email: string };
  let attendantA: { id: string };
  let routeA: { id: string };
  let busA: { id: string };
  let busA2: { id: string };
  let studentA1: { id: string };
  let studentA2: { id: string };
  let parentA: { id: string; phone: string };

  let adminB: { id: string; email: string };
  let routeB: { id: string };
  let busB: { id: string };
  let driverUserB: { id: string; email: string };
  let driverB: { id: string };
  let attendantUserB: { id: string; email: string };
  let attendantB: { id: string };
  let studentB1: { id: string };

  const api = () => request(app.getHttpServer());

  async function loginAs(email: string) {
    const res = await api().post('/api/v1/auth/staff/login').send({ email, password: STAFF_PASSWORD });
    return res.body.accessToken as string;
  }
  async function loginParentAs(phone: string) {
    const res = await api().post('/api/v1/auth/parent/login').send({ phone, password: PARENT_PASSWORD });
    return res.body.accessToken as string;
  }

  async function makeStaff(schoolId: string, email: string, roleKey: string, passwordHash: string) {
    const role = await prisma.runAsPlatformAdmin((tx) => tx.role.findFirstOrThrow({ where: { key: roleKey, schoolId: null } }));
    const user = await prisma.runInTenantContext(schoolId, (tx) =>
      tx.user.create({ data: { schoolId, email, fullName: email.split('@')[0]!, passwordHash } }),
    );
    await prisma.runInTenantContext(schoolId, (tx) => tx.userRole.create({ data: { userId: user.id, roleId: role.id } }));
    return user;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
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
      tx.school.create({ data: { name: 'Trips Test School A', slug: `trips-test-a-${suffix}`, contactEmail: `a-${suffix}@trips-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Trips Test School B', slug: `trips-test-b-${suffix}`, contactEmail: `b-${suffix}@trips-test.example` } }),
    );

    adminA = await makeStaff(schoolA.id, `admin.a.${suffix}@trips-test.example`, 'SCHOOL_ADMIN', staffHash);
    transportManagerA = await makeStaff(schoolA.id, `manager.a.${suffix}@trips-test.example`, 'TRANSPORT_MANAGER', staffHash);
    driverUserA = await makeStaff(schoolA.id, `driver.a.${suffix}@trips-test.example`, 'DRIVER', staffHash);
    driverUserA2 = await makeStaff(schoolA.id, `driver.a2.${suffix}@trips-test.example`, 'DRIVER', staffHash);
    attendantUserA = await makeStaff(schoolA.id, `attendant.a.${suffix}@trips-test.example`, 'BUS_ATTENDANT', staffHash);

    driverA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.driver.create({ data: { schoolId: schoolA.id, userId: driverUserA.id, licenseNumber: `LIC-A-${suffix}` } }),
    );
    driverA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.driver.create({ data: { schoolId: schoolA.id, userId: driverUserA2.id, licenseNumber: `LIC-A2-${suffix}` } }),
    );
    attendantA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.attendant.create({ data: { schoolId: schoolA.id, userId: attendantUserA.id } }),
    );

    routeA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.route.create({
        data: {
          schoolId: schoolA.id,
          name: `Trip Test Route A ${suffix}`,
          direction: 'HOME_TO_SCHOOL',
          shift: 'MORNING_PICKUP',
          stops: {
            create: [
              { schoolId: schoolA.id, sequenceNo: 1, name: 'Stop 1', latitude: 12.9, longitude: 77.6, expectedOffsetMinutes: 0 },
              { schoolId: schoolA.id, sequenceNo: 2, name: 'Stop 2', latitude: 12.91, longitude: 77.61, expectedOffsetMinutes: 10 },
            ],
          },
        },
      }),
    );

    busA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `TRIP-A-${suffix}`, capacity: 40 } }),
    );
    busA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `TRIP-A2-${suffix}`, capacity: 30 } }),
    );

    studentA1 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `TRIP-A-${suffix}-1`, fullName: 'Student A1' } }),
    );
    studentA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `TRIP-A-${suffix}-2`, fullName: 'Student A2' } }),
    );

    parentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9180008${suffix.toString().slice(-5)}`, fullName: 'Parent A', passwordHash: parentHash } }),
    );

    // School B — for cross-tenant IDOR tests
    adminB = await makeStaff(schoolB.id, `admin.b.${suffix}@trips-test.example`, 'SCHOOL_ADMIN', staffHash);
    driverUserB = await makeStaff(schoolB.id, `driver.b.${suffix}@trips-test.example`, 'DRIVER', staffHash);
    attendantUserB = await makeStaff(schoolB.id, `attendant.b.${suffix}@trips-test.example`, 'BUS_ATTENDANT', staffHash);
    driverB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.driver.create({ data: { schoolId: schoolB.id, userId: driverUserB.id, licenseNumber: `LIC-B-${suffix}` } }),
    );
    attendantB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.attendant.create({ data: { schoolId: schoolB.id, userId: attendantUserB.id } }),
    );
    routeB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.route.create({
        data: {
          schoolId: schoolB.id,
          name: `Trip Test Route B ${suffix}`,
          direction: 'HOME_TO_SCHOOL',
          shift: 'MORNING_PICKUP',
          stops: { create: [{ schoolId: schoolB.id, sequenceNo: 1, name: 'B Stop 1', latitude: 19.07, longitude: 72.87, expectedOffsetMinutes: 0 }] },
        },
      }),
    );
    busB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolB.id, registrationNumber: `TRIP-B-${suffix}`, capacity: 35 } }),
    );
    studentB1 = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolB.id, admissionNumber: `TRIP-B-${suffix}-1`, fullName: 'Student B1' } }),
    );
  });

  afterAll(async () => {
    for (const schoolId of [schoolA.id, schoolB.id]) {
      await prisma.runInTenantContext(schoolId, async (tx) => {
        await tx.attendanceEvent.deleteMany({ where: { schoolId } });
        await tx.tripStudent.deleteMany({ where: { schoolId } });
        await tx.tripStop.deleteMany({ where: { schoolId } });
        await tx.trip.deleteMany({ where: { schoolId } });
        await tx.routeStop.deleteMany({ where: { schoolId } });
        await tx.route.deleteMany({ where: { schoolId } });
        await tx.bus.deleteMany({ where: { schoolId } });
        await tx.driver.deleteMany({ where: { schoolId } });
        await tx.attendant.deleteMany({ where: { schoolId } });
        await tx.student.deleteMany({ where: { schoolId } });
        await tx.parent.deleteMany({ where: { schoolId } });
        await tx.auditLog.deleteMany({ where: { schoolId } });
        await tx.refreshToken.deleteMany({ where: { schoolId } });
        await tx.user.deleteMany({ where: { schoolId } });
        await tx.school.delete({ where: { id: schoolId } });
      });
    }
    await app.close();
  });

  function tripBody(overrides: Record<string, unknown> = {}) {
    return {
      routeId: routeA.id,
      busId: busA.id,
      driverId: driverA.id,
      attendantId: attendantA.id,
      serviceDate: '2026-09-01',
      scheduledStartTime: '07:00',
      scheduledEndTime: '08:00',
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Trip CRUD + validation
  // ---------------------------------------------------------------------
  describe('trip creation and validation', () => {
    it('an authorized admin can create a trip with a full assignment, snapshotting the route stops', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody());
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('SCHEDULED');
      expect(res.body.routeName).toBeDefined();
      expect(res.body.driverName).toBeDefined();
      expect(res.body.studentCount).toBe(0);
      expect(res.body).not.toHaveProperty('schoolId');

      const stopsRes = await api().get(`/api/v1/trips/${res.body.id}/stops`).set('Authorization', `Bearer ${token}`);
      expect(stopsRes.status).toBe(200);
      expect(stopsRes.body.map((s: { name: string }) => s.name)).toEqual(['Stop 1', 'Stop 2']);
    });

    it('rejects an invalid time range (end before start)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/trips')
        .set('Authorization', `Bearer ${token}`)
        .send(tripBody({ serviceDate: '2026-09-02', scheduledStartTime: '08:00', scheduledEndTime: '07:00' }));
      expect(res.status).toBe(400);
    });

    it('rejects a route that is not ACTIVE', async () => {
      const token = await loginAs(adminA.email);
      const inactiveRoute = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.route.create({
          data: { schoolId: schoolA.id, name: `Inactive Route ${suffix}`, direction: 'HOME_TO_SCHOOL', shift: 'CUSTOM', status: 'INACTIVE' },
        }),
      );
      const res = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ routeId: inactiveRoute.id, serviceDate: '2026-09-03' }));
      expect(res.status).toBe(400);
    });

    it('rejects a route with no active stops', async () => {
      const token = await loginAs(adminA.email);
      const emptyRoute = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.route.create({ data: { schoolId: schoolA.id, name: `Empty Route ${suffix}`, direction: 'HOME_TO_SCHOOL', shift: 'CUSTOM' } }),
      );
      const res = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ routeId: emptyRoute.id, serviceDate: '2026-09-03' }));
      expect(res.status).toBe(400);
    });

    it('rejects a bus that is not ACTIVE', async () => {
      const token = await loginAs(adminA.email);
      const maintenanceBus = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `MAINT-${suffix}`, capacity: 20, status: 'MAINTENANCE' } }),
      );
      const res = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ busId: maintenanceBus.id, serviceDate: '2026-09-03' }));
      expect(res.status).toBe(400);
    });

    it('rejects a driver whose profile is deactivated', async () => {
      const token = await loginAs(adminA.email);
      const inactiveDriverUser = await makeStaff(schoolA.id, `driver.inactive.${suffix}@trips-test.example`, 'DRIVER', await passwordService.hash(STAFF_PASSWORD));
      const inactiveDriver = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.driver.create({ data: { schoolId: schoolA.id, userId: inactiveDriverUser.id, licenseNumber: `LIC-INACTIVE-${suffix}`, status: 'INACTIVE' } }),
      );
      const res = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ driverId: inactiveDriver.id, serviceDate: '2026-09-03' }));
      expect(res.status).toBe(400);
    });

    it('rejects a driver whose underlying staff account is suspended', async () => {
      const token = await loginAs(adminA.email);
      const suspendedUser = await makeStaff(schoolA.id, `driver.suspended.${suffix}@trips-test.example`, 'DRIVER', await passwordService.hash(STAFF_PASSWORD));
      await prisma.runInTenantContext(schoolA.id, (tx) => tx.user.update({ where: { id: suspendedUser.id }, data: { status: 'SUSPENDED' } }));
      const suspendedDriver = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.driver.create({ data: { schoolId: schoolA.id, userId: suspendedUser.id, licenseNumber: `LIC-SUSPENDED-${suffix}` } }),
      );
      const res = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ driverId: suspendedDriver.id, serviceDate: '2026-09-03' }));
      expect(res.status).toBe(400);
    });

    it('a driver cannot create, update, or cancel any trip (no trips.manage)', async () => {
      const token = await loginAs(driverUserA.email);
      const res = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ serviceDate: '2026-09-04' }));
      expect(res.status).toBe(403);
    });

    it('a parent cannot access trip management endpoints', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get('/api/v1/trips').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('TRANSPORT_MANAGER can create and manage trips', async () => {
      const token = await loginAs(transportManagerA.email);
      const res = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ serviceDate: '2026-09-05' }));
      expect(res.status).toBe(201);
    });
  });

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------
  describe('trip lifecycle', () => {
    let tripId: string;

    beforeAll(async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ serviceDate: '2026-09-10' }));
      tripId = res.body.id;
    });

    it('cannot start a trip that is only SCHEDULED (must be READY first)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post(`/api/v1/trips/${tripId}/start`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('SCHEDULED -> READY -> IN_PROGRESS -> COMPLETED, promoting manifest to ACTIVE on start', async () => {
      const token = await loginAs(adminA.email);

      const lifecycleStops = await api().get(`/api/v1/trips/${tripId}/stops`).set('Authorization', `Bearer ${token}`);
      const addStudentRes = await api()
        .post(`/api/v1/trips/${tripId}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentId: studentA1.id, pickupTripStopId: lifecycleStops.body[0].id, dropoffTripStopId: null });
      expect(addStudentRes.status).toBe(201);

      const readyRes = await api().post(`/api/v1/trips/${tripId}/ready`).set('Authorization', `Bearer ${token}`);
      expect(readyRes.status).toBe(200);
      expect(readyRes.body.status).toBe('READY');

      const readyAgainRes = await api().post(`/api/v1/trips/${tripId}/ready`).set('Authorization', `Bearer ${token}`);
      expect(readyAgainRes.status).toBe(400);

      const startRes = await api().post(`/api/v1/trips/${tripId}/start`).set('Authorization', `Bearer ${token}`);
      expect(startRes.status).toBe(200);
      expect(startRes.body.status).toBe('IN_PROGRESS');

      const manifestRes = await api().get(`/api/v1/trips/${tripId}/students`).set('Authorization', `Bearer ${token}`);
      expect(manifestRes.body[0].membershipStatus).toBe('ACTIVE');

      const completeRes = await api().post(`/api/v1/trips/${tripId}/complete`).set('Authorization', `Bearer ${token}`);
      expect(completeRes.status).toBe(200);
      expect(completeRes.body.status).toBe('COMPLETED');

      const restartRes = await api().post(`/api/v1/trips/${tripId}/start`).set('Authorization', `Bearer ${token}`);
      expect(restartRes.status).toBe(400);
    });

    it('cannot edit a trip once it is no longer SCHEDULED/READY', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().patch(`/api/v1/trips/${tripId}`).set('Authorization', `Bearer ${token}`).send({ notes: 'too late' });
      expect(res.status).toBe(400);
    });

    it('cancel requires a reason and only works from a non-terminal state', async () => {
      const token = await loginAs(adminA.email);
      const createRes = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ serviceDate: '2026-09-11' }));
      const newTripId = createRes.body.id;

      const missingReasonRes = await api().post(`/api/v1/trips/${newTripId}/cancel`).set('Authorization', `Bearer ${token}`).send({});
      expect(missingReasonRes.status).toBe(400);

      const cancelRes = await api().post(`/api/v1/trips/${newTripId}/cancel`).set('Authorization', `Bearer ${token}`).send({ reason: 'Holiday' });
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('CANCELLED');
      expect(cancelRes.body.cancellationReason).toBe('Holiday');

      const cancelAgainRes = await api().post(`/api/v1/trips/${newTripId}/cancel`).set('Authorization', `Bearer ${token}`).send({ reason: 'Again' });
      expect(cancelAgainRes.status).toBe(400);
    });

    it('no-show only works from SCHEDULED/READY, never IN_PROGRESS', async () => {
      const token = await loginAs(adminA.email);
      const createRes = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ serviceDate: '2026-09-12' }));
      const noShowTripId = createRes.body.id;

      const noShowRes = await api().post(`/api/v1/trips/${noShowTripId}/no-show`).set('Authorization', `Bearer ${token}`).send({ reason: 'Driver unavailable' });
      expect(noShowRes.status).toBe(200);
      expect(noShowRes.body.status).toBe('NO_SHOW');

      const createRes2 = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ serviceDate: '2026-09-13' }));
      const inProgressTripId = createRes2.body.id;
      await api().post(`/api/v1/trips/${inProgressTripId}/ready`).set('Authorization', `Bearer ${token}`);
      await api().post(`/api/v1/trips/${inProgressTripId}/start`).set('Authorization', `Bearer ${token}`);
      const invalidNoShowRes = await api().post(`/api/v1/trips/${inProgressTripId}/no-show`).set('Authorization', `Bearer ${token}`).send({ reason: 'x' });
      expect(invalidNoShowRes.status).toBe(400);
    });

    it('reassigning while READY resets status back to SCHEDULED', async () => {
      const token = await loginAs(adminA.email);
      const createRes = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ serviceDate: '2026-09-14' }));
      const readyTripId = createRes.body.id;
      await api().post(`/api/v1/trips/${readyTripId}/ready`).set('Authorization', `Bearer ${token}`);

      const patchRes = await api().patch(`/api/v1/trips/${readyTripId}`).set('Authorization', `Bearer ${token}`).send({ busId: busA2.id });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.status).toBe('SCHEDULED');
    });
  });

  // ---------------------------------------------------------------------
  // Driver-scoped own-trip authorization
  // ---------------------------------------------------------------------
  describe('driver own-trip authorization', () => {
    let ownTripId: string;
    let otherTripId: string;

    beforeAll(async () => {
      const token = await loginAs(adminA.email);
      const ownRes = await api()
        .post('/api/v1/trips')
        .set('Authorization', `Bearer ${token}`)
        .send(tripBody({ serviceDate: '2026-09-20', driverId: driverA.id }));
      ownTripId = ownRes.body.id;
      await api().post(`/api/v1/trips/${ownTripId}/ready`).set('Authorization', `Bearer ${token}`);

      const otherRes = await api()
        .post('/api/v1/trips')
        .set('Authorization', `Bearer ${token}`)
        .send(tripBody({ serviceDate: '2026-09-21', driverId: driverA2.id }));
      otherTripId = otherRes.body.id;
      await api().post(`/api/v1/trips/${otherTripId}/ready`).set('Authorization', `Bearer ${token}`);
    });

    it('a driver can start and complete their own assigned trip', async () => {
      const token = await loginAs(driverUserA.email);
      const startRes = await api().post(`/api/v1/trips/${ownTripId}/start`).set('Authorization', `Bearer ${token}`);
      expect(startRes.status).toBe(200);
      const completeRes = await api().post(`/api/v1/trips/${ownTripId}/complete`).set('Authorization', `Bearer ${token}`);
      expect(completeRes.status).toBe(200);
    });

    it("a driver cannot start another driver's trip", async () => {
      const token = await loginAs(driverUserA.email);
      const res = await api().post(`/api/v1/trips/${otherTripId}/start`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('an attendant (not the assigned driver) cannot start a trip', async () => {
      const token = await loginAs(attendantUserA.email);
      const res = await api().post(`/api/v1/trips/${otherTripId}/start`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it("a driver's trip list is scoped to only their own trips", async () => {
      const token = await loginAs(driverUserA.email);
      const res = await api().get('/api/v1/trips').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.every((t: { driverId: string }) => t.driverId === driverA.id)).toBe(true);

      const getOtherRes = await api().get(`/api/v1/trips/${otherTripId}`).set('Authorization', `Bearer ${token}`);
      expect(getOtherRes.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // Scheduling conflicts
  // ---------------------------------------------------------------------
  describe('scheduling conflicts', () => {
    // Each trip below shares serviceDate 2026-09-30/2026-10-01 to exercise
    // overlap logic, so each needs its OWN route — Trip has a pre-existing
    // `unique(routeId, serviceDate, shift)` constraint (Phase 0) preventing
    // two trips for the same route/date/shift, which is a different rule
    // from resource-conflict detection and would otherwise collide here.
    const conflictRoutes: { id: string }[] = [];
    beforeAll(async () => {
      for (let i = 0; i < 5; i++) {
        const route = await prisma.runInTenantContext(schoolA.id, (tx) =>
          tx.route.create({
            data: {
              schoolId: schoolA.id,
              name: `Conflict Test Route ${i} ${suffix}`,
              direction: 'HOME_TO_SCHOOL',
              shift: 'MORNING_PICKUP',
              stops: { create: [{ schoolId: schoolA.id, sequenceNo: 1, name: 'Only Stop', latitude: 12.9, longitude: 77.6, expectedOffsetMinutes: 0 }] },
            },
          }),
        );
        conflictRoutes.push(route);
      }
    });

    it('rejects a second trip for the same bus with an overlapping time', async () => {
      const token = await loginAs(adminA.email);
      const first = await api()
        .post('/api/v1/trips')
        .set('Authorization', `Bearer ${token}`)
        .send(tripBody({ routeId: conflictRoutes[0]!.id, serviceDate: '2026-09-30', scheduledStartTime: '07:00', scheduledEndTime: '08:15', driverId: driverA2.id, attendantId: undefined }));
      expect(first.status).toBe(201);

      const conflicting = await api()
        .post('/api/v1/trips')
        .set('Authorization', `Bearer ${token}`)
        .send(tripBody({ routeId: conflictRoutes[1]!.id, serviceDate: '2026-09-30', scheduledStartTime: '07:30', scheduledEndTime: '08:30', busId: busA.id, driverId: driverA2.id, attendantId: undefined }));
      expect(conflicting.status).toBe(409);
    });

    it('allows a non-overlapping trip for the same bus on the same day', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/trips')
        .set('Authorization', `Bearer ${token}`)
        .send(tripBody({ routeId: conflictRoutes[2]!.id, serviceDate: '2026-09-30', scheduledStartTime: '09:00', scheduledEndTime: '10:00', busId: busA.id, driverId: driverA2.id, attendantId: undefined }));
      expect(res.status).toBe(201);
    });

    it('allows an overlapping trip when the bus/driver/attendant are all different', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/trips')
        .set('Authorization', `Bearer ${token}`)
        .send(tripBody({ routeId: conflictRoutes[3]!.id, serviceDate: '2026-09-30', scheduledStartTime: '07:00', scheduledEndTime: '08:15', busId: busA2.id, driverId: driverA.id, attendantId: attendantA.id }));
      expect(res.status).toBe(201);
    });

    it('rejects an overlapping trip for the same driver even on a different bus', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/trips')
        .set('Authorization', `Bearer ${token}`)
        .send(tripBody({ routeId: conflictRoutes[4]!.id, serviceDate: '2026-09-30', scheduledStartTime: '07:10', scheduledEndTime: '08:00', busId: busA2.id, driverId: driverA2.id }));
      expect(res.status).toBe(409);
    });

    it('a cancelled trip no longer counts as a conflict', async () => {
      const token = await loginAs(adminA.email);
      const route1 = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.route.create({
          data: {
            schoolId: schoolA.id,
            name: `Conflict Test Route 5 ${suffix}`,
            direction: 'HOME_TO_SCHOOL',
            shift: 'MORNING_PICKUP',
            stops: { create: [{ schoolId: schoolA.id, sequenceNo: 1, name: 'Only Stop', latitude: 12.9, longitude: 77.6, expectedOffsetMinutes: 0 }] },
          },
        }),
      );
      const route2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.route.create({
          data: {
            schoolId: schoolA.id,
            name: `Conflict Test Route 6 ${suffix}`,
            direction: 'HOME_TO_SCHOOL',
            shift: 'MORNING_PICKUP',
            stops: { create: [{ schoolId: schoolA.id, sequenceNo: 1, name: 'Only Stop', latitude: 12.9, longitude: 77.6, expectedOffsetMinutes: 0 }] },
          },
        }),
      );

      const created = await api()
        .post('/api/v1/trips')
        .set('Authorization', `Bearer ${token}`)
        .send(tripBody({ routeId: route1.id, serviceDate: '2026-10-01', scheduledStartTime: '07:00', scheduledEndTime: '08:00', busId: busA.id, driverId: driverA.id }));
      await api().post(`/api/v1/trips/${created.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({ reason: 'test' });

      const res = await api()
        .post('/api/v1/trips')
        .set('Authorization', `Bearer ${token}`)
        .send(tripBody({ routeId: route2.id, serviceDate: '2026-10-01', scheduledStartTime: '07:00', scheduledEndTime: '08:00', busId: busA.id, driverId: driverA.id }));
      expect(res.status).toBe(201);
    });
  });

  // ---------------------------------------------------------------------
  // TripStop snapshot / historical integrity
  // ---------------------------------------------------------------------
  describe('trip stop snapshot', () => {
    it('editing the live route stop afterward does not change an existing trip snapshot', async () => {
      const token = await loginAs(adminA.email);
      const created = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ serviceDate: '2026-10-05' }));

      const liveStops = await api().get(`/api/v1/routes/${routeA.id}/stops`).set('Authorization', `Bearer ${token}`);
      const firstLiveStop = liveStops.body[0];
      await api().patch(`/api/v1/stops/${firstLiveStop.id}`).set('Authorization', `Bearer ${token}`).send({ name: 'Renamed After Trip Created' });

      const tripStops = await api().get(`/api/v1/trips/${created.body.id}/stops`).set('Authorization', `Bearer ${token}`);
      expect(tripStops.body.find((s: { name: string }) => s.name === 'Renamed After Trip Created')).toBeUndefined();
      expect(tripStops.body.map((s: { name: string }) => s.name)).toContain('Stop 1');
    });
  });

  // ---------------------------------------------------------------------
  // Student manifest
  // ---------------------------------------------------------------------
  describe('student manifest', () => {
    let manifestTripId: string;
    let pickupStopId: string;

    beforeAll(async () => {
      const token = await loginAs(adminA.email);
      const created = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ serviceDate: '2026-10-10' }));
      manifestTripId = created.body.id;
      const stops = await api().get(`/api/v1/trips/${manifestTripId}/stops`).set('Authorization', `Bearer ${token}`);
      pickupStopId = stops.body[0].id;
    });

    it('rejects an entry with neither pickup nor dropoff', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post(`/api/v1/trips/${manifestTripId}/students`).set('Authorization', `Bearer ${token}`).send({ studentId: studentA1.id });
      expect(res.status).toBe(400);
    });

    it('adds a student with a pickup stop and dropoff at "the school" (null)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post(`/api/v1/trips/${manifestTripId}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentId: studentA1.id, pickupTripStopId: pickupStopId, dropoffTripStopId: null });
      expect(res.status).toBe(201);
      expect(res.body.pickupTripStopId).toBe(pickupStopId);
      expect(res.body.dropoffTripStopId).toBeNull();
      expect(res.body.membershipStatus).toBe('PLANNED');
    });

    it('rejects a duplicate student on the same trip', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post(`/api/v1/trips/${manifestTripId}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentId: studentA1.id, pickupTripStopId: pickupStopId });
      expect(res.status).toBe(400);
    });

    it('rejects a stop id that belongs to a different trip', async () => {
      const token = await loginAs(adminA.email);
      const otherTrip = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ serviceDate: '2026-10-11' }));
      const otherStops = await api().get(`/api/v1/trips/${otherTrip.body.id}/stops`).set('Authorization', `Bearer ${token}`);
      const res = await api()
        .post(`/api/v1/trips/${manifestTripId}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentId: studentA2.id, pickupTripStopId: otherStops.body[0].id });
      expect(res.status).toBe(400);
    });

    it('rejects an inactive student', async () => {
      const token = await loginAs(adminA.email);
      const inactiveStudent = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `TRIP-A-${suffix}-INACTIVE`, fullName: 'Inactive Student', status: 'INACTIVE' } }),
      );
      const res = await api()
        .post(`/api/v1/trips/${manifestTripId}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentId: inactiveStudent.id, pickupTripStopId: pickupStopId });
      expect(res.status).toBe(400);
    });

    it('removes (soft) a student, excludes them from the manifest, then allows re-adding', async () => {
      const token = await loginAs(adminA.email);
      const listBefore = await api().get(`/api/v1/trips/${manifestTripId}/students`).set('Authorization', `Bearer ${token}`);
      const entryId = listBefore.body.find((e: { studentId: string }) => e.studentId === studentA1.id).id;

      const removeRes = await api().delete(`/api/v1/trips/${manifestTripId}/students/${entryId}`).set('Authorization', `Bearer ${token}`);
      expect(removeRes.status).toBe(200);

      const listAfter = await api().get(`/api/v1/trips/${manifestTripId}/students`).set('Authorization', `Bearer ${token}`);
      expect(listAfter.body.find((e: { studentId: string }) => e.studentId === studentA1.id)).toBeUndefined();

      const removeAgainRes = await api().delete(`/api/v1/trips/${manifestTripId}/students/${entryId}`).set('Authorization', `Bearer ${token}`);
      expect(removeAgainRes.status).toBe(400);

      const readdRes = await api()
        .post(`/api/v1/trips/${manifestTripId}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentId: studentA1.id, pickupTripStopId: pickupStopId });
      expect(readdRes.status).toBe(201);
      expect(readdRes.body.membershipStatus).toBe('PLANNED');
    });

    it('updates a manifest entry pickup stop', async () => {
      const token = await loginAs(adminA.email);
      const stops = await api().get(`/api/v1/trips/${manifestTripId}/stops`).set('Authorization', `Bearer ${token}`);
      const secondStopId = stops.body[1].id;
      const list = await api().get(`/api/v1/trips/${manifestTripId}/students`).set('Authorization', `Bearer ${token}`);
      const entryId = list.body.find((e: { studentId: string }) => e.studentId === studentA1.id).id;

      const res = await api()
        .patch(`/api/v1/trips/${manifestTripId}/students/${entryId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ pickupTripStopId: secondStopId });
      expect(res.status).toBe(200);
      expect(res.body.pickupTripStopId).toBe(secondStopId);
    });

    it('a driver (no trips.manage) cannot add a student to the manifest', async () => {
      const token = await loginAs(driverUserA.email);
      const res = await api()
        .post(`/api/v1/trips/${manifestTripId}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentId: studentA2.id, pickupTripStopId: pickupStopId });
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Cross-tenant IDOR
  // ---------------------------------------------------------------------
  describe('cross-tenant IDOR', () => {
    it("School A cannot create a trip using School B's route, bus, driver, or attendant", async () => {
      const token = await loginAs(adminA.email);
      const cases = [
        tripBody({ routeId: routeB.id, serviceDate: '2026-11-01' }),
        tripBody({ busId: busB.id, serviceDate: '2026-11-01' }),
        tripBody({ driverId: driverB.id, serviceDate: '2026-11-01' }),
        tripBody({ attendantId: attendantB.id, serviceDate: '2026-11-01' }),
      ];
      for (const body of cases) {
        const res = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(body);
        expect(res.status).toBe(404);
      }
    });

    it("School A cannot GET or PATCH School B's trip", async () => {
      const tokenB = await loginAs(adminB.email);
      const tripBRes = await api()
        .post('/api/v1/trips')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ routeId: routeB.id, busId: busB.id, driverId: driverB.id, serviceDate: '2026-11-02', scheduledStartTime: '07:00', scheduledEndTime: '08:00' });
      expect(tripBRes.status).toBe(201);

      const tokenA = await loginAs(adminA.email);
      const getRes = await api().get(`/api/v1/trips/${tripBRes.body.id}`).set('Authorization', `Bearer ${tokenA}`);
      expect(getRes.status).toBe(404);
      const patchRes = await api().patch(`/api/v1/trips/${tripBRes.body.id}`).set('Authorization', `Bearer ${tokenA}`).send({ notes: 'hijacked' });
      expect(patchRes.status).toBe(404);
      const stopsRes = await api().get(`/api/v1/trips/${tripBRes.body.id}/stops`).set('Authorization', `Bearer ${tokenA}`);
      expect(stopsRes.status).toBe(404);
    });

    it("School A cannot add School B's student to a School A trip", async () => {
      const token = await loginAs(adminA.email);
      const created = await api().post('/api/v1/trips').set('Authorization', `Bearer ${token}`).send(tripBody({ serviceDate: '2026-11-03' }));
      const stops = await api().get(`/api/v1/trips/${created.body.id}/stops`).set('Authorization', `Bearer ${token}`);
      const res = await api()
        .post(`/api/v1/trips/${created.body.id}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentId: studentB1.id, pickupTripStopId: stops.body[0].id });
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // Direct RLS verification (bypassing the API entirely)
  // ---------------------------------------------------------------------
  describe('RLS enforcement (direct, bypassing the API)', () => {
    it('a tenant-scoped query for School A never returns School B rows, for trips/trip_stops/trip_students', async () => {
      const tripB = await prisma.runInTenantContext(schoolB.id, (tx) => tx.trip.findFirst({ where: { schoolId: schoolB.id } }));
      expect(tripB).not.toBeNull();

      const [tripsFromA, stopsFromA, studentsFromA] = await Promise.all([
        prisma.runInTenantContext(schoolA.id, (tx) => tx.trip.findMany({ where: { id: tripB!.id } })),
        prisma.runInTenantContext(schoolA.id, (tx) => tx.tripStop.findMany({ where: { tripId: tripB!.id } })),
        prisma.runInTenantContext(schoolA.id, (tx) => tx.tripStudent.findMany({ where: { tripId: tripB!.id } })),
      ]);
      expect(tripsFromA).toEqual([]);
      expect(stopsFromA).toEqual([]);
      expect(studentsFromA).toEqual([]);
    });

    it('no tenant context set at all returns zero rows (FORCE ROW LEVEL SECURITY default-deny)', async () => {
      const tripCount = await prisma.trip.count();
      const stopCount = await prisma.tripStop.count();
      const studentCount = await prisma.tripStudent.count();
      expect(tripCount).toBe(0);
      expect(stopCount).toBe(0);
      expect(studentCount).toBe(0);
    });
  });
});
