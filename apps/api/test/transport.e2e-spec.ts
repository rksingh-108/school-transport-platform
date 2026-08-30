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

describe('Transport fleet foundation: buses/drivers/attendants/devices (e2e)', () => {
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
  let driverPrincipalA: { id: string; email: string }; // DRIVER role, no fleet permissions — for 403 tests
  let adminB: { id: string; email: string };
  let plainStaffA: { id: string }; // a staff user with no driver/attendant profile yet, used as create() target
  let plainStaffA2: { id: string };
  let plainStaffB: { id: string };
  let parentA: { id: string; phone: string };
  let busA: { id: string };
  let busB: { id: string };

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
      tx.school.create({ data: { name: 'Transport Test School A', slug: `transport-test-a-${suffix}`, contactEmail: `a-${suffix}@transport-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Transport Test School B', slug: `transport-test-b-${suffix}`, contactEmail: `b-${suffix}@transport-test.example` } }),
    );

    const schoolAdminRole = await prisma.runAsPlatformAdmin((tx) => tx.role.findFirstOrThrow({ where: { key: 'SCHOOL_ADMIN', schoolId: null } }));
    const driverRole = await prisma.runAsPlatformAdmin((tx) => tx.role.findFirstOrThrow({ where: { key: 'DRIVER', schoolId: null } }));

    adminA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({ data: { schoolId: schoolA.id, email: `admin.a.${suffix}@transport-test.example`, fullName: 'Admin A', passwordHash: staffHash } }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) => tx.userRole.create({ data: { userId: adminA.id, roleId: schoolAdminRole.id } }));

    driverPrincipalA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({ data: { schoolId: schoolA.id, email: `driver.principal.a.${suffix}@transport-test.example`, fullName: 'Driver Principal A', passwordHash: staffHash } }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) => tx.userRole.create({ data: { userId: driverPrincipalA.id, roleId: driverRole.id } }));

    adminB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.user.create({ data: { schoolId: schoolB.id, email: `admin.b.${suffix}@transport-test.example`, fullName: 'Admin B', passwordHash: staffHash } }),
    );
    await prisma.runInTenantContext(schoolB.id, (tx) => tx.userRole.create({ data: { userId: adminB.id, roleId: schoolAdminRole.id } }));

    plainStaffA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({ data: { schoolId: schoolA.id, email: `staff.a.${suffix}@transport-test.example`, fullName: 'Plain Staff A', passwordHash: staffHash } }),
    );
    plainStaffA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({ data: { schoolId: schoolA.id, email: `staff.a2.${suffix}@transport-test.example`, fullName: 'Plain Staff A2', passwordHash: staffHash } }),
    );
    plainStaffB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.user.create({ data: { schoolId: schoolB.id, email: `staff.b.${suffix}@transport-test.example`, fullName: 'Plain Staff B', passwordHash: staffHash } }),
    );

    parentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9180009${suffix.toString().slice(-5)}`, fullName: 'Parent A', passwordHash: parentHash } }),
    );

    busA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `TT-A-${suffix}`, capacity: 40 } }),
    );
    busB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolB.id, registrationNumber: `TT-B-${suffix}`, capacity: 30 } }),
    );
  });

  afterAll(async () => {
    for (const schoolId of [schoolA.id, schoolB.id]) {
      await prisma.runInTenantContext(schoolId, async (tx) => {
        await tx.gpsPoint.deleteMany({ where: { schoolId } });
        await tx.busDevice.deleteMany({ where: { schoolId } });
        await tx.trip.deleteMany({ where: { schoolId } });
        await tx.bus.deleteMany({ where: { schoolId } });
        await tx.driver.deleteMany({ where: { schoolId } });
        await tx.attendant.deleteMany({ where: { schoolId } });
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
  // Buses
  // ---------------------------------------------------------------------
  describe('buses', () => {
    let createdBusId: string;

    it('an authorized admin can create a bus', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/buses')
        .set('Authorization', `Bearer ${token}`)
        .send({ registrationNumber: `NEW-BUS-${suffix}`, capacity: 45, fleetNumber: 'X-01', make: 'Tata' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body).not.toHaveProperty('schoolId');
      createdBusId = res.body.id;
    });

    it('a client-supplied schoolId on the create body has no effect (DTO structurally excludes it)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/buses')
        .set('Authorization', `Bearer ${token}`)
        .send({ registrationNumber: `ESCAPE-${suffix}`, capacity: 20, schoolId: schoolB.id });
      expect(res.status).toBe(201);
      // It landed in the caller's own tenant (A), not School B — confirmed by
      // fetching it back as adminA (School A) rather than as adminB.
      const getRes = await api().get(`/api/v1/buses/${res.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);
    });

    it('rejects invalid data (capacity < 1, missing registrationNumber)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post('/api/v1/buses').set('Authorization', `Bearer ${token}`).send({ capacity: 0 });
      expect(res.status).toBe(400);
    });

    it('an authorized admin can read, update, and archive a bus', async () => {
      const token = await loginAs(adminA.email);

      const patchRes = await api()
        .patch(`/api/v1/buses/${createdBusId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ capacity: 50 });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.capacity).toBe(50);

      const statusRes = await api()
        .patch(`/api/v1/buses/${createdBusId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'MAINTENANCE' });
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe('MAINTENANCE');

      const archiveRes = await api().post(`/api/v1/buses/${createdBusId}/archive`).set('Authorization', `Bearer ${token}`);
      expect(archiveRes.status).toBe(200);
      expect(archiveRes.body.status).toBe('RETIRED');

      const archiveAgainRes = await api().post(`/api/v1/buses/${createdBusId}/archive`).set('Authorization', `Bearer ${token}`);
      expect(archiveAgainRes.status).toBe(400);
    });

    it('PATCH cannot set status directly to RETIRED — must go through the archive endpoint', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().patch(`/api/v1/buses/${busA.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'RETIRED' });
      expect(res.status).toBe(400);
    });

    it('a staff member without buses.read cannot list or read buses (driver role)', async () => {
      const token = await loginAs(driverPrincipalA.email);
      const listRes = await api().get('/api/v1/buses').set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(403);
      const getRes = await api().get(`/api/v1/buses/${busA.id}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(403);
    });

    it('a parent cannot access bus management endpoints at all', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get('/api/v1/buses').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it("cross-tenant: School A admin cannot GET or PATCH School B's bus (404, not 403)", async () => {
      const token = await loginAs(adminA.email);
      const getRes = await api().get(`/api/v1/buses/${busB.id}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(404);
      const patchRes = await api().patch(`/api/v1/buses/${busB.id}`).set('Authorization', `Bearer ${token}`).send({ capacity: 10 });
      expect(patchRes.status).toBe(404);
      const archiveRes = await api().post(`/api/v1/buses/${busB.id}/archive`).set('Authorization', `Bearer ${token}`);
      expect(archiveRes.status).toBe(404);
    });

    it('pagination: list respects limit and returns a usable nextCursor', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().get('/api/v1/buses?limit=1').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(typeof res.body.nextCursor === 'string' || res.body.nextCursor === null).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Drivers
  // ---------------------------------------------------------------------
  describe('drivers', () => {
    let driverProfileId: string;

    it('an authorized admin can attach a driver profile to an existing staff user', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/drivers')
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: plainStaffA.id, licenseNumber: `LIC-${suffix}` });
      expect(res.status).toBe(201);
      expect(res.body.fullName).toBe('Plain Staff A');
      expect(res.body.status).toBe('ACTIVE');
      driverProfileId = res.body.id;
    });

    it('cannot attach a second driver profile to the same user', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/drivers')
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: plainStaffA.id, licenseNumber: `LIC-DUP-${suffix}` });
      expect(res.status).toBe(400);
    });

    it('cannot attach a driver profile to a user from another school (404, not a cross-tenant write)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/drivers')
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: plainStaffB.id, licenseNumber: `LIC-CROSS-${suffix}` });
      expect(res.status).toBe(404);
    });

    it('an authorized admin can read and update the driver profile', async () => {
      const token = await loginAs(adminA.email);
      const getRes = await api().get(`/api/v1/drivers/${driverProfileId}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);

      const patchRes = await api()
        .patch(`/api/v1/drivers/${driverProfileId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ licenseExpiry: '2030-01-01' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.licenseExpiry).toBe('2030-01-01');
    });

    it('deactivate then activate works', async () => {
      const token = await loginAs(adminA.email);
      const deactivateRes = await api().post(`/api/v1/drivers/${driverProfileId}/deactivate`).set('Authorization', `Bearer ${token}`);
      expect(deactivateRes.status).toBe(200);
      expect(deactivateRes.body.status).toBe('INACTIVE');

      const activateRes = await api().post(`/api/v1/drivers/${driverProfileId}/activate`).set('Authorization', `Bearer ${token}`);
      expect(activateRes.status).toBe(200);
      expect(activateRes.body.status).toBe('ACTIVE');
    });

    it('a staff member without drivers.manage cannot create a driver profile', async () => {
      const token = await loginAs(driverPrincipalA.email);
      const res = await api()
        .post('/api/v1/drivers')
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: plainStaffA2.id, licenseNumber: `LIC-DENIED-${suffix}` });
      expect(res.status).toBe(403);
    });

    it("cross-tenant: School A admin cannot GET School B's driver", async () => {
      const token = await loginAs(adminA.email);
      const driverB = await prisma.runInTenantContext(schoolB.id, (tx) =>
        tx.driver.create({ data: { schoolId: schoolB.id, userId: plainStaffB.id, licenseNumber: `LIC-B-${suffix}` } }),
      );
      const res = await api().get(`/api/v1/drivers/${driverB.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('a parent cannot access driver management endpoints', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get('/api/v1/drivers').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Attendants
  // ---------------------------------------------------------------------
  describe('attendants', () => {
    let attendantProfileId: string;

    it('an authorized admin can attach an attendant profile to an existing staff user', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post('/api/v1/attendants').set('Authorization', `Bearer ${token}`).send({ userId: plainStaffA2.id });
      expect(res.status).toBe(201);
      expect(res.body.fullName).toBe('Plain Staff A2');
      attendantProfileId = res.body.id;
    });

    it('cannot attach a second attendant profile to the same user', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post('/api/v1/attendants').set('Authorization', `Bearer ${token}`).send({ userId: plainStaffA2.id });
      expect(res.status).toBe(400);
    });

    it('deactivate then activate works', async () => {
      const token = await loginAs(adminA.email);
      const deactivateRes = await api().post(`/api/v1/attendants/${attendantProfileId}/deactivate`).set('Authorization', `Bearer ${token}`);
      expect(deactivateRes.status).toBe(200);
      expect(deactivateRes.body.status).toBe('INACTIVE');
      const activateRes = await api().post(`/api/v1/attendants/${attendantProfileId}/activate`).set('Authorization', `Bearer ${token}`);
      expect(activateRes.status).toBe(200);
      expect(activateRes.body.status).toBe('ACTIVE');
    });

    it('a staff member without attendants.manage cannot create an attendant profile', async () => {
      const token = await loginAs(driverPrincipalA.email);
      const res = await api().post('/api/v1/attendants').set('Authorization', `Bearer ${token}`).send({ userId: plainStaffA.id });
      expect(res.status).toBe(403);
    });

    it("cross-tenant: School A admin cannot GET School B's attendant", async () => {
      const token = await loginAs(adminA.email);
      const attendantB = await prisma.runInTenantContext(schoolB.id, (tx) =>
        tx.attendant.create({ data: { schoolId: schoolB.id, userId: plainStaffB.id } }),
      );
      const res = await api().get(`/api/v1/attendants/${attendantB.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('a parent cannot access attendant management endpoints', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get('/api/v1/attendants').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Bus devices
  // ---------------------------------------------------------------------
  describe('bus devices', () => {
    let deviceId: string;

    it('an authorized admin can register a device under their own bus', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post(`/api/v1/buses/${busA.id}/devices`)
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceType: 'GPS_TRACKER', externalDeviceId: `DEV-${suffix}`, firmwareVersion: '2.0.0' });
      expect(res.status).toBe(201);
      expect(res.body.busId).toBe(busA.id);
      expect(res.body.status).toBe('ACTIVE');
      // No secret/credential field is ever present — there is no such field on the model at all.
      expect(res.body).not.toHaveProperty('secret');
      expect(res.body).not.toHaveProperty('credential');
      expect(res.body).not.toHaveProperty('apiKey');
      deviceId = res.body.id;
    });

    it('cannot register a device under a bus from another school (404)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post(`/api/v1/buses/${busB.id}/devices`)
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceType: 'GPS_TRACKER', externalDeviceId: `DEV-CROSS-${suffix}` });
      expect(res.status).toBe(404);
    });

    it('an authorized admin can list devices for their bus, read, and update a device', async () => {
      const token = await loginAs(adminA.email);
      const listRes = await api().get(`/api/v1/buses/${busA.id}/devices`).set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);
      expect(listRes.body.some((d: { id: string }) => d.id === deviceId)).toBe(true);

      const patchRes = await api()
        .patch(`/api/v1/devices/${deviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firmwareVersion: '2.1.0', metadata: { reportingIntervalSeconds: 30 } });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.firmwareVersion).toBe('2.1.0');
    });

    it('PATCH cannot set status directly to INACTIVE — must go through the deactivate endpoint', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().patch(`/api/v1/devices/${deviceId}`).set('Authorization', `Bearer ${token}`).send({ status: 'INACTIVE' });
      expect(res.status).toBe(400);
    });

    it('deactivate works', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post(`/api/v1/devices/${deviceId}/deactivate`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('INACTIVE');
    });

    it('a staff member without buses.manage cannot register a device', async () => {
      const token = await loginAs(driverPrincipalA.email);
      const res = await api()
        .post(`/api/v1/buses/${busA.id}/devices`)
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceType: 'GPS_TRACKER', externalDeviceId: `DEV-DENIED-${suffix}` });
      expect(res.status).toBe(403);
    });

    it("cross-tenant: School A admin cannot list School B's bus devices, or GET/PATCH a School B device directly", async () => {
      const token = await loginAs(adminA.email);
      const deviceB = await prisma.runInTenantContext(schoolB.id, (tx) =>
        tx.busDevice.create({ data: { schoolId: schoolB.id, busId: busB.id, deviceType: 'GPS_TRACKER', externalDeviceId: `DEV-B-${suffix}` } }),
      );

      const listRes = await api().get(`/api/v1/buses/${busB.id}/devices`).set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(404);

      const getRes = await api().get(`/api/v1/devices/${deviceB.id}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(404);

      const patchRes = await api().patch(`/api/v1/devices/${deviceB.id}`).set('Authorization', `Bearer ${token}`).send({ firmwareVersion: '9.9.9' });
      expect(patchRes.status).toBe(404);
    });

    it('a parent cannot access device management endpoints', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get(`/api/v1/buses/${busA.id}/devices`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Direct RLS verification (bypassing the API entirely)
  // ---------------------------------------------------------------------
  describe('RLS enforcement (direct, bypassing the API)', () => {
    it('a tenant-scoped query for School A never returns School B rows, for buses/drivers/attendants/bus_devices', async () => {
      const driverB = await prisma.runInTenantContext(schoolB.id, (tx) => tx.driver.findFirst({ where: { schoolId: schoolB.id } }));
      const attendantB = await prisma.runInTenantContext(schoolB.id, (tx) => tx.attendant.findFirst({ where: { schoolId: schoolB.id } }));
      const deviceB = await prisma.runInTenantContext(schoolB.id, (tx) => tx.busDevice.findFirst({ where: { schoolId: schoolB.id } }));

      const [busesFromA, driversFromA, attendantsFromA, devicesFromA] = await Promise.all([
        prisma.runInTenantContext(schoolA.id, (tx) => tx.bus.findMany({ where: { id: { in: [busA.id, busB.id] } } })),
        prisma.runInTenantContext(schoolA.id, (tx) => tx.driver.findMany({ where: { id: driverB ? { in: [driverB.id] } : undefined } })),
        prisma.runInTenantContext(schoolA.id, (tx) => tx.attendant.findMany({ where: { id: attendantB ? { in: [attendantB.id] } : undefined } })),
        prisma.runInTenantContext(schoolA.id, (tx) => tx.busDevice.findMany({ where: { id: deviceB ? { in: [deviceB.id] } : undefined } })),
      ]);

      expect(busesFromA.map((b) => b.id)).toEqual([busA.id]);
      expect(driversFromA).toEqual([]);
      expect(attendantsFromA).toEqual([]);
      expect(devicesFromA).toEqual([]);
    });

    it('no tenant context set at all returns zero rows (FORCE ROW LEVEL SECURITY default-deny)', async () => {
      // Calling the underlying PrismaClient directly, bypassing
      // runInTenantContext/runAsPlatformAdmin entirely — no
      // app.current_school_id session variable is ever set for this query,
      // so FORCE ROW LEVEL SECURITY must reject every row by default.
      const busCount = await prisma.bus.count({ where: { id: { in: [busA.id, busB.id] } } });
      const driverCount = await prisma.driver.count();
      expect(busCount).toBe(0);
      expect(driverCount).toBe(0);
    });
  });
});
