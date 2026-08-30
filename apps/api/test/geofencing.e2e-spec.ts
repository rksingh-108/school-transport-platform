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
import { RedisService } from '../src/redis/redis.service';
import { PasswordService } from '../src/auth/services/password.service';

jest.setTimeout(20000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A single, ever-increasing simulated device clock shared across every GPS
// point sent anywhere in this file. Several tests share the same bus (and
// therefore the same Redis "current location" key, which only ever accepts
// a strictly-later deviceTime — see GpsService.maybeAdvanceCurrentLocation).
// Using per-test `Date.now() - N` offsets would risk one test's first point
// landing earlier than a previous test's last point purely due to real
// wall-clock test execution speed, silently skipping rule evaluation for
// that point. This counter guarantees monotonic ordering regardless of how
// fast or slow the surrounding test code actually runs.
let simulatedClockMs = Date.now();
function nextRecordedAt(): string {
  simulatedClockMs += 1000;
  return new Date(simulatedClockMs).toISOString();
}

/**
 * Phase 2 Step 13: geofences, safety rules, and the deterministic
 * GPS-derived rule-evaluation pipeline. See
 * docs/adr/0020-geofencing-and-operational-safety-rules.md.
 */
describe('Geofencing + operational safety rules (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let wsPort: number;
  const passwordService = new PasswordService();
  const suffix = Date.now();
  const STAFF_PASSWORD = 'CorrectHorse123';
  const PARENT_PASSWORD = 'ParentPassw0rd1';

  let schoolA: { id: string };
  let schoolB: { id: string };
  let adminA: { id: string; email: string };
  let managerA: { id: string; email: string }; // TRANSPORT_MANAGER — read-only geofence/rule access
  let driverA: { id: string; email: string };
  let adminB: { id: string; email: string };
  let parentA: { id: string; phone: string };
  let busA: { id: string };
  let busB: { id: string };
  let routeA: { id: string };
  let tripA: { id: string };
  let deviceCredentialA: string;

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

  function sendGps(body: Record<string, unknown>) {
    return api().post('/api/v1/telemetry/gps').set('Authorization', `Bearer ${deviceCredentialA}`).send(body);
  }

  function connectSafetySocket(token: string): Promise<ClientSocket> {
    return new Promise((resolvePromise, reject) => {
      const socket = ioClient(`http://localhost:${wsPort}/realtime/safety`, {
        auth: { token },
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
    redis = app.get(RedisService);

    const staffHash = await passwordService.hash(STAFF_PASSWORD);
    const parentHash = await passwordService.hash(PARENT_PASSWORD);

    schoolA = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Geofence Test School A', slug: `geo-test-a-${suffix}`, contactEmail: `a-${suffix}@geo-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Geofence Test School B', slug: `geo-test-b-${suffix}`, contactEmail: `b-${suffix}@geo-test.example` } }),
    );

    adminA = await makeStaff(schoolA.id, `admin.a.${suffix}@geo-test.example`, 'SCHOOL_ADMIN', staffHash);
    managerA = await makeStaff(schoolA.id, `manager.a.${suffix}@geo-test.example`, 'TRANSPORT_MANAGER', staffHash);
    driverA = await makeStaff(schoolA.id, `driver.a.${suffix}@geo-test.example`, 'DRIVER', staffHash);
    adminB = await makeStaff(schoolB.id, `admin.b.${suffix}@geo-test.example`, 'SCHOOL_ADMIN', staffHash);

    parentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9183009${suffix.toString().slice(-5)}`, fullName: 'Parent A', passwordHash: parentHash } }),
    );

    const driverProfileA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.driver.create({ data: { schoolId: schoolA.id, userId: driverA.id, licenseNumber: `LIC-GEO-A-${suffix}` } }),
    );
    routeA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.route.create({ data: { schoolId: schoolA.id, code: `R-GEO-${suffix}`, name: 'Geofence Test Route', direction: 'HOME_TO_SCHOOL', shift: 'MORNING_PICKUP' } }),
    );
    busA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `GEO-A-${suffix}`, capacity: 40 } }));
    busB = await prisma.runInTenantContext(schoolB.id, (tx) => tx.bus.create({ data: { schoolId: schoolB.id, registrationNumber: `GEO-B-${suffix}`, capacity: 30 } }));

    tripA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.trip.create({
        data: {
          schoolId: schoolA.id,
          routeId: routeA.id,
          busId: busA.id,
          driverId: driverProfileA.id,
          serviceDate: new Date(),
          shift: 'MORNING_PICKUP',
          scheduledStartTime: '07:00',
          scheduledEndTime: '08:00',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
        },
      }),
    );
    // A trip stop far from the geofence/deviation test coordinates below, so
    // ROUTE_DEVIATION has a real (if trivial) corridor to measure against.
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.tripStop.create({
        data: {
          schoolId: schoolA.id,
          tripId: tripA.id,
          sequenceNo: 1,
          name: 'Only Stop',
          latitude: 12.9716,
          longitude: 77.5946,
          expectedOffsetMinutes: 0,
          mode: 'PICKUP',
        },
      }),
    );

    const deviceA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA.id, deviceType: 'GPS_TRACKER', externalDeviceId: `GEO-DEV-A-${suffix}` } }),
    );
    const token = await loginAs(adminA.email);
    const credRes = await api().post(`/api/v1/devices/${deviceA.id}/credential`).set('Authorization', `Bearer ${token}`).send();
    deviceCredentialA = credRes.body.token;
  });

  afterAll(async () => {
    for (const schoolId of [schoolA.id, schoolB.id]) {
      await prisma.runInTenantContext(schoolId, async (tx) => {
        await tx.safetyRule.deleteMany({ where: { schoolId } });
        await tx.geofence.deleteMany({ where: { schoolId } });
        await tx.safetyEvent.deleteMany({ where: { schoolId } });
        await tx.notificationDelivery.deleteMany({ where: { schoolId } });
        await tx.notification.deleteMany({ where: { schoolId } });
        await tx.gpsPoint.deleteMany({ where: { schoolId } });
        await tx.tripStop.deleteMany({ where: { schoolId } });
        await tx.trip.deleteMany({ where: { schoolId } });
        await tx.route.deleteMany({ where: { schoolId } });
        await tx.busDevice.deleteMany({ where: { schoolId } });
        await tx.bus.deleteMany({ where: { schoolId } });
        await tx.driver.deleteMany({ where: { schoolId } });
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
  // Geofence CRUD + lifecycle
  // ---------------------------------------------------------------------
  describe('Geofence CRUD + lifecycle', () => {
    let geofenceId: string;

    it('an authorized admin can create a geofence', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/geofences')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Depot', type: 'DEPOT', latitude: 12.9, longitude: 77.5, radiusMeters: 200 });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ACTIVE');
      geofenceId = res.body.id;
    });

    it('rejects an out-of-bounds radius', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/geofences')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Too big', type: 'CUSTOM', latitude: 12.9, longitude: 77.5, radiusMeters: 999_999 });
      expect(res.status).toBe(400);
    });

    it('can read, list, and update a geofence', async () => {
      const token = await loginAs(adminA.email);
      const getRes = await api().get(`/api/v1/geofences/${geofenceId}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);

      const patchRes = await api().patch(`/api/v1/geofences/${geofenceId}`).set('Authorization', `Bearer ${token}`).send({ radiusMeters: 250 });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.radiusMeters).toBe(250);

      const listRes = await api().get('/api/v1/geofences').set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.some((g: { id: string }) => g.id === geofenceId)).toBe(true);
    });

    it('TRANSPORT_MANAGER can read but not create/update/archive geofences', async () => {
      const token = await loginAs(managerA.email);
      const listRes = await api().get('/api/v1/geofences').set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      const createRes = await api().post('/api/v1/geofences').set('Authorization', `Bearer ${token}`).send({ name: 'x', type: 'CUSTOM', latitude: 1, longitude: 1, radiusMeters: 50 });
      expect(createRes.status).toBe(403);
    });

    it('DRIVER has no geofence access at all (403)', async () => {
      const token = await loginAs(driverA.email);
      const res = await api().get('/api/v1/geofences').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('a parent has zero geofence access', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get('/api/v1/geofences').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('archive is terminal and disables any rule watching it', async () => {
      const token = await loginAs(adminA.email);
      const ruleRes = await api()
        .post('/api/v1/safety-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'GEOFENCE', severity: 'LOW', geofenceId, minConsecutivePoints: 2, cooldownSeconds: 30 });
      expect(ruleRes.status).toBe(201);
      expect(ruleRes.body.enabled).toBe(true);

      const archiveRes = await api().post(`/api/v1/geofences/${geofenceId}/archive`).set('Authorization', `Bearer ${token}`);
      expect(archiveRes.status).toBe(200);
      expect(archiveRes.body.status).toBe('ARCHIVED');

      const ruleAfter = await api().get(`/api/v1/safety-rules/${ruleRes.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(ruleAfter.body.enabled).toBe(false);

      const archiveAgain = await api().post(`/api/v1/geofences/${geofenceId}/archive`).set('Authorization', `Bearer ${token}`);
      expect(archiveAgain.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // SafetyRule CRUD + validation
  // ---------------------------------------------------------------------
  describe('SafetyRule CRUD + validation', () => {
    it('rejects a GEOFENCE rule with no geofenceId', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post('/api/v1/safety-rules').set('Authorization', `Bearer ${token}`).send({ type: 'GEOFENCE', severity: 'LOW' });
      expect(res.status).toBe(400);
    });

    it('rejects a SPEED rule with no thresholdSpeedKmh', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post('/api/v1/safety-rules').set('Authorization', `Bearer ${token}`).send({ type: 'SPEED', severity: 'LOW' });
      expect(res.status).toBe(400);
    });

    it('rejects a rule referencing a bus in a different tenant (404)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/safety-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'SPEED', severity: 'LOW', thresholdSpeedKmh: 40, busId: busB.id });
      expect(res.status).toBe(404);
    });

    it('enable/disable are the only way to change `enabled` — PATCH cannot', async () => {
      const token = await loginAs(adminA.email);
      const create = await api().post('/api/v1/safety-rules').set('Authorization', `Bearer ${token}`).send({ type: 'SPEED', severity: 'LOW', thresholdSpeedKmh: 60 });
      const id = create.body.id;

      const disableRes = await api().post(`/api/v1/safety-rules/${id}/disable`).set('Authorization', `Bearer ${token}`);
      expect(disableRes.status).toBe(200);
      expect(disableRes.body.enabled).toBe(false);

      const disableAgain = await api().post(`/api/v1/safety-rules/${id}/disable`).set('Authorization', `Bearer ${token}`);
      expect(disableAgain.status).toBe(400);

      const enableRes = await api().post(`/api/v1/safety-rules/${id}/enable`).set('Authorization', `Bearer ${token}`);
      expect(enableRes.status).toBe(200);
      expect(enableRes.body.enabled).toBe(true);
    });

    it('DRIVER and parent have zero safety-rule access', async () => {
      const driverToken = await loginAs(driverA.email);
      expect((await api().get('/api/v1/safety-rules').set('Authorization', `Bearer ${driverToken}`)).status).toBe(403);
      const parentToken = await loginParentAs(parentA.phone);
      expect((await api().get('/api/v1/safety-rules').set('Authorization', `Bearer ${parentToken}`)).status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Cross-tenant IDOR
  // ---------------------------------------------------------------------
  describe('cross-tenant isolation', () => {
    it("School B admin cannot read/update/archive School A's geofence (404)", async () => {
      const tokenA = await loginAs(adminA.email);
      const create = await api().post('/api/v1/geofences').set('Authorization', `Bearer ${tokenA}`).send({ name: 'X', type: 'CUSTOM', latitude: 1, longitude: 1, radiusMeters: 50 });

      const tokenB = await loginAs(adminB.email);
      expect((await api().get(`/api/v1/geofences/${create.body.id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      expect((await api().patch(`/api/v1/geofences/${create.body.id}`).set('Authorization', `Bearer ${tokenB}`).send({ name: 'hijack' })).status).toBe(404);
    });

    it("School B admin cannot read School A's safety rule (404)", async () => {
      const tokenA = await loginAs(adminA.email);
      const create = await api().post('/api/v1/safety-rules').set('Authorization', `Bearer ${tokenA}`).send({ type: 'SPEED', severity: 'LOW', thresholdSpeedKmh: 50 });

      const tokenB = await loginAs(adminB.email);
      expect((await api().get(`/api/v1/safety-rules/${create.body.id}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // GPS → rule → SafetyEvent integration
  // ---------------------------------------------------------------------
  describe('GPS integration: deterministic rule evaluation', () => {
    it('GEOFENCE: confirmed entry fires once, repeated points do not duplicate, and recovery permits a future exit event', async () => {
      const token = await loginAs(adminA.email);
      const geofence = await api()
        .post('/api/v1/geofences')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Zone', type: 'CUSTOM', latitude: 20.0, longitude: 80.0, radiusMeters: 100 });
      const rule = await api()
        .post('/api/v1/safety-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'GEOFENCE', severity: 'HIGH', geofenceId: geofence.body.id, minConsecutivePoints: 2, cooldownSeconds: 30 });
      expect(rule.status).toBe(201);

      const outside = { latitude: 21.0, longitude: 81.0 };
      const inside = { latitude: 20.0, longitude: 80.0 };

      // Two consecutive outside points — CONFIRMS an OUTSIDE baseline (the
      // first-ever confirmation is deliberately suppressed for GEOFENCE
      // rules, so this baseline must itself be established before an INSIDE
      // confirmation can count as a real transition — see
      // OperationalSafetyService.debounceAndMaybeFire).
      await sendGps({ ...outside, recordedAt: nextRecordedAt() });
      await sleep(50);
      await sendGps({ ...outside, recordedAt: nextRecordedAt() });
      await sleep(50);
      // First inside point — candidate only, not yet confirmed.
      await sendGps({ ...inside, recordedAt: nextRecordedAt() });
      await sleep(50);
      // Second consecutive inside point — confirms a real OUTSIDE→INSIDE transition: ENTRY.
      await sendGps({ ...inside, recordedAt: nextRecordedAt() });
      await sleep(100);
      // A third inside point — must NOT create a second event.
      await sendGps({ ...inside, recordedAt: nextRecordedAt() });
      await sleep(100);

      const entryEvents = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.safetyEvent.findMany({ where: { schoolId: schoolA.id, type: 'GEOFENCE_ENTRY', source: 'SYSTEM' } }),
      );
      expect(entryEvents.length).toBe(1);
      expect(entryEvents[0]!.severity).toBe('HIGH');
      expect(entryEvents[0]!.createdBy).toBeNull();

      // Simulate cooldown/Redis-state recovery (restart) rather than a real
      // 30s wait — see docs/adr/0020's "Redis is transient state" decision.
      // Cleared (not just "cooldown expired"), since a single cooldown
      // clock is shared per (rule, bus) regardless of direction — an EXIT
      // immediately after the ENTRY above would otherwise still be
      // suppressed by the same 30s cooldown, which is deliberate (an
      // oscillating bus right at the boundary shouldn't alert on every
      // flip either) but not what this assertion is isolating.
      await redis.client.del(`school:${schoolA.id}:bus:${busA.id}:rule:${rule.body.id}:state`);

      // A fresh INSIDE baseline (first observation, suppressed), then an
      // OUTSIDE confirmation — a genuine INSIDE→OUTSIDE transition: EXIT.
      await sendGps({ ...inside, recordedAt: nextRecordedAt() });
      await sleep(50);
      await sendGps({ ...inside, recordedAt: nextRecordedAt() });
      await sleep(50);
      await sendGps({ ...outside, recordedAt: nextRecordedAt() });
      await sleep(50);
      await sendGps({ ...outside, recordedAt: nextRecordedAt() });
      await sleep(100);

      const exitEvents = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.safetyEvent.findMany({ where: { schoolId: schoolA.id, type: 'GEOFENCE_EXIT', source: 'SYSTEM' } }),
      );
      expect(exitEvents.length).toBe(1);
    });

    it('SPEED: a single high-speed point does not fire; two consecutive do, and a CRITICAL one notifies staff', async () => {
      const token = await loginAs(adminA.email);
      const rule = await api()
        .post('/api/v1/safety-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'SPEED', severity: 'CRITICAL', thresholdSpeedKmh: 40, minConsecutivePoints: 2, cooldownSeconds: 30 });
      expect(rule.status).toBe(201);

      const fastPoint = { latitude: 30.0, longitude: 90.0, speedKmh: 80 };
      await sendGps({ ...fastPoint, recordedAt: nextRecordedAt() });
      await sleep(100);

      let events = await prisma.runInTenantContext(schoolA.id, (tx) => tx.safetyEvent.findMany({ where: { schoolId: schoolA.id, type: 'EXCESSIVE_SPEED' } }));
      expect(events.length).toBe(0); // only one point so far — not yet confirmed

      await sendGps({ ...fastPoint, recordedAt: nextRecordedAt() });
      await sleep(150);

      events = await prisma.runInTenantContext(schoolA.id, (tx) => tx.safetyEvent.findMany({ where: { schoolId: schoolA.id, type: 'EXCESSIVE_SPEED' } }));
      expect(events.length).toBe(1);

      const notifs = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.findMany({ where: { schoolId: schoolA.id, eventType: 'SAFETY_EVENT_CRITICAL', entityId: events[0]!.id } }),
      );
      expect(notifs.length).toBeGreaterThan(0);
    });

    it('stale/imprecise GPS (accuracy worse than the configured threshold) never generates a false rule violation', async () => {
      const token = await loginAs(adminA.email);
      const rule = await api()
        .post('/api/v1/safety-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'SPEED', severity: 'LOW', thresholdSpeedKmh: 10, minConsecutivePoints: 1, cooldownSeconds: 30 });
      expect(rule.status).toBe(201);

      // Well beyond SAFETY_RULES_MAX_ACCURACY_M (default 100m) and well
      // above the 10 km/h threshold — would obviously violate if evaluated.
      await sendGps({ latitude: 40.0, longitude: 100.0, speedKmh: 90, accuracyM: 500, recordedAt: nextRecordedAt() });
      await sleep(150);

      const events = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.safetyEvent.findMany({ where: { schoolId: schoolA.id, type: 'EXCESSIVE_SPEED', metadata: { path: ['speedKmh'], equals: 90 } } }),
      );
      expect(events.length).toBe(0);
    });

    it('a duplicate GPS point (identical recordedAt) is deduplicated before rule evaluation — no duplicate candidate progress', async () => {
      const token = await loginAs(adminA.email);
      const createRes = await api()
        .post('/api/v1/safety-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'SPEED', severity: 'LOW', thresholdSpeedKmh: 20, minConsecutivePoints: 3, cooldownSeconds: 30 });
      expect(createRes.status).toBe(201);
      const recordedAt = nextRecordedAt();
      const body = { latitude: 50.0, longitude: 110.0, speedKmh: 90, recordedAt };

      const first = await sendGps(body);
      expect(first.status).toBe(201);
      expect(first.body.deduplicated).toBe(false);
      const dup = await sendGps(body);
      expect(dup.body.deduplicated).toBe(true);
      await sleep(150);

      // Only one real point was ever evaluated despite two requests — with
      // minConsecutivePoints=3, a single accepted point must not confirm.
      const events = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.safetyEvent.findMany({ where: { schoolId: schoolA.id, type: 'EXCESSIVE_SPEED', metadata: { path: ['thresholdSpeedKmh'], equals: 20 } } }),
      );
      expect(events.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // Realtime
  // ---------------------------------------------------------------------
  describe('realtime staff updates', () => {
    it('a confirmed rule violation is pushed live on /realtime/safety', async () => {
      const token = await loginAs(adminA.email);
      const rule = await api()
        .post('/api/v1/safety-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'SPEED', severity: 'LOW', thresholdSpeedKmh: 15, minConsecutivePoints: 2, cooldownSeconds: 30 });
      expect(rule.status).toBe(201);

      const socket = await connectSafetySocket(token);
      try {
        const eventPromise = new Promise((res) => socket.once('safety.event.created', res));
        const point = { latitude: 60.0, longitude: 120.0, speedKmh: 70 };
        await sendGps({ ...point, recordedAt: nextRecordedAt() });
        await sleep(50);
        await sendGps({ ...point, recordedAt: nextRecordedAt() });
        const received = (await eventPromise) as { type: string; source: string };
        expect(received.type).toBe('EXCESSIVE_SPEED');
        expect(received.source).toBe('SYSTEM');
      } finally {
        socket.close();
      }
    });
  });

  // ---------------------------------------------------------------------
  // RLS (direct Postgres, restricted app_user connection)
  // ---------------------------------------------------------------------
  describe('Row-Level Security', () => {
    it('geofences: no tenant context sees zero rows; School A/B are mutually exclusive', async () => {
      const noContext = await prisma.geofence.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
      expect(noContext).toEqual([]);

      const fromA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.geofence.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } }));
      expect(fromA.length).toBeGreaterThan(0);
      expect(fromA.every((g) => g.schoolId === schoolA.id)).toBe(true);
    });

    it('safety_rules: no tenant context sees zero rows; School A/B are mutually exclusive', async () => {
      const noContext = await prisma.safetyRule.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
      expect(noContext).toEqual([]);

      const fromA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.safetyRule.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } }));
      expect(fromA.length).toBeGreaterThan(0);
      expect(fromA.every((r) => r.schoolId === schoolA.id)).toBe(true);
    });
  });
});
