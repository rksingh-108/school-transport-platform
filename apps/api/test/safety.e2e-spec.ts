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

/**
 * Phase 2 Step 12: safety events, emergency management, and the escalation
 * path between them. See docs/adr/0019-safety-events-and-emergency-management.md.
 */
describe('Safety events + emergency management (e2e)', () => {
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
  let driverA: { id: string; email: string };
  let driverA2: { id: string; email: string }; // a second driver, with no current trip — for "no active trip" tests
  let attendantA: { id: string; email: string };
  let adminB: { id: string; email: string };
  let parentA: { id: string; phone: string };
  let busA: { id: string };
  let busA2: { id: string };
  let busB: { id: string };
  let routeA: { id: string };
  let tripA: { id: string }; // IN_PROGRESS, assigned to driverA/attendantA/busA

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

  function connectSafetySocket(token?: string): Promise<ClientSocket> {
    return new Promise((resolvePromise, reject) => {
      const socket = ioClient(`http://localhost:${wsPort}/realtime/safety`, {
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

  function connectSafetySocketExpectingRejection(token?: string): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const socket = ioClient(`http://localhost:${wsPort}/realtime/safety`, {
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
    await app.listen(0);
    const address = app.getHttpServer().address();
    wsPort = typeof address === 'object' && address ? address.port : 0;

    prisma = app.get(PrismaService);

    const staffHash = await passwordService.hash(STAFF_PASSWORD);
    const parentHash = await passwordService.hash(PARENT_PASSWORD);

    schoolA = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Safety Test School A', slug: `safety-test-a-${suffix}`, contactEmail: `a-${suffix}@safety-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Safety Test School B', slug: `safety-test-b-${suffix}`, contactEmail: `b-${suffix}@safety-test.example` } }),
    );

    adminA = await makeStaff(schoolA.id, `admin.a.${suffix}@safety-test.example`, 'SCHOOL_ADMIN', staffHash);
    driverA = await makeStaff(schoolA.id, `driver.a.${suffix}@safety-test.example`, 'DRIVER', staffHash);
    driverA2 = await makeStaff(schoolA.id, `driver.a2.${suffix}@safety-test.example`, 'DRIVER', staffHash);
    attendantA = await makeStaff(schoolA.id, `attendant.a.${suffix}@safety-test.example`, 'BUS_ATTENDANT', staffHash);
    adminB = await makeStaff(schoolB.id, `admin.b.${suffix}@safety-test.example`, 'SCHOOL_ADMIN', staffHash);

    parentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9182009${suffix.toString().slice(-5)}`, fullName: 'Parent A', passwordHash: parentHash } }),
    );

    busA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `SAFE-A-${suffix}`, capacity: 40 } }));
    busA2 = await prisma.runInTenantContext(schoolA.id, (tx) => tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `SAFE-A2-${suffix}`, capacity: 40 } }));
    busB = await prisma.runInTenantContext(schoolB.id, (tx) => tx.bus.create({ data: { schoolId: schoolB.id, registrationNumber: `SAFE-B-${suffix}`, capacity: 30 } }));

    const driverProfileA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.driver.create({ data: { schoolId: schoolA.id, userId: driverA.id, licenseNumber: `LIC-SAFE-A-${suffix}` } }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) => tx.driver.create({ data: { schoolId: schoolA.id, userId: driverA2.id, licenseNumber: `LIC-SAFE-A2-${suffix}` } }));
    const attendantProfileA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.attendant.create({ data: { schoolId: schoolA.id, userId: attendantA.id } }),
    );

    routeA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.route.create({ data: { schoolId: schoolA.id, code: `R-SAFE-${suffix}`, name: 'Safety Test Route', direction: 'HOME_TO_SCHOOL', shift: 'MORNING_PICKUP' } }),
    );
    tripA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.trip.create({
        data: {
          schoolId: schoolA.id,
          routeId: routeA.id,
          busId: busA.id,
          driverId: driverProfileA.id,
          attendantId: attendantProfileA.id,
          serviceDate: new Date(),
          shift: 'MORNING_PICKUP',
          scheduledStartTime: '07:00',
          scheduledEndTime: '08:00',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
        },
      }),
    );
  });

  afterAll(async () => {
    for (const schoolId of [schoolA.id, schoolB.id]) {
      await prisma.runInTenantContext(schoolId, async (tx) => {
        await tx.emergencyAction.deleteMany({ where: { schoolId } });
        await tx.emergency.deleteMany({ where: { schoolId } });
        await tx.safetyEvent.deleteMany({ where: { schoolId } });
        await tx.notificationDelivery.deleteMany({ where: { schoolId } });
        await tx.notification.deleteMany({ where: { schoolId } });
        await tx.trip.deleteMany({ where: { schoolId } });
        await tx.route.deleteMany({ where: { schoolId } });
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
  // SafetyEvent CRUD + lifecycle
  // ---------------------------------------------------------------------
  describe('SafetyEvent CRUD + lifecycle', () => {
    let eventId: string;

    it('staff can create a safety event with full tenant-wide scope', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/safety-events')
        .set('Authorization', `Bearer ${token}`)
        .send({ busId: busA.id, type: 'MANUAL_ALERT', severity: 'MEDIUM', description: 'Staff-reported test event' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('NEW');
      expect(res.body.source).toBe('HUMAN_OPERATOR');
      expect(res.body).not.toHaveProperty('schoolId');
      eventId = res.body.id;
    });

    it('driver can create a safety event auto-scoped to their own current trip', async () => {
      const token = await loginAs(driverA.email);
      const res = await api().post('/api/v1/safety-events').set('Authorization', `Bearer ${token}`).send({ type: 'DRIVER_ALERT', severity: 'LOW' });
      expect(res.status).toBe(201);
      expect(res.body.busId).toBe(busA.id);
      expect(res.body.tripId).toBe(tripA.id);
      expect(res.body.source).toBe('DRIVER');
    });

    it('attendant can create a safety event auto-scoped to their own current trip', async () => {
      const token = await loginAs(attendantA.email);
      const res = await api().post('/api/v1/safety-events').set('Authorization', `Bearer ${token}`).send({ type: 'ATTENDANT_ALERT', severity: 'LOW' });
      expect(res.status).toBe(201);
      expect(res.body.busId).toBe(busA.id);
      expect(res.body.source).toBe('ATTENDANT');
    });

    it('a driver with no active trip cannot create a safety event without an explicit target', async () => {
      const token = await loginAs(driverA2.email);
      const res = await api().post('/api/v1/safety-events').set('Authorization', `Bearer ${token}`).send({ type: 'MANUAL_ALERT', severity: 'LOW' });
      expect(res.status).toBe(400);
    });

    it("a driver cannot claim another bus/trip they aren't assigned to (403, not silently redirected to their own)", async () => {
      const token = await loginAs(driverA.email);
      const res = await api()
        .post('/api/v1/safety-events')
        .set('Authorization', `Bearer ${token}`)
        .send({ busId: busA2.id, type: 'DRIVER_ALERT', severity: 'LOW' });
      expect(res.status).toBe(403);
    });

    it('can read and list safety events', async () => {
      const token = await loginAs(adminA.email);
      const getRes = await api().get(`/api/v1/safety-events/${eventId}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.createdByName).toBeTruthy();

      const listRes = await api().get('/api/v1/safety-events?limit=50').set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.some((e: { id: string }) => e.id === eventId)).toBe(true);
    });

    it('acknowledge: NEW -> ACKNOWLEDGED, then rejects a second acknowledge', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post(`/api/v1/safety-events/${eventId}/acknowledge`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACKNOWLEDGED');
      expect(res.body.reviewedByName).toBeTruthy();

      const again = await api().post(`/api/v1/safety-events/${eventId}/acknowledge`).set('Authorization', `Bearer ${token}`);
      expect(again.status).toBe(400);
    });

    it('dismiss: ACKNOWLEDGED -> DISMISSED is terminal', async () => {
      const token = await loginAs(adminA.email);
      const create = await api().post('/api/v1/safety-events').set('Authorization', `Bearer ${token}`).send({ type: 'OTHER', severity: 'LOW' });
      const id = create.body.id;

      const dismissRes = await api().post(`/api/v1/safety-events/${id}/dismiss`).set('Authorization', `Bearer ${token}`).send({ resolutionNote: 'Not relevant' });
      expect(dismissRes.status).toBe(200);
      expect(dismissRes.body.status).toBe('DISMISSED');

      const resolveAfter = await api().post(`/api/v1/safety-events/${id}/resolve`).set('Authorization', `Bearer ${token}`);
      expect(resolveAfter.status).toBe(400);
    });

    it('resolve: NEW -> RESOLVED directly (no escalation needed)', async () => {
      const token = await loginAs(adminA.email);
      const create = await api().post('/api/v1/safety-events').set('Authorization', `Bearer ${token}`).send({ type: 'OTHER', severity: 'LOW' });
      const res = await api().post(`/api/v1/safety-events/${create.body.id}/resolve`).set('Authorization', `Bearer ${token}`).send({ resolutionNote: 'Handled' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('RESOLVED');
    });

    it('DRIVER/BUS_ATTENDANT cannot acknowledge/dismiss/escalate/resolve any event (403 — no safety_events.manage)', async () => {
      const token = await loginAs(driverA.email);
      const res = await api().post(`/api/v1/safety-events/${eventId}/acknowledge`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('a parent has zero safety-event access', async () => {
      const token = await loginParentAs(parentA.phone);
      const listRes = await api().get('/api/v1/safety-events').set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(403);
      const createRes = await api().post('/api/v1/safety-events').set('Authorization', `Bearer ${token}`).send({ type: 'MANUAL_ALERT', severity: 'LOW' });
      expect(createRes.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Escalation -> Emergency
  // ---------------------------------------------------------------------
  describe('escalation into an Emergency', () => {
    it('escalate creates a linked, ACTIVE emergency and the safety event becomes terminal ESCALATED', async () => {
      const token = await loginAs(adminA.email);
      const create = await api()
        .post('/api/v1/safety-events')
        .set('Authorization', `Bearer ${token}`)
        .send({ busId: busA.id, tripId: tripA.id, type: 'ACCIDENT', severity: 'CRITICAL', description: 'Escalation test' });
      const eventId = create.body.id;

      const escalateRes = await api().post(`/api/v1/safety-events/${eventId}/escalate`).set('Authorization', `Bearer ${token}`);
      expect(escalateRes.status).toBe(200);
      expect(escalateRes.body.status).toBe('ESCALATED');
      expect(escalateRes.body.emergencyId).toBeTruthy();

      const emergencyRes = await api().get(`/api/v1/emergencies/${escalateRes.body.emergencyId}`).set('Authorization', `Bearer ${token}`);
      expect(emergencyRes.status).toBe(200);
      expect(emergencyRes.body.status).toBe('ACTIVE');
      expect(emergencyRes.body.sourceSafetyEventId).toBe(eventId);
      expect(emergencyRes.body.busId).toBe(busA.id);

      // Cannot resolve/dismiss/acknowledge the now-ESCALATED event directly.
      const ackAfter = await api().post(`/api/v1/safety-events/${eventId}/acknowledge`).set('Authorization', `Bearer ${token}`);
      expect(ackAfter.status).toBe(400);
      const resolveAfter = await api().post(`/api/v1/safety-events/${eventId}/resolve`).set('Authorization', `Bearer ${token}`);
      expect(resolveAfter.status).toBe(400);

      // Resolving the emergency flips the source event to RESOLVED automatically.
      const resolveEmergency = await api().post(`/api/v1/emergencies/${escalateRes.body.emergencyId}/resolve`).set('Authorization', `Bearer ${token}`).send({});
      expect(resolveEmergency.status).toBe(200);

      const eventAfter = await api().get(`/api/v1/safety-events/${eventId}`).set('Authorization', `Bearer ${token}`);
      expect(eventAfter.body.status).toBe('RESOLVED');
    });
  });

  // ---------------------------------------------------------------------
  // Emergency trigger + lifecycle
  // ---------------------------------------------------------------------
  describe('Emergency trigger + lifecycle', () => {
    it('driver can trigger an emergency auto-scoped to their own current trip, with default CRITICAL severity', async () => {
      const token = await loginAs(driverA.email);
      const res = await api().post('/api/v1/emergencies').set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.severity).toBe('CRITICAL');
      expect(res.body.busId).toBe(busA.id);
      expect(res.body.tripId).toBe(tripA.id);
      expect(res.body.initiatedByName).toBeTruthy();
    });

    it('a driver with no active trip cannot trigger an emergency', async () => {
      const token = await loginAs(driverA2.email);
      const res = await api().post('/api/v1/emergencies').set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(400);
    });

    it("a driver cannot trigger an emergency for another bus (403)", async () => {
      const token = await loginAs(driverA.email);
      const res = await api().post('/api/v1/emergencies').set('Authorization', `Bearer ${token}`).send({ busId: busA2.id });
      expect(res.status).toBe(403);
    });

    it('staff can trigger an emergency with no bus/trip at all (on-campus, unrelated to any bus)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post('/api/v1/emergencies').set('Authorization', `Bearer ${token}`).send({ reason: 'On-campus incident' });
      expect(res.status).toBe(201);
      expect(res.body.busId).toBeNull();
      expect(res.body.tripId).toBeNull();
    });

    it('full lifecycle: ACTIVE -> ACKNOWLEDGED -> action added -> RESOLVED, history preserved', async () => {
      const token = await loginAs(adminA.email);
      const create = await api().post('/api/v1/emergencies').set('Authorization', `Bearer ${token}`).send({ busId: busA.id, reason: 'Lifecycle test' });
      const id = create.body.id;

      const ack = await api().post(`/api/v1/emergencies/${id}/acknowledge`).set('Authorization', `Bearer ${token}`);
      expect(ack.status).toBe(200);
      expect(ack.body.status).toBe('ACKNOWLEDGED');

      const action = await api()
        .post(`/api/v1/emergencies/${id}/actions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ actionType: 'CONTACTED_SCHOOL', note: 'Notified office' });
      expect(action.status).toBe(201);
      expect(action.body.actions.length).toBeGreaterThan(0);

      const resolveRes = await api().post(`/api/v1/emergencies/${id}/resolve`).set('Authorization', `Bearer ${token}`).send({ resolutionNote: 'All clear' });
      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.status).toBe('RESOLVED');
      expect(resolveRes.body.actions.length).toBeGreaterThanOrEqual(1); // history preserved, not wiped

      const cannotReopen = await api().post(`/api/v1/emergencies/${id}/acknowledge`).set('Authorization', `Bearer ${token}`);
      expect(cannotReopen.status).toBe(400);
      const cannotAddAction = await api().post(`/api/v1/emergencies/${id}/actions`).set('Authorization', `Bearer ${token}`).send({ actionType: 'OTHER' });
      expect(cannotAddAction.status).toBe(400);
    });

    it('reject invalid transitions: RESOLVED -> ACTIVE / ACKNOWLEDGED are both unreachable (only ACTIVE/ACKNOWLEDGED accept a manual transition)', async () => {
      const token = await loginAs(adminA.email);
      const create = await api().post('/api/v1/emergencies').set('Authorization', `Bearer ${token}`).send({ busId: busA.id });
      const cancelRes = await api().post(`/api/v1/emergencies/${create.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({ resolutionNote: 'False alarm' });
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('CANCELLED');

      const ackAfterCancel = await api().post(`/api/v1/emergencies/${create.body.id}/acknowledge`).set('Authorization', `Bearer ${token}`);
      expect(ackAfterCancel.status).toBe(400);
    });

    it('DRIVER/BUS_ATTENDANT cannot manage any emergency (403 — no emergency.manage)', async () => {
      const staffToken = await loginAs(adminA.email);
      const create = await api().post('/api/v1/emergencies').set('Authorization', `Bearer ${staffToken}`).send({ busId: busA.id });

      const driverToken = await loginAs(driverA.email);
      const res = await api().post(`/api/v1/emergencies/${create.body.id}/acknowledge`).set('Authorization', `Bearer ${driverToken}`);
      expect(res.status).toBe(403);
    });

    it('a parent has zero emergency access', async () => {
      const token = await loginParentAs(parentA.phone);
      const listRes = await api().get('/api/v1/emergencies').set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(403);
      const createRes = await api().post('/api/v1/emergencies').set('Authorization', `Bearer ${token}`).send({});
      expect(createRes.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Cross-tenant / IDOR
  // ---------------------------------------------------------------------
  describe('cross-tenant isolation', () => {
    it("School B admin cannot GET/acknowledge/escalate School A's safety event (404)", async () => {
      const tokenA = await loginAs(adminA.email);
      const create = await api().post('/api/v1/safety-events').set('Authorization', `Bearer ${tokenA}`).send({ type: 'OTHER', severity: 'LOW' });
      const id = create.body.id;

      const tokenB = await loginAs(adminB.email);
      const getRes = await api().get(`/api/v1/safety-events/${id}`).set('Authorization', `Bearer ${tokenB}`);
      expect(getRes.status).toBe(404);
      const ackRes = await api().post(`/api/v1/safety-events/${id}/acknowledge`).set('Authorization', `Bearer ${tokenB}`);
      expect(ackRes.status).toBe(404);
    });

    it("School A admin cannot create a safety event referencing School B's bus (404)", async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post('/api/v1/safety-events').set('Authorization', `Bearer ${token}`).send({ busId: busB.id, type: 'OTHER', severity: 'LOW' });
      expect(res.status).toBe(404);
    });

    it("School A admin cannot trigger an emergency referencing School B's bus (404)", async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post('/api/v1/emergencies').set('Authorization', `Bearer ${token}`).send({ busId: busB.id });
      expect(res.status).toBe(404);
    });

    it("School B admin cannot GET/acknowledge School A's emergency (404)", async () => {
      const tokenA = await loginAs(adminA.email);
      const create = await api().post('/api/v1/emergencies').set('Authorization', `Bearer ${tokenA}`).send({ busId: busA.id });

      const tokenB = await loginAs(adminB.email);
      const getRes = await api().get(`/api/v1/emergencies/${create.body.id}`).set('Authorization', `Bearer ${tokenB}`);
      expect(getRes.status).toBe(404);
      const ackRes = await api().post(`/api/v1/emergencies/${create.body.id}/acknowledge`).set('Authorization', `Bearer ${tokenB}`);
      expect(ackRes.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------
  describe('audit logging', () => {
    it('records SAFETY_EVENT_CREATED/ESCALATED and EMERGENCY_CREATED/RESOLVED', async () => {
      const token = await loginAs(adminA.email);
      const create = await api()
        .post('/api/v1/safety-events')
        .set('Authorization', `Bearer ${token}`)
        .send({ busId: busA.id, type: 'ACCIDENT', severity: 'CRITICAL' });
      const eventId = create.body.id;
      const escalate = await api().post(`/api/v1/safety-events/${eventId}/escalate`).set('Authorization', `Bearer ${token}`);
      const emergencyId = escalate.body.emergencyId;
      await api().post(`/api/v1/emergencies/${emergencyId}/resolve`).set('Authorization', `Bearer ${token}`).send({});

      const eventLogs = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.auditLog.findMany({ where: { schoolId: schoolA.id, subjectType: 'SafetyEvent', subjectId: eventId } }),
      );
      expect(eventLogs.map((l) => l.action)).toEqual(expect.arrayContaining(['SAFETY_EVENT_CREATED', 'SAFETY_EVENT_ESCALATED']));

      const emergencyLogs = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.auditLog.findMany({ where: { schoolId: schoolA.id, subjectType: 'Emergency', subjectId: emergencyId } }),
      );
      expect(emergencyLogs.map((l) => l.action)).toEqual(expect.arrayContaining(['EMERGENCY_CREATED', 'EMERGENCY_RESOLVED']));
    });
  });

  // ---------------------------------------------------------------------
  // Notification integration
  // ---------------------------------------------------------------------
  describe('notification integration', () => {
    it('a CRITICAL safety event notifies operational staff; a LOW one does not', async () => {
      const token = await loginAs(adminA.email);

      const critical = await api()
        .post('/api/v1/safety-events')
        .set('Authorization', `Bearer ${token}`)
        .send({ busId: busA.id, type: 'FIGHTING', severity: 'CRITICAL' });
      await sleep(200);
      const criticalNotifs = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.findMany({ where: { schoolId: schoolA.id, eventType: 'SAFETY_EVENT_CRITICAL', entityId: critical.body.id } }),
      );
      expect(criticalNotifs.length).toBeGreaterThan(0);

      const low = await api().post('/api/v1/safety-events').set('Authorization', `Bearer ${token}`).send({ busId: busA.id, type: 'OTHER', severity: 'LOW' });
      await sleep(200);
      const lowNotifs = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.findMany({ where: { schoolId: schoolA.id, eventType: 'SAFETY_EVENT_CRITICAL', entityId: low.body.id } }),
      );
      expect(lowNotifs.length).toBe(0);
    });

    it('triggering an emergency notifies operational staff', async () => {
      const token = await loginAs(adminA.email);
      const create = await api().post('/api/v1/emergencies').set('Authorization', `Bearer ${token}`).send({ busId: busA.id });
      await sleep(200);
      const notifs = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.findMany({ where: { schoolId: schoolA.id, eventType: 'EMERGENCY_CREATED', entityId: create.body.id } }),
      );
      expect(notifs.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------
  // RLS (direct Postgres, restricted app_user connection)
  // ---------------------------------------------------------------------
  describe('Row-Level Security', () => {
    it('safety_events: no tenant context sees zero rows; School A/B are mutually exclusive', async () => {
      const noContext = await prisma.safetyEvent.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
      expect(noContext).toEqual([]);

      const fromA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.safetyEvent.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } }));
      expect(fromA.length).toBeGreaterThan(0);
      expect(fromA.every((e) => e.schoolId === schoolA.id)).toBe(true);

      const fromB = await prisma.runInTenantContext(schoolB.id, (tx) => tx.safetyEvent.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } }));
      expect(fromB.every((e) => e.schoolId === schoolB.id)).toBe(true);
    });

    it('emergencies: no tenant context sees zero rows; School A/B are mutually exclusive', async () => {
      const noContext = await prisma.emergency.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
      expect(noContext).toEqual([]);

      const fromA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.emergency.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } }));
      expect(fromA.length).toBeGreaterThan(0);
      expect(fromA.every((e) => e.schoolId === schoolA.id)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Realtime (/realtime/safety)
  // ---------------------------------------------------------------------
  describe('realtime authorization', () => {
    it('authorized staff receives a new safety event and an emergency update in realtime', async () => {
      const token = await loginAs(adminA.email);
      const socket = await connectSafetySocket(token);
      try {
        const eventPromise = new Promise((res) => socket.once('safety.event.created', res));
        await api().post('/api/v1/safety-events').set('Authorization', `Bearer ${token}`).send({ busId: busA.id, type: 'OTHER', severity: 'LOW' });
        const received = await eventPromise;
        expect(received).toBeTruthy();

        const emergencyPromise = new Promise((res) => socket.once('emergency.created', res));
        await api().post('/api/v1/emergencies').set('Authorization', `Bearer ${token}`).send({ busId: busA.id });
        const receivedEmergency = await emergencyPromise;
        expect(receivedEmergency).toBeTruthy();
      } finally {
        socket.close();
      }
    });

    it('a parent token is rejected by the safety namespace', async () => {
      const token = await loginParentAs(parentA.phone);
      await connectSafetySocketExpectingRejection(token);
    });

    it('no token at all is rejected', async () => {
      await connectSafetySocketExpectingRejection(undefined);
    });

    it('DRIVER (no safety_events.read/emergency.read) is rejected', async () => {
      const token = await loginAs(driverA.email);
      await connectSafetySocketExpectingRejection(token);
    });

    it("a School B staff member's socket never receives School A's events (tenant isolation)", async () => {
      const tokenA = await loginAs(adminA.email);
      const tokenB = await loginAs(adminB.email);
      const socketB = await connectSafetySocket(tokenB);
      try {
        let receivedByB = false;
        socketB.on('safety.event.created', () => {
          receivedByB = true;
        });
        await api().post('/api/v1/safety-events').set('Authorization', `Bearer ${tokenA}`).send({ busId: busA.id, type: 'OTHER', severity: 'LOW' });
        await sleep(300);
        expect(receivedByB).toBe(false);
      } finally {
        socketB.close();
      }
    });
  });

  it('pagination: list respects limit and returns a usable nextCursor', async () => {
    const token = await loginAs(adminA.email);
    const res = await api().get('/api/v1/safety-events?limit=1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(typeof res.body.nextCursor === 'string' || res.body.nextCursor === null).toBe(true);
  });
});
