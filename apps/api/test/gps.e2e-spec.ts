import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: resolve(__dirname, '../../../.env') });

import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/database/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';

jest.setTimeout(20000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('GPS telemetry + realtime bus tracking (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wsPort: number;
  const passwordService = new PasswordService();
  const suffix = Date.now();
  const STAFF_PASSWORD = 'CorrectHorse123';
  const PARENT_PASSWORD = 'ParentPassw0rd1';

  let schoolA: { id: string };
  let schoolB: { id: string };
  let adminA: { id: string; email: string };
  let managerA: { id: string; email: string };
  let driverUserA: { id: string; email: string };
  let parentA: { id: string; phone: string };
  let busA1: { id: string };
  let busA2: { id: string };
  let deviceA1: { id: string };
  let deviceA2: { id: string };
  let tripA1: { id: string };

  let adminB: { id: string; email: string };
  let busB1: { id: string };
  let deviceB1: { id: string };

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

  async function issueCredential(staffToken: string, deviceId: string): Promise<string> {
    const res = await api().post(`/api/v1/devices/${deviceId}/credential`).set('Authorization', `Bearer ${staffToken}`).send({});
    expect(res.status).toBe(200);
    return res.body.token as string;
  }

  function sendTelemetry(deviceToken: string, body: Record<string, unknown>) {
    return api().post('/api/v1/telemetry/gps').set('Authorization', `Bearer ${deviceToken}`).send(body);
  }

  function connectSocket(token?: string): Promise<ClientSocket> {
    return new Promise((resolvePromise, reject) => {
      const socket = ioClient(`http://localhost:${wsPort}/realtime/fleet`, {
        auth: token ? { token } : {},
        reconnection: false,
        timeout: 3000,
        transports: ['websocket'],
      });
      const timer = setTimeout(() => reject(new Error('connect timed out')), 4000);
      socket.on('connect', () => {
        clearTimeout(timer);
        resolvePromise(socket);
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /** For the "should be rejected" case: a NestJS gateway's handleConnection runs after the socket.io handshake already succeeded, so rejection shows up as an immediate server-initiated disconnect, not a connect_error. */
  function connectSocketExpectingRejection(token?: string): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const socket = ioClient(`http://localhost:${wsPort}/realtime/fleet`, {
        auth: token ? { token } : {},
        reconnection: false,
        timeout: 3000,
        transports: ['websocket'],
      });
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('expected rejection, but the socket stayed connected'));
      }, 4000);
      socket.on('disconnect', () => {
        clearTimeout(timer);
        resolvePromise();
      });
      socket.on('connect_error', () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
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
    await app.listen(0);
    const address = app.getHttpServer().address();
    wsPort = typeof address === 'object' && address ? address.port : 0;

    prisma = app.get(PrismaService);

    const staffHash = await passwordService.hash(STAFF_PASSWORD);
    const parentHash = await passwordService.hash(PARENT_PASSWORD);

    schoolA = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'GPS Test School A', slug: `gps-test-a-${suffix}`, contactEmail: `a-${suffix}@gps-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'GPS Test School B', slug: `gps-test-b-${suffix}`, contactEmail: `b-${suffix}@gps-test.example` } }),
    );

    adminA = await makeStaff(schoolA.id, `admin.a.${suffix}@gps-test.example`, 'SCHOOL_ADMIN', staffHash);
    managerA = await makeStaff(schoolA.id, `manager.a.${suffix}@gps-test.example`, 'TRANSPORT_MANAGER', staffHash);
    driverUserA = await makeStaff(schoolA.id, `driver.a.${suffix}@gps-test.example`, 'DRIVER', staffHash);
    parentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9180007${suffix.toString().slice(-5)}`, fullName: 'Parent A', passwordHash: parentHash } }),
    );

    const driverA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.driver.create({ data: { schoolId: schoolA.id, userId: driverUserA.id, licenseNumber: `GPS-LIC-A-${suffix}` } }),
    );
    const routeA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.route.create({ data: { schoolId: schoolA.id, name: `GPS Test Route A ${suffix}`, direction: 'HOME_TO_SCHOOL', shift: 'MORNING_PICKUP' } }),
    );
    busA1 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `GPS-A1-${suffix}`, capacity: 40 } }),
    );
    busA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `GPS-A2-${suffix}`, capacity: 40 } }),
    );
    deviceA1 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA1.id, deviceType: 'GPS_TRACKER', externalDeviceId: `GPS-DEV-A1-${suffix}` } }),
    );
    deviceA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA2.id, deviceType: 'GPS_TRACKER', externalDeviceId: `GPS-DEV-A2-${suffix}` } }),
    );

    tripA1 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.trip.create({
        data: {
          schoolId: schoolA.id,
          routeId: routeA.id,
          busId: busA1.id,
          driverId: driverA.id,
          serviceDate: new Date('2026-09-20'),
          shift: 'MORNING_PICKUP',
          scheduledStartTime: '07:00',
          scheduledEndTime: '08:00',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
        },
      }),
    );

    // School B — for cross-tenant IDOR/RLS tests
    adminB = await makeStaff(schoolB.id, `admin.b.${suffix}@gps-test.example`, 'SCHOOL_ADMIN', staffHash);
    busB1 = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolB.id, registrationNumber: `GPS-B1-${suffix}`, capacity: 35 } }),
    );
    deviceB1 = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolB.id, busId: busB1.id, deviceType: 'GPS_TRACKER', externalDeviceId: `GPS-DEV-B1-${suffix}` } }),
    );
  });

  afterAll(async () => {
    for (const schoolId of [schoolA.id, schoolB.id]) {
      await prisma.runInTenantContext(schoolId, async (tx) => {
        // Phase 1 Step 9: a location read can trigger a GPS_STALE/
        // GPS_OFFLINE alert (freshness state transition) — clean up before
        // the school itself can be deleted (FK), defensively even though
        // this suite's telemetry timestamps are always fresh.
        await tx.notificationDelivery.deleteMany({ where: { schoolId } });
        await tx.notification.deleteMany({ where: { schoolId } });
        await tx.gpsPoint.deleteMany({ where: { schoolId } });
        await tx.trip.deleteMany({ where: { schoolId } });
        await tx.route.deleteMany({ where: { schoolId } });
        await tx.busDevice.deleteMany({ where: { schoolId } });
        await tx.bus.deleteMany({ where: { schoolId } });
        await tx.driver.deleteMany({ where: { schoolId } });
        await tx.parent.deleteMany({ where: { schoolId } });
        await tx.auditLog.deleteMany({ where: { schoolId } });
        await tx.refreshToken.deleteMany({ where: { schoolId } });
        await tx.user.deleteMany({ where: { schoolId } });
        await tx.school.delete({ where: { id: schoolId } });
      });
    }
    await app.close();
  });

  // ---------------------------------------------------------------------
  // Device authentication
  // ---------------------------------------------------------------------
  describe('device authentication', () => {
    it('rejects ingestion with no credential at all', async () => {
      const res = await api().post('/api/v1/telemetry/gps').send({ latitude: 12.9, longitude: 77.6, recordedAt: new Date().toISOString() });
      expect(res.status).toBe(401);
    });

    it('rejects ingestion with an invalid/unknown credential', async () => {
      const res = await sendTelemetry('not-a-real-token', { latitude: 12.9, longitude: 77.6, recordedAt: new Date().toISOString() });
      expect(res.status).toBe(401);
    });

    it('rejects ingestion once a device credential has been rotated (old token stops working immediately)', async () => {
      const adminToken = await loginAs(adminA.email);
      const oldToken = await issueCredential(adminToken, deviceA1.id);
      const okRes = await sendTelemetry(oldToken, { latitude: 12.9, longitude: 77.6, recordedAt: new Date().toISOString() });
      expect(okRes.status).toBe(201);

      const newToken = await issueCredential(adminToken, deviceA1.id);
      const rejected = await sendTelemetry(oldToken, { latitude: 12.9, longitude: 77.6, recordedAt: new Date().toISOString() });
      expect(rejected.status).toBe(401);
      const stillOk = await sendTelemetry(newToken, { latitude: 12.9, longitude: 77.6, recordedAt: new Date().toISOString() });
      expect(stillOk.status).toBe(201);
    });

    it('rejects ingestion from a deactivated device', async () => {
      const adminToken = await loginAs(adminA.email);
      const throwaway = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA1.id, deviceType: 'GPS_TRACKER', externalDeviceId: `GPS-DEV-DEACT-${suffix}` } }),
      );
      const token = await issueCredential(adminToken, throwaway.id);
      await api().post(`/api/v1/devices/${throwaway.id}/deactivate`).set('Authorization', `Bearer ${adminToken}`).send({});

      const res = await sendTelemetry(token, { latitude: 12.9, longitude: 77.6, recordedAt: new Date().toISOString() });
      expect(res.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------
  // Ingestion + validation
  // ---------------------------------------------------------------------
  describe('ingestion and validation', () => {
    let deviceToken: string;

    beforeAll(async () => {
      const adminToken = await loginAs(adminA.email);
      deviceToken = await issueCredential(adminToken, deviceA2.id);
    });

    it('accepts a valid fix and derives busId/schoolId/tripId server-side (never from the payload)', async () => {
      const res = await sendTelemetry(deviceToken, {
        latitude: 12.9716,
        longitude: 77.5946,
        speedKmh: 25,
        heading: 90,
        accuracyM: 5,
        recordedAt: new Date().toISOString(),
        // Attempted spoofing — none of these exist in the schema, so zod strips them silently.
        busId: busB1.id,
        schoolId: schoolB.id,
        tripId: 'some-other-trip',
        deviceId: deviceA1.id,
      });
      expect(res.status).toBe(201);
      expect(res.body.deduplicated).toBe(false);

      const point = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.gpsPoint.findFirst({ where: { deviceId: deviceA2.id }, orderBy: { deviceTime: 'desc' } }),
      );
      expect(point?.busId).toBe(busA2.id);
      expect(point?.schoolId).toBe(schoolA.id);
    });

    it.each([
      ['latitude too high', { latitude: 91, longitude: 0, recordedAt: new Date().toISOString() }],
      ['latitude too low', { latitude: -91, longitude: 0, recordedAt: new Date().toISOString() }],
      ['longitude too high', { latitude: 0, longitude: 181, recordedAt: new Date().toISOString() }],
      ['longitude too low', { latitude: 0, longitude: -181, recordedAt: new Date().toISOString() }],
      ['negative speed', { latitude: 0, longitude: 0, speedKmh: -1, recordedAt: new Date().toISOString() }],
      ['invalid heading', { latitude: 0, longitude: 0, heading: 361, recordedAt: new Date().toISOString() }],
      ['malformed timestamp', { latitude: 0, longitude: 0, recordedAt: 'not-a-date' }],
      ['missing recordedAt', { latitude: 0, longitude: 0 }],
    ])('rejects: %s', async (_label, body) => {
      const res = await sendTelemetry(deviceToken, body);
      expect(res.status).toBe(400);
    });

    it('rejects a clearly-future timestamp', async () => {
      const future = new Date(Date.now() + 1000 * 60 * 60).toISOString(); // +1h, well beyond the default 120s skew allowance
      const res = await sendTelemetry(deviceToken, { latitude: 0, longitude: 0, recordedAt: future });
      expect(res.status).toBe(400);
    });

    it('rejects an obviously-impossible past timestamp', async () => {
      const ancient = new Date('2000-01-01').toISOString();
      const res = await sendTelemetry(deviceToken, { latitude: 0, longitude: 0, recordedAt: ancient });
      expect(res.status).toBe(400);
    });

    it('deduplicates a retried packet (same device + same recordedAt) instead of creating a duplicate row', async () => {
      const recordedAt = new Date().toISOString();
      const first = await sendTelemetry(deviceToken, { latitude: 10, longitude: 10, recordedAt });
      expect(first.status).toBe(201);
      expect(first.body.deduplicated).toBe(false);

      const retry = await sendTelemetry(deviceToken, { latitude: 10, longitude: 10, recordedAt });
      expect(retry.status).toBe(201);
      expect(retry.body.deduplicated).toBe(true);

      const count = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.gpsPoint.count({ where: { deviceId: deviceA2.id, deviceTime: new Date(recordedAt) } }),
      );
      expect(count).toBe(1);
    });

    it('never lets an older fix overwrite the current location (monotonic timestamp rule)', async () => {
      const adminToken = await loginAs(adminA.email);
      const newer = new Date();
      const older = new Date(newer.getTime() - 60_000);

      await sendTelemetry(deviceToken, { latitude: 20, longitude: 20, recordedAt: newer.toISOString() });
      const afterNewer = await api().get(`/api/v1/buses/${busA2.id}/location`).set('Authorization', `Bearer ${adminToken}`);
      expect(afterNewer.body.latitude).toBe(20);

      await sendTelemetry(deviceToken, { latitude: 30, longitude: 30, recordedAt: older.toISOString() });
      const afterOlder = await api().get(`/api/v1/buses/${busA2.id}/location`).set('Authorization', `Bearer ${adminToken}`);
      // Still the newer fix — the older one was persisted to history but never became "current".
      expect(afterOlder.body.latitude).toBe(20);

      const historyCount = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.gpsPoint.count({ where: { deviceId: deviceA2.id, latitude: 30 } }),
      );
      expect(historyCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // Staff-facing REST reads: RBAC, own-bus scoping, cross-tenant IDOR
  // ---------------------------------------------------------------------
  describe('staff reads: RBAC, scoping, IDOR', () => {
    it('an unscoped staff role (SCHOOL_ADMIN) can read any bus in their school', async () => {
      const token = await loginAs(adminA.email);
      const res1 = await api().get(`/api/v1/buses/${busA1.id}/location`).set('Authorization', `Bearer ${token}`);
      const res2 = await api().get(`/api/v1/buses/${busA2.id}/location`).set('Authorization', `Bearer ${token}`);
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });

    it("a driver is scoped to only their own currently in-progress trip's bus", async () => {
      const token = await loginAs(driverUserA.email);
      const own = await api().get(`/api/v1/buses/${busA1.id}/location`).set('Authorization', `Bearer ${token}`);
      expect(own.status).toBe(200);

      const other = await api().get(`/api/v1/buses/${busA2.id}/location`).set('Authorization', `Bearer ${token}`);
      expect(other.status).toBe(403);
    });

    it('the fleet endpoint returns every bus for unscoped staff, and only the driver\'s own bus for a driver', async () => {
      const adminToken = await loginAs(adminA.email);
      const fleetForAdmin = await api().get('/api/v1/gps/fleet').set('Authorization', `Bearer ${adminToken}`);
      expect(fleetForAdmin.status).toBe(200);
      const busIds = fleetForAdmin.body.map((b: { busId: string }) => b.busId);
      expect(busIds).toEqual(expect.arrayContaining([busA1.id, busA2.id]));

      const driverToken = await loginAs(driverUserA.email);
      const fleetForDriver = await api().get('/api/v1/gps/fleet').set('Authorization', `Bearer ${driverToken}`);
      expect(fleetForDriver.status).toBe(200);
      expect(fleetForDriver.body).toHaveLength(1);
      expect(fleetForDriver.body[0].busId).toBe(busA1.id);
    });

    it('a parent has no access to any GPS endpoint', async () => {
      const token = await loginParentAs(parentA.phone);
      const location = await api().get(`/api/v1/buses/${busA1.id}/location`).set('Authorization', `Bearer ${token}`);
      const telemetry = await api().get(`/api/v1/buses/${busA1.id}/telemetry`).set('Authorization', `Bearer ${token}`);
      const tripTelemetry = await api().get(`/api/v1/trips/${tripA1.id}/telemetry`).set('Authorization', `Bearer ${token}`);
      const fleet = await api().get('/api/v1/gps/fleet').set('Authorization', `Bearer ${token}`);
      expect(location.status).toBe(403);
      expect(telemetry.status).toBe(403);
      expect(tripTelemetry.status).toBe(403);
      expect(fleet.status).toBe(403);
    });

    it("School A staff cannot read School B's bus location or telemetry (cross-tenant IDOR)", async () => {
      const token = await loginAs(managerA.email);
      const location = await api().get(`/api/v1/buses/${busB1.id}/location`).set('Authorization', `Bearer ${token}`);
      const telemetry = await api().get(`/api/v1/buses/${busB1.id}/telemetry`).set('Authorization', `Bearer ${token}`);
      expect(location.status).toBe(404);
      expect(telemetry.status).toBe(404);
    });

    it('bounded history: the trip telemetry endpoint returns points for the derived trip, respecting the limit', async () => {
      const adminToken = await loginAs(adminA.email);
      const deviceToken = await issueCredential(adminToken, deviceA1.id);
      await sendTelemetry(deviceToken, { latitude: 1, longitude: 1, recordedAt: new Date().toISOString() });

      const res = await api().get(`/api/v1/trips/${tripA1.id}/telemetry?limit=1`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeLessThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------
  // Direct RLS verification (bypassing the API entirely)
  // ---------------------------------------------------------------------
  describe('RLS enforcement (direct, bypassing the API)', () => {
    it('a tenant-scoped query for School A never returns School B GPS points', async () => {
      const pointB = await prisma.runInTenantContext(schoolB.id, (tx) =>
        tx.gpsPoint.create({
          data: { schoolId: schoolB.id, busId: busB1.id, deviceId: deviceB1.id, latitude: 5, longitude: 5, deviceTime: new Date() },
        }),
      );
      const fromA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.gpsPoint.findMany({ where: { id: pointB.id } }));
      expect(fromA).toEqual([]);
    });

    it('no tenant context set at all returns zero rows (FORCE ROW LEVEL SECURITY default-deny)', async () => {
      const count = await prisma.gpsPoint.count();
      expect(count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // Realtime WebSocket gateway
  // ---------------------------------------------------------------------
  describe('realtime WebSocket gateway', () => {
    it('rejects a connection with no token at all', async () => {
      await connectSocketExpectingRejection();
    });

    it('rejects a connection with a parent token (no fleet-tracking access this phase)', async () => {
      const token = await loginParentAs(parentA.phone);
      await connectSocketExpectingRejection(token);
    });

    it('an authorized staff member receives a realtime event when a fix is ingested for their school', async () => {
      const staffToken = await loginAs(adminA.email);
      const socket = await connectSocket(staffToken);
      const received: Array<{ busId: string }> = [];
      socket.on('bus.location.updated', (event) => received.push(event));
      await sleep(300);

      const deviceToken = await issueCredential(staffToken, deviceA1.id);
      await sendTelemetry(deviceToken, { latitude: 15, longitude: 15, recordedAt: new Date().toISOString() });
      await sleep(400);

      expect(received.some((e) => e.busId === busA1.id)).toBe(true);
      socket.close();
    });

    it("School B's socket never receives School A's location events (tenant isolation)", async () => {
      const tokenA = await loginAs(adminA.email);
      const tokenB = await loginAs(adminB.email);
      const socketA = await connectSocket(tokenA);
      const socketB = await connectSocket(tokenB);
      const receivedB: unknown[] = [];
      socketB.on('bus.location.updated', (event) => receivedB.push(event));
      await sleep(300);

      const deviceToken = await issueCredential(tokenA, deviceA1.id);
      await sendTelemetry(deviceToken, { latitude: 16, longitude: 16, recordedAt: new Date().toISOString() });
      await sleep(400);

      expect(receivedB).toHaveLength(0);
      socketA.close();
      socketB.close();
    });

    it("a driver's socket only receives events for their own currently assigned bus, not another bus in the same school", async () => {
      const driverToken = await loginAs(driverUserA.email);
      const adminToken = await loginAs(adminA.email);
      const socket = await connectSocket(driverToken);
      const received: Array<{ busId: string }> = [];
      socket.on('bus.location.updated', (event) => received.push(event));
      await sleep(300);

      const ownDeviceToken = await issueCredential(adminToken, deviceA1.id);
      await sendTelemetry(ownDeviceToken, { latitude: 17, longitude: 17, recordedAt: new Date().toISOString() });
      await sleep(400);
      expect(received.some((e) => e.busId === busA1.id)).toBe(true);

      received.length = 0;
      const otherDeviceToken = await issueCredential(adminToken, deviceA2.id);
      await sendTelemetry(otherDeviceToken, { latitude: 18, longitude: 18, recordedAt: new Date().toISOString() });
      await sleep(400);
      expect(received.some((e) => e.busId === busA2.id)).toBe(false);

      socket.close();
    });
  });
});
