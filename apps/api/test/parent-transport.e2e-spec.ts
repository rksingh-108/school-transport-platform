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

/** Mirrors ParentTransportService.todayInTimezone exactly, so fixtures land on the same "today" the service will compute. */
function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

describe('Parent transport tracking (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wsPort: number;
  const passwordService = new PasswordService();
  const suffix = Date.now();
  const STAFF_PASSWORD = 'CorrectHorse123';
  const PARENT_PASSWORD = 'ParentPassw0rd1';
  const TODAY = todayInTimezone('Asia/Kolkata');

  let schoolA: { id: string };
  let schoolB: { id: string };
  let adminA: { id: string; email: string };
  let parentA: { id: string; phone: string };
  let parentA2: { id: string; phone: string }; // unrelated parent, same school
  let studentInProgress: { id: string };
  let studentScheduled: { id: string };
  let studentCompleted: { id: string };
  let studentCancelled: { id: string };
  let studentUnrelated: { id: string }; // linked to parentA2, not parentA
  let tripInProgress: { id: string };
  let busInProgress: { id: string };
  let deviceInProgress: { id: string };

  let parentB: { id: string; phone: string };
  let studentB: { id: string };

  const api = () => request(app.getHttpServer());

  async function loginParentAs(phone: string) {
    const res = await api().post('/api/v1/auth/parent/login').send({ phone, password: PARENT_PASSWORD });
    return res.body.accessToken as string;
  }
  async function loginStaffAs(email: string) {
    const res = await api().post('/api/v1/auth/staff/login').send({ email, password: STAFF_PASSWORD });
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

  function connectSocket(namespace: string, token?: string): Promise<ClientSocket> {
    return new Promise((resolvePromise, reject) => {
      const socket = ioClient(`http://localhost:${wsPort}${namespace}`, {
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

  function connectSocketExpectingRejection(namespace: string, token?: string): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const socket = ioClient(`http://localhost:${wsPort}${namespace}`, {
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
      tx.school.create({ data: { name: 'Parent Test School A', slug: `parent-test-a-${suffix}`, contactEmail: `a-${suffix}@parent-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Parent Test School B', slug: `parent-test-b-${suffix}`, contactEmail: `b-${suffix}@parent-test.example` } }),
    );

    adminA = await makeStaff(schoolA.id, `admin.a.${suffix}@parent-test.example`, 'SCHOOL_ADMIN', staffHash);
    const driverUserA = await makeStaff(schoolA.id, `driver.a.${suffix}@parent-test.example`, 'DRIVER', staffHash);
    const driverA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.driver.create({ data: { schoolId: schoolA.id, userId: driverUserA.id, licenseNumber: `PT-LIC-A-${suffix}` } }),
    );
    const routeA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.route.create({ data: { schoolId: schoolA.id, name: `Parent Test Route A ${suffix}`, direction: 'HOME_TO_SCHOOL', shift: 'MORNING_PICKUP' } }),
    );
    // Trip has @@unique([routeId, serviceDate, shift]) — each same-shift,
    // same-day trip below needs its own route to avoid colliding.
    const routeA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.route.create({ data: { schoolId: schoolA.id, name: `Parent Test Route A2 ${suffix}`, direction: 'HOME_TO_SCHOOL', shift: 'MORNING_PICKUP' } }),
    );
    const routeA3 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.route.create({ data: { schoolId: schoolA.id, name: `Parent Test Route A3 ${suffix}`, direction: 'HOME_TO_SCHOOL', shift: 'MORNING_PICKUP' } }),
    );
    busInProgress = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `PT-BUS-A1-${suffix}`, fleetNumber: 'A1', capacity: 40 } }),
    );
    const busOther = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `PT-BUS-A2-${suffix}`, capacity: 40 } }),
    );
    deviceInProgress = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busInProgress.id, deviceType: 'GPS_TRACKER', externalDeviceId: `PT-DEV-A1-${suffix}` } }),
    );

    parentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9180008${suffix.toString().slice(-5)}`, fullName: 'Parent A', passwordHash: parentHash } }),
    );
    parentA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9180009${suffix.toString().slice(-5)}`, fullName: 'Parent A2', passwordHash: parentHash } }),
    );

    studentInProgress = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `PT-A-${suffix}-1`, fullName: 'Child In Progress' } }),
    );
    studentScheduled = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `PT-A-${suffix}-2`, fullName: 'Child Scheduled' } }),
    );
    studentCompleted = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `PT-A-${suffix}-3`, fullName: 'Child Completed' } }),
    );
    studentCancelled = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `PT-A-${suffix}-4`, fullName: 'Child Cancelled' } }),
    );
    studentUnrelated = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `PT-A-${suffix}-5`, fullName: 'Unrelated Child' } }),
    );

    for (const studentId of [studentInProgress.id, studentScheduled.id, studentCompleted.id, studentCancelled.id]) {
      await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.parentStudent.create({
          data: { schoolId: schoolA.id, parentId: parentA.id, studentId, relationship: 'MOTHER', verified: true, verifiedBy: adminA.id, verifiedAt: new Date() },
        }),
      );
    }
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parentStudent.create({
        data: { schoolId: schoolA.id, parentId: parentA2.id, studentId: studentUnrelated.id, relationship: 'FATHER', verified: true, verifiedBy: adminA.id, verifiedAt: new Date() },
      }),
    );

    tripInProgress = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.trip.create({
        data: {
          schoolId: schoolA.id,
          routeId: routeA.id,
          busId: busInProgress.id,
          driverId: driverA.id,
          serviceDate: new Date(TODAY),
          shift: 'MORNING_PICKUP',
          scheduledStartTime: '07:00',
          scheduledEndTime: '08:00',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
        },
      }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.tripStudent.create({
        data: { schoolId: schoolA.id, tripId: tripInProgress.id, studentId: studentInProgress.id, currentStatus: 'BOARDED', boardedAt: new Date() },
      }),
    );

    const tripScheduled = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.trip.create({
        data: {
          schoolId: schoolA.id,
          routeId: routeA.id,
          busId: busOther.id,
          driverId: driverA.id,
          serviceDate: new Date(TODAY),
          shift: 'AFTERNOON_DROP',
          scheduledStartTime: '14:30',
          scheduledEndTime: '15:30',
          status: 'SCHEDULED',
        },
      }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.tripStudent.create({ data: { schoolId: schoolA.id, tripId: tripScheduled.id, studentId: studentScheduled.id } }),
    );

    const tripCompleted = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.trip.create({
        data: {
          schoolId: schoolA.id,
          routeId: routeA2.id,
          busId: busOther.id,
          driverId: driverA.id,
          serviceDate: new Date(TODAY),
          shift: 'MORNING_PICKUP',
          scheduledStartTime: '06:00',
          scheduledEndTime: '06:45',
          status: 'COMPLETED',
          startedAt: new Date(Date.now() - 3600_000),
          endedAt: new Date(Date.now() - 1800_000),
        },
      }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.tripStudent.create({
        data: {
          schoolId: schoolA.id,
          tripId: tripCompleted.id,
          studentId: studentCompleted.id,
          currentStatus: 'DROPPED_OFF',
          boardedAt: new Date(Date.now() - 3500_000),
          droppedOffAt: new Date(Date.now() - 1800_000),
        },
      }),
    );

    const tripCancelled = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.trip.create({
        data: {
          schoolId: schoolA.id,
          routeId: routeA3.id,
          busId: busOther.id,
          driverId: driverA.id,
          serviceDate: new Date(TODAY),
          shift: 'MORNING_PICKUP',
          scheduledStartTime: '07:30',
          scheduledEndTime: '08:15',
          status: 'CANCELLED',
          cancellationReason: 'Bus breakdown',
        },
      }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.tripStudent.create({ data: { schoolId: schoolA.id, tripId: tripCancelled.id, studentId: studentCancelled.id } }),
    );

    // School B — cross-tenant fixture
    const adminB = await makeStaff(schoolB.id, `admin.b.${suffix}@parent-test.example`, 'SCHOOL_ADMIN', staffHash);
    parentB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolB.id, phone: `+9180010${suffix.toString().slice(-5)}`, fullName: 'Parent B', passwordHash: parentHash } }),
    );
    studentB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolB.id, admissionNumber: `PT-B-${suffix}-1`, fullName: 'Child B' } }),
    );
    await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.parentStudent.create({
        data: { schoolId: schoolB.id, parentId: parentB.id, studentId: studentB.id, relationship: 'MOTHER', verified: true, verifiedBy: adminB.id, verifiedAt: new Date() },
      }),
    );
  });

  afterAll(async () => {
    for (const schoolId of [schoolA.id, schoolB.id]) {
      await prisma.runInTenantContext(schoolId, async (tx) => {
        await tx.gpsPoint.deleteMany({ where: { schoolId } });
        await tx.tripStudent.deleteMany({ where: { schoolId } });
        await tx.trip.deleteMany({ where: { schoolId } });
        await tx.route.deleteMany({ where: { schoolId } });
        await tx.busDevice.deleteMany({ where: { schoolId } });
        await tx.bus.deleteMany({ where: { schoolId } });
        await tx.driver.deleteMany({ where: { schoolId } });
        await tx.parentStudent.deleteMany({ where: { schoolId } });
        await tx.parent.deleteMany({ where: { schoolId } });
        await tx.student.deleteMany({ where: { schoolId } });
        await tx.auditLog.deleteMany({ where: { schoolId } });
        await tx.refreshToken.deleteMany({ where: { schoolId } });
        await tx.user.deleteMany({ where: { schoolId } });
        await tx.school.delete({ where: { id: schoolId } });
      });
    }
    await app.close();
  });

  // ---------------------------------------------------------------------
  // Active trip resolution + DTO shape
  // ---------------------------------------------------------------------
  describe('active trip resolution and parent-safe DTO', () => {
    it('resolves an IN_PROGRESS trip, boarded status, and (once GPS exists) a live location', async () => {
      const staffToken = await loginStaffAs(adminA.email);
      const deviceToken = await issueCredential(staffToken, deviceInProgress.id);
      await api()
        .post('/api/v1/telemetry/gps')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({ latitude: 12.97, longitude: 77.59, speedKmh: 20, heading: 90, recordedAt: new Date().toISOString() });

      const token = await loginParentAs(parentA.phone);
      const res = await api().get(`/api/v1/parent/children/${studentInProgress.id}/transport`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.trip.status).toBe('IN_PROGRESS');
      expect(res.body.attendance.status).toBe('BOARDED');
      expect(res.body.attendance.boardedAt).toBeTruthy();
      expect(res.body.bus.displayName).toBe('Bus A1');
      expect(res.body.location.latitude).toBe(12.97);
      expect(res.body.location.freshness).toBe('LIVE');

      // Parent-safe DTO: none of these internal fields ever appear anywhere in the response.
      const raw = JSON.stringify(res.body);
      for (const forbidden of ['deviceId', 'schoolId', 'driverId', 'attendantId', 'recordedBy', 'accuracyM']) {
        expect(raw).not.toContain(forbidden);
      }
    });

    it('shows a scheduled trip with no location before it starts', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get(`/api/v1/parent/children/${studentScheduled.id}/transport`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.trip.status).toBe('SCHEDULED');
      expect(res.body.attendance.status).toBe('EXPECTED');
      expect(res.body.location).toBeNull();
    });

    it('shows a completed trip as dropped off, with no live location', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get(`/api/v1/parent/children/${studentCompleted.id}/transport`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.trip.status).toBe('COMPLETED');
      expect(res.body.attendance.status).toBe('DROPPED_OFF');
      expect(res.body.location).toBeNull();
    });

    it('clearly shows a cancelled trip', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get(`/api/v1/parent/children/${studentCancelled.id}/transport`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.trip.status).toBe('CANCELLED');
      expect(res.body.location).toBeNull();
    });

    it('reports no active trip for a child with none today', async () => {
      const extraStudent = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `PT-A-${suffix}-6`, fullName: 'Child No Trip' } }),
      );
      await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.parentStudent.create({
          data: { schoolId: schoolA.id, parentId: parentA.id, studentId: extraStudent.id, relationship: 'MOTHER', verified: true, verifiedBy: adminA.id, verifiedAt: new Date() },
        }),
      );
      const token = await loginParentAs(parentA.phone);
      const res = await api().get(`/api/v1/parent/children/${extraStudent.id}/transport`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.trip).toBeNull();
      expect(res.body.attendance).toBeNull();
      expect(res.body.location).toBeNull();
    });

    it('GET /parent/children returns a transport summary per child in one call (multi-child parent)', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get('/api/v1/parent/children').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(4);
      const inProgressEntry = res.body.find((c: { id: string }) => c.id === studentInProgress.id);
      expect(inProgressEntry.transport.tripStatus).toBe('IN_PROGRESS');
      expect(inProgressEntry.transport.attendanceStatus).toBe('BOARDED');
      expect(inProgressEntry.transport.freshness).toBe('LIVE');
      const scheduledEntry = res.body.find((c: { id: string }) => c.id === studentScheduled.id);
      expect(scheduledEntry.transport.tripStatus).toBe('SCHEDULED');
      expect(scheduledEntry.transport.freshness).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // IDOR / cross-parent / cross-tenant
  // ---------------------------------------------------------------------
  describe('IDOR and access boundaries', () => {
    it("Parent A cannot access another parent's child (404, not 403 — indistinguishable from a nonexistent student)", async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get(`/api/v1/parent/children/${studentUnrelated.id}/transport`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it("Parent A cannot access School B's child", async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get(`/api/v1/parent/children/${studentB.id}/transport`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('Parent A cannot access internal GPS/fleet endpoints', async () => {
      const token = await loginParentAs(parentA.phone);
      const fleet = await api().get('/api/v1/gps/fleet').set('Authorization', `Bearer ${token}`);
      const location = await api().get(`/api/v1/buses/${busInProgress.id}/location`).set('Authorization', `Bearer ${token}`);
      const telemetry = await api().get(`/api/v1/buses/${busInProgress.id}/telemetry`).set('Authorization', `Bearer ${token}`);
      expect(fleet.status).toBe(403);
      expect(location.status).toBe(403);
      expect(telemetry.status).toBe(403);
    });

    it('Parent A cannot access a school-admin management endpoint', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get('/api/v1/students').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('a staff token cannot use the parent transport endpoint', async () => {
      const token = await loginStaffAs(adminA.email);
      const res = await api().get(`/api/v1/parent/children/${studentInProgress.id}/transport`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Direct RLS verification
  // ---------------------------------------------------------------------
  describe('RLS enforcement (direct, bypassing the API)', () => {
    it("School A's tenant context never returns School B's parent-student links", async () => {
      const fromA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.parentStudent.findMany({ where: { parentId: parentB.id } }));
      expect(fromA).toEqual([]);
    });

    it('no tenant context set at all returns zero rows for trip_students', async () => {
      const count = await prisma.tripStudent.count();
      expect(count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // Realtime WebSocket isolation
  // ---------------------------------------------------------------------
  describe('parent realtime channel', () => {
    it('rejects an unauthenticated connection', async () => {
      await connectSocketExpectingRejection('/realtime/parent');
    });

    it('rejects a staff token on the parent namespace', async () => {
      const token = await loginStaffAs(adminA.email);
      await connectSocketExpectingRejection('/realtime/parent', token);
    });

    it("a parent receives realtime updates only for their own child, never an unrelated child's", async () => {
      const tokenA = await loginParentAs(parentA.phone);
      const tokenA2 = await loginParentAs(parentA2.phone);
      const socketA = await connectSocket('/realtime/parent', tokenA);
      const socketA2 = await connectSocket('/realtime/parent', tokenA2);
      const receivedA: Array<{ childId: string }> = [];
      const receivedA2: Array<{ childId: string }> = [];
      socketA.on('parent.child.transport.updated', (e) => receivedA.push(e));
      socketA2.on('parent.child.transport.updated', (e) => receivedA2.push(e));
      await sleep(300);

      const staffToken = await loginStaffAs(adminA.email);
      const deviceToken = await issueCredential(staffToken, deviceInProgress.id);
      await api()
        .post('/api/v1/telemetry/gps')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({ latitude: 13.0, longitude: 77.6, recordedAt: new Date().toISOString() });
      await sleep(400);

      expect(receivedA.some((e) => e.childId === studentInProgress.id)).toBe(true);
      expect(receivedA2.some((e) => e.childId === studentInProgress.id)).toBe(false);

      socketA.close();
      socketA2.close();
    });

    it("Parent B never receives Parent A's child updates (cross-tenant realtime isolation)", async () => {
      const tokenB = await loginParentAs(parentB.phone);
      const socketB = await connectSocket('/realtime/parent', tokenB);
      const receivedB: unknown[] = [];
      socketB.on('parent.child.transport.updated', (e) => receivedB.push(e));
      await sleep(300);

      const staffToken = await loginStaffAs(adminA.email);
      const deviceToken = await issueCredential(staffToken, deviceInProgress.id);
      await api()
        .post('/api/v1/telemetry/gps')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({ latitude: 13.1, longitude: 77.7, recordedAt: new Date().toISOString() });
      await sleep(400);

      expect(receivedB).toHaveLength(0);
      socketB.close();
    });
  });
});
