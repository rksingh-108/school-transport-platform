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

/**
 * Phase 3 Step 14: edge-AI device authentication, observation ingestion
 * (dedup/temporal aggregation, timestamp bounds), the AI model registry, the
 * Camera-to-edge-device association, staff-only reads, and the strict
 * SafetyEvent/parent boundaries. See
 * docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md.
 */
describe('Edge AI / computer vision pipeline foundation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wsPort: number;
  const passwordService = new PasswordService();
  const suffix = Date.now();
  const STAFF_PASSWORD = 'CorrectHorse123';
  const PARENT_PASSWORD = 'ParentPassw0rd1';

  let schoolA: { id: string };
  let schoolB: { id: string };
  let superAdmin: { id: string; email: string };
  let adminA: { id: string; email: string }; // SCHOOL_ADMIN — ai_events.read
  let managerA: { id: string; email: string }; // TRANSPORT_MANAGER — ai_events.read
  let driverA: { id: string; email: string }; // DRIVER — no AI access at all
  let attendantA: { id: string; email: string }; // BUS_ATTENDANT — no AI access at all
  let adminB: { id: string; email: string };
  let parentA: { id: string; phone: string };
  let busA: { id: string };
  let busA2: { id: string };
  let busB: { id: string };
  let routeA: { id: string };
  let tripA: { id: string };
  let edgeDeviceA: { id: string };
  let edgeDeviceB: { id: string };
  let gpsDeviceA: { id: string }; // proves a GPS tracker's credential can't authenticate edge-AI submission
  let cameraA: { id: string }; // assigned to edgeDeviceA
  let cameraAUnassigned: { id: string }; // exists, but edgeDeviceId is null
  let cameraB: { id: string };
  let edgeCredentialA: string;
  let edgeCredentialB: string;
  let modelActive: { id: string; name: string; version: string };
  let modelInactive: { id: string; name: string; version: string };

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

  function submitObservation(token: string, body: Record<string, unknown>) {
    return api().post('/api/v1/edge-ai/observations').set('Authorization', `Bearer ${token}`).send(body);
  }
  function validObservationBody(overrides: Record<string, unknown> = {}) {
    return {
      cameraId: cameraA.id,
      detectionType: 'PERSON_DETECTED',
      confidence: 0.9,
      occurredAt: new Date().toISOString(),
      modelName: modelActive.name,
      modelVersion: modelActive.version,
      ...overrides,
    };
  }

  function connectAiSocket(token: string): Promise<ClientSocket> {
    return new Promise((resolvePromise, reject) => {
      const socket = ioClient(`http://localhost:${wsPort}/realtime/ai-observations`, {
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

  /**
   * The server accepts the transport handshake and only rejects inside
   * `handleConnection` (calling `client.disconnect(true)`) — so a rejected
   * client observes a brief `connect` followed by `disconnect`, not an
   * absence of `connect`. Same helper shape as SafetyGateway's own e2e test.
   */
  function connectAiSocketExpectingRejection(token?: string): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const socket = ioClient(`http://localhost:${wsPort}/realtime/ai-observations`, {
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
      tx.school.create({ data: { name: 'AI Test School A', slug: `ai-test-a-${suffix}`, contactEmail: `a-${suffix}@ai-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'AI Test School B', slug: `ai-test-b-${suffix}`, contactEmail: `b-${suffix}@ai-test.example` } }),
    );

    superAdmin = await makeStaff(schoolA.id, `super.${suffix}@ai-test.example`, 'SUPER_ADMIN', staffHash);
    adminA = await makeStaff(schoolA.id, `admin.a.${suffix}@ai-test.example`, 'SCHOOL_ADMIN', staffHash);
    managerA = await makeStaff(schoolA.id, `manager.a.${suffix}@ai-test.example`, 'TRANSPORT_MANAGER', staffHash);
    driverA = await makeStaff(schoolA.id, `driver.a.${suffix}@ai-test.example`, 'DRIVER', staffHash);
    attendantA = await makeStaff(schoolA.id, `attendant.a.${suffix}@ai-test.example`, 'BUS_ATTENDANT', staffHash);
    adminB = await makeStaff(schoolB.id, `admin.b.${suffix}@ai-test.example`, 'SCHOOL_ADMIN', staffHash);

    parentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9184009${suffix.toString().slice(-5)}`, fullName: 'Parent A', passwordHash: parentHash } }),
    );

    const driverProfileA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.driver.create({ data: { schoolId: schoolA.id, userId: driverA.id, licenseNumber: `LIC-AI-A-${suffix}` } }),
    );
    routeA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.route.create({ data: { schoolId: schoolA.id, code: `R-AI-${suffix}`, name: 'AI Test Route', direction: 'HOME_TO_SCHOOL', shift: 'MORNING_PICKUP' } }),
    );
    busA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `AI-A-${suffix}`, capacity: 40 } }));
    busA2 = await prisma.runInTenantContext(schoolA.id, (tx) => tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `AI-A2-${suffix}`, capacity: 40 } }));
    busB = await prisma.runInTenantContext(schoolB.id, (tx) => tx.bus.create({ data: { schoolId: schoolB.id, registrationNumber: `AI-B-${suffix}`, capacity: 30 } }));

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

    edgeDeviceA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA.id, deviceType: 'EDGE_COMPUTER', externalDeviceId: `EDGE-A-${suffix}` } }),
    );
    edgeDeviceB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolB.id, busId: busB.id, deviceType: 'EDGE_COMPUTER', externalDeviceId: `EDGE-B-${suffix}` } }),
    );
    gpsDeviceA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA.id, deviceType: 'GPS_TRACKER', externalDeviceId: `GPS-AI-${suffix}` } }),
    );

    const cameraDeviceA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA.id, deviceType: 'CAMERA_CONTROLLER', externalDeviceId: `CAM-DEV-A-${suffix}` } }),
    );
    cameraA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.camera.create({
        data: {
          schoolId: schoolA.id,
          busId: busA.id,
          busDeviceId: cameraDeviceA.id,
          cameraCode: `CAM-A-${suffix}`,
          name: 'Front Camera',
          position: 'FRONT',
          edgeDeviceId: edgeDeviceA.id,
        },
      }),
    );
    const cameraDeviceA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA.id, deviceType: 'CAMERA_CONTROLLER', externalDeviceId: `CAM-DEV-A2-${suffix}` } }),
    );
    cameraAUnassigned = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.camera.create({
        data: {
          schoolId: schoolA.id,
          busId: busA.id,
          busDeviceId: cameraDeviceA2.id,
          cameraCode: `CAM-A2-${suffix}`,
          name: 'Cabin Camera',
          position: 'CABIN',
        },
      }),
    );
    const cameraDeviceB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolB.id, busId: busB.id, deviceType: 'CAMERA_CONTROLLER', externalDeviceId: `CAM-DEV-B-${suffix}` } }),
    );
    cameraB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.camera.create({
        data: {
          schoolId: schoolB.id,
          busId: busB.id,
          busDeviceId: cameraDeviceB.id,
          cameraCode: `CAM-B-${suffix}`,
          name: 'Front Camera',
          position: 'FRONT',
          edgeDeviceId: edgeDeviceB.id,
        },
      }),
    );

    const superToken = await loginAs(superAdmin.email);
    const modelRes = await api()
      .post('/api/v1/ai-models')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: `test-model-${suffix}`, version: '1.0.0', provider: 'internal', modelType: 'OBJECT_DETECTION' });
    modelActive = modelRes.body;
    const inactiveRes = await api()
      .post('/api/v1/ai-models')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: `test-model-${suffix}`, version: '0.9.0', provider: 'internal', modelType: 'OBJECT_DETECTION' });
    modelInactive = inactiveRes.body;
    await api().post(`/api/v1/ai-models/${modelInactive.id}/deactivate`).set('Authorization', `Bearer ${superToken}`).send();

    const adminToken = await loginAs(adminA.email);
    const credA = await api().post(`/api/v1/devices/${edgeDeviceA.id}/credential`).set('Authorization', `Bearer ${adminToken}`).send();
    edgeCredentialA = credA.body.token;
    const adminBToken = await loginAs(adminB.email);
    const credB = await api().post(`/api/v1/devices/${edgeDeviceB.id}/credential`).set('Authorization', `Bearer ${adminBToken}`).send();
    edgeCredentialB = credB.body.token;
  });

  afterAll(async () => {
    for (const schoolId of [schoolA.id, schoolB.id]) {
      await prisma.runInTenantContext(schoolId, async (tx) => {
        await tx.aIObservation.deleteMany({ where: { schoolId } });
        await tx.camera.deleteMany({ where: { schoolId } });
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
    await prisma.aIModel.deleteMany({ where: { name: `test-model-${suffix}` } });
    await app.close();
  });

  // ---------------------------------------------------------------------
  // Edge device authentication
  // ---------------------------------------------------------------------
  describe('edge-AI device authentication', () => {
    it('missing credential is rejected (401)', async () => {
      const res = await api().post('/api/v1/edge-ai/observations').send(validObservationBody());
      expect(res.status).toBe(401);
    });

    it('invalid/garbage credential is rejected (401)', async () => {
      const res = await submitObservation('garbage-token-value', validObservationBody());
      expect(res.status).toBe(401);
    });

    it("a GPS tracker's credential cannot authenticate an edge-AI submission", async () => {
      const token = await loginAs(adminA.email);
      const gpsCred = await api().post(`/api/v1/devices/${gpsDeviceA.id}/credential`).set('Authorization', `Bearer ${token}`).send();
      const res = await submitObservation(gpsCred.body.token, validObservationBody());
      expect(res.status).toBe(401);
    });

    it('a valid edge-device credential authenticates a heartbeat and updates lastSeenAt', async () => {
      const hbRes = await api().post('/api/v1/edge-ai/heartbeat').set('Authorization', `Bearer ${edgeCredentialA}`).send({ firmwareVersion: '3.1.0' });
      expect(hbRes.status).toBe(200);

      const token = await loginAs(adminA.email);
      const deviceRes = await api().get(`/api/v1/devices/${edgeDeviceA.id}`).set('Authorization', `Bearer ${token}`);
      expect(deviceRes.body.lastSeenAt).not.toBeNull();
      expect(deviceRes.body.firmwareVersion).toBe('3.1.0');
    });

    it('rotating the credential invalidates the old one immediately', async () => {
      const token = await loginAs(adminA.email);
      const rotated = await api().post(`/api/v1/devices/${edgeDeviceA.id}/credential`).set('Authorization', `Bearer ${token}`).send();
      const oldRejected = await submitObservation(edgeCredentialA, validObservationBody());
      expect(oldRejected.status).toBe(401);

      const newAccepted = await submitObservation(rotated.body.token, validObservationBody());
      expect(newAccepted.status).toBe(201);
      edgeCredentialA = rotated.body.token; // keep subsequent tests working
    });

    it('a deactivated edge device credential no longer authenticates', async () => {
      const token = await loginAs(adminA.email);
      const tempDevice = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA.id, deviceType: 'EDGE_COMPUTER', externalDeviceId: `EDGE-TEMP-${suffix}` } }),
      );
      const credRes = await api().post(`/api/v1/devices/${tempDevice.id}/credential`).set('Authorization', `Bearer ${token}`).send();
      await api().post(`/api/v1/devices/${tempDevice.id}/deactivate`).set('Authorization', `Bearer ${token}`);

      const res = await submitObservation(credRes.body.token, validObservationBody());
      expect(res.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------
  // Ingestion + IDOR
  // ---------------------------------------------------------------------
  describe('observation ingestion', () => {
    it('a valid submission is accepted, tripId is server-resolved to the bus current trip, and the response never carries schoolId/edgeDeviceId ownership as client input', async () => {
      const res = await submitObservation(edgeCredentialA, validObservationBody({ detectionType: 'FALL_DETECTED', confidence: 0.88 }));
      expect(res.status).toBe(201);
      expect(res.body.busId).toBe(busA.id);
      expect(res.body.tripId).toBe(tripA.id);
      expect(res.body.status).toBe('CANDIDATE');
      expect(res.body.modelName).toBe(modelActive.name);
      expect(res.body.evidenceReference).toBeNull();
      expect(res.body).not.toHaveProperty('studentId');
    });

    it('a camera not assigned to this edge device is rejected (404) even though it is on the same bus/tenant', async () => {
      const res = await submitObservation(edgeCredentialA, validObservationBody({ cameraId: cameraAUnassigned.id }));
      expect(res.status).toBe(404);
    });

    it("a School B camera is rejected for School A's edge device (404)", async () => {
      const res = await submitObservation(edgeCredentialA, validObservationBody({ cameraId: cameraB.id }));
      expect(res.status).toBe(404);
    });

    it('an unknown model name/version is rejected (400)', async () => {
      const res = await submitObservation(edgeCredentialA, validObservationBody({ modelName: 'nonexistent-model', modelVersion: '9.9.9' }));
      expect(res.status).toBe(400);
    });

    it('an inactive (deactivated) model is rejected (400)', async () => {
      const res = await submitObservation(edgeCredentialA, validObservationBody({ modelName: modelInactive.name, modelVersion: modelInactive.version }));
      expect(res.status).toBe(400);
    });

    it('an out-of-bounds confidence value is rejected by validation (400)', async () => {
      const res = await submitObservation(edgeCredentialA, validObservationBody({ confidence: 1.5 }));
      expect(res.status).toBe(400);
    });

    it('an occurredAt too far in the future is rejected (400)', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const res = await submitObservation(edgeCredentialA, validObservationBody({ occurredAt: future }));
      expect(res.status).toBe(400);
    });

    it('an occurredAt too far in the past is rejected (400)', async () => {
      const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const res = await submitObservation(edgeCredentialA, validObservationBody({ occurredAt: past }));
      expect(res.status).toBe(400);
    });

    it('two detections of the same type from the same camera within the dedup window aggregate into one row', async () => {
      // Anchored to the start of the CURRENT 30s window (not "now" itself),
      // so both timestamps are guaranteed to land in the same window
      // regardless of exactly where in its own window "now" happens to
      // fall — avoids the boundary flakiness a plain `now`/`now+5s` pair
      // would have near a window edge.
      const windowMs = 30_000;
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
      const t1 = new Date(windowStart + 2000);
      const t2 = new Date(windowStart + 4000);
      const first = await submitObservation(edgeCredentialA, validObservationBody({ detectionType: 'UNUSUAL_MOTION', confidence: 0.5, occurredAt: t1.toISOString() }));
      expect(first.status).toBe(201);
      const second = await submitObservation(
        edgeCredentialA,
        validObservationBody({ detectionType: 'UNUSUAL_MOTION', confidence: 0.75, occurredAt: t2.toISOString() }),
      );
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.confidence).toBe(0.75);

      const countRes = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.aIObservation.count({ where: { schoolId: schoolA.id, cameraId: cameraA.id, detectionType: 'UNUSUAL_MOTION' } }),
      );
      expect(countRes).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // Staff reads + RBAC
  // ---------------------------------------------------------------------
  describe('staff reads + RBAC', () => {
    it('SCHOOL_ADMIN and TRANSPORT_MANAGER can list and read observations', async () => {
      for (const email of [adminA.email, managerA.email]) {
        const token = await loginAs(email);
        const listRes = await api().get('/api/v1/ai-observations').set('Authorization', `Bearer ${token}`);
        expect(listRes.status).toBe(200);
        expect(listRes.body.data.length).toBeGreaterThan(0);

        const id = listRes.body.data[0].id;
        const getRes = await api().get(`/api/v1/ai-observations/${id}`).set('Authorization', `Bearer ${token}`);
        expect(getRes.status).toBe(200);
      }
    });

    it('filters by detectionType/busId/cameraId work', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().get(`/api/v1/ai-observations?detectionType=FALL_DETECTED&busId=${busA.id}&cameraId=${cameraA.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.every((o: { detectionType: string }) => o.detectionType === 'FALL_DETECTED')).toBe(true);
    });

    it('DRIVER and BUS_ATTENDANT have no AI observation access at all (403)', async () => {
      for (const email of [driverA.email, attendantA.email]) {
        const token = await loginAs(email);
        const res = await api().get('/api/v1/ai-observations').set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
      }
    });

    it('a parent has zero AI observation access (403), no route leaks any detail', async () => {
      const token = await loginParentAs(parentA.phone);
      const listRes = await api().get('/api/v1/ai-observations').set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(403);
      const statusRes = await api().get('/api/v1/ai-observations/provider-status').set('Authorization', `Bearer ${token}`);
      expect(statusRes.status).toBe(403);
    });

    it("School B admin cannot read School A's observation (404)", async () => {
      const token = await loginAs(adminA.email);
      const listRes = await api().get('/api/v1/ai-observations').set('Authorization', `Bearer ${token}`);
      const observationId = listRes.body.data[0].id;

      const tokenB = await loginAs(adminB.email);
      const res = await api().get(`/api/v1/ai-observations/${observationId}`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
    });

    it('provider status is honest: AI_NOT_CONFIGURED by default, never a fabricated ONLINE state', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().get('/api/v1/ai-observations/provider-status').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('AI_NOT_CONFIGURED');
    });
  });

  // ---------------------------------------------------------------------
  // AI model registry (platform-wide, SUPER_ADMIN only)
  // ---------------------------------------------------------------------
  describe('AI model registry', () => {
    it('SUPER_ADMIN can register, activate, deactivate, and deprecate a model version', async () => {
      const token = await loginAs(superAdmin.email);
      const created = await api()
        .post('/api/v1/ai-models')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `lifecycle-model-${suffix}`, version: '1.0.0', provider: 'internal', modelType: 'ACTION_RECOGNITION' });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('ACTIVE');

      const deactivated = await api().post(`/api/v1/ai-models/${created.body.id}/deactivate`).set('Authorization', `Bearer ${token}`).send();
      expect(deactivated.status).toBe(200);
      expect(deactivated.body.status).toBe('INACTIVE');

      const reactivated = await api().post(`/api/v1/ai-models/${created.body.id}/activate`).set('Authorization', `Bearer ${token}`).send();
      expect(reactivated.status).toBe(200);
      expect(reactivated.body.status).toBe('ACTIVE');

      const deprecated = await api().post(`/api/v1/ai-models/${created.body.id}/deprecate`).set('Authorization', `Bearer ${token}`).send();
      expect(deprecated.status).toBe(200);
      expect(deprecated.body.status).toBe('DEPRECATED');

      const afterDeprecate = await api().post(`/api/v1/ai-models/${created.body.id}/activate`).set('Authorization', `Bearer ${token}`).send();
      expect(afterDeprecate.status).toBe(400);

      await prisma.aIModel.delete({ where: { id: created.body.id } });
    });

    it('registering a duplicate (name, version) is rejected (400), not a server error', async () => {
      const token = await loginAs(superAdmin.email);
      const res = await api()
        .post('/api/v1/ai-models')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: modelActive.name, version: modelActive.version, provider: 'internal', modelType: 'OBJECT_DETECTION' });
      expect(res.status).toBe(400);
    });

    it('a school-level SCHOOL_ADMIN has no access to the model registry at all (403)', async () => {
      const token = await loginAs(adminA.email);
      const listRes = await api().get('/api/v1/ai-models').set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(403);
      const createRes = await api()
        .post('/api/v1/ai-models')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'sneaky-model', version: '1.0.0', provider: 'internal', modelType: 'OBJECT_DETECTION' });
      expect(createRes.status).toBe(403);
    });

    it('a parent has no access to the model registry (403)', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get('/api/v1/ai-models').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Camera <-> edge-device association
  // ---------------------------------------------------------------------
  describe('camera edge-device association', () => {
    it('staff can assign a camera to an EDGE_COMPUTER device on the same bus/tenant', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().patch(`/api/v1/cameras/${cameraAUnassigned.id}`).set('Authorization', `Bearer ${token}`).send({ edgeDeviceId: edgeDeviceA.id });
      expect(res.status).toBe(200);
      expect(res.body.edgeDeviceId).toBe(edgeDeviceA.id);

      // Unassign again so it doesn't interfere with the ingestion IDOR test above if the suite re-runs.
      await api().patch(`/api/v1/cameras/${cameraAUnassigned.id}`).set('Authorization', `Bearer ${token}`).send({ edgeDeviceId: null });
    });

    it('cannot assign a non-EDGE_COMPUTER device (e.g. a GPS tracker) as a camera edge device (404)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().patch(`/api/v1/cameras/${cameraAUnassigned.id}`).set('Authorization', `Bearer ${token}`).send({ edgeDeviceId: gpsDeviceA.id });
      expect(res.status).toBe(404);
    });

    it('cannot assign an edge device from a different bus (404)', async () => {
      const token = await loginAs(adminA.email);
      const otherBusEdge = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA2.id, deviceType: 'EDGE_COMPUTER', externalDeviceId: `EDGE-A2-${suffix}` } }),
      );
      const res = await api().patch(`/api/v1/cameras/${cameraAUnassigned.id}`).set('Authorization', `Bearer ${token}`).send({ edgeDeviceId: otherBusEdge.id });
      expect(res.status).toBe(404);
    });

    it("cannot assign a different school's edge device (404)", async () => {
      const token = await loginAs(adminA.email);
      const res = await api().patch(`/api/v1/cameras/${cameraAUnassigned.id}`).set('Authorization', `Bearer ${token}`).send({ edgeDeviceId: edgeDeviceB.id });
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // Realtime
  // ---------------------------------------------------------------------
  describe('realtime', () => {
    it('an authorized staff socket receives ai.observation.created for a genuinely new observation', async () => {
      const token = await loginAs(adminA.email);
      const socket = await connectAiSocket(token);
      try {
        const eventPromise = new Promise((resolvePromise) => socket.once('ai.observation.created', resolvePromise));
        const res = await submitObservation(edgeCredentialA, validObservationBody({ detectionType: 'DOOR_STATE_DETECTED', confidence: 0.8 }));
        expect(res.status).toBe(201);
        const event = (await eventPromise) as { id: string; detectionType: string };
        expect(event.id).toBe(res.body.id);
        expect(event.detectionType).toBe('DOOR_STATE_DETECTED');
      } finally {
        socket.disconnect();
      }
    });

    it('a parent/no-token/DRIVER connection is rejected identically', async () => {
      await connectAiSocketExpectingRejection();
      const parentToken = await loginParentAs(parentA.phone);
      await connectAiSocketExpectingRejection(parentToken);
      const driverToken = await loginAs(driverA.email);
      await connectAiSocketExpectingRejection(driverToken);
    });
  });

  // ---------------------------------------------------------------------
  // RLS (direct Postgres, restricted app_user connection)
  // ---------------------------------------------------------------------
  describe('Row-Level Security', () => {
    it('ai_observations: a query with no tenant context set sees zero rows', async () => {
      const visible = await prisma.aIObservation.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
      expect(visible).toEqual([]);
    });

    it('ai_observations: School A context sees only School A rows, School B context sees only School B rows', async () => {
      await submitObservation(edgeCredentialB, {
        cameraId: cameraB.id,
        detectionType: 'PERSON_DETECTED',
        confidence: 0.7,
        occurredAt: new Date().toISOString(),
        modelName: modelActive.name,
        modelVersion: modelActive.version,
      });

      const visibleFromA = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.aIObservation.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } }),
      );
      expect(visibleFromA.length).toBeGreaterThan(0);
      expect(visibleFromA.every((o) => o.schoolId === schoolA.id)).toBe(true);

      const visibleFromB = await prisma.runInTenantContext(schoolB.id, (tx) =>
        tx.aIObservation.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } }),
      );
      expect(visibleFromB.length).toBeGreaterThan(0);
      expect(visibleFromB.every((o) => o.schoolId === schoolB.id)).toBe(true);
    });

    it('ai_models: platform-wide, readable regardless of tenant context (no RLS policy on this table by design)', async () => {
      const visible = await prisma.aIModel.findMany({ where: { id: modelActive.id } });
      expect(visible.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------
  it('pagination: list respects limit and returns a usable nextCursor', async () => {
    const token = await loginAs(adminA.email);
    const res = await api().get('/api/v1/ai-observations?limit=1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(typeof res.body.nextCursor === 'string' || res.body.nextCursor === null).toBe(true);
  });
});
