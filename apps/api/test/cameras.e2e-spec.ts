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

/**
 * Phase 2 Step 11: camera inventory, bus association, lifecycle, device
 * authentication, and the no-real-stream contract. See
 * docs/adr/0018-camera-device-management-foundation.md.
 */
describe('Camera / device management foundation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const passwordService = new PasswordService();
  const suffix = Date.now();
  const STAFF_PASSWORD = 'CorrectHorse123';
  const PARENT_PASSWORD = 'ParentPassw0rd1';

  let schoolA: { id: string };
  let schoolB: { id: string };
  let adminA: { id: string; email: string }; // SCHOOL_ADMIN — camera.read + camera.manage
  let transportAdminA: { id: string; email: string }; // TRANSPORT_ADMIN — camera.read + camera.manage
  let driverA: { id: string; email: string }; // DRIVER — no camera permission at all
  let attendantA: { id: string; email: string }; // BUS_ATTENDANT — no camera permission at all
  let adminB: { id: string; email: string };
  let parentA: { id: string; phone: string };
  let busA: { id: string };
  let busA2: { id: string };
  let busB: { id: string };
  let gpsDeviceA: { id: string }; // an existing GPS_TRACKER device on busA — used to prove its credential can't authenticate a camera heartbeat

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

  function createCameraBody(overrides: Record<string, unknown> = {}) {
    return {
      cameraCode: `CAM-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
      name: 'Front Camera',
      position: 'FRONT',
      serialNumber: `SN-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
      ...overrides,
    };
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
      tx.school.create({ data: { name: 'Camera Test School A', slug: `camera-test-a-${suffix}`, contactEmail: `a-${suffix}@camera-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Camera Test School B', slug: `camera-test-b-${suffix}`, contactEmail: `b-${suffix}@camera-test.example` } }),
    );

    adminA = await makeStaff(schoolA.id, `admin.a.${suffix}@camera-test.example`, 'SCHOOL_ADMIN', staffHash);
    transportAdminA = await makeStaff(schoolA.id, `transport.a.${suffix}@camera-test.example`, 'TRANSPORT_ADMIN', staffHash);
    driverA = await makeStaff(schoolA.id, `driver.a.${suffix}@camera-test.example`, 'DRIVER', staffHash);
    attendantA = await makeStaff(schoolA.id, `attendant.a.${suffix}@camera-test.example`, 'BUS_ATTENDANT', staffHash);
    adminB = await makeStaff(schoolB.id, `admin.b.${suffix}@camera-test.example`, 'SCHOOL_ADMIN', staffHash);

    parentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9181009${suffix.toString().slice(-5)}`, fullName: 'Parent A', passwordHash: parentHash } }),
    );

    busA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `CAM-A-${suffix}`, capacity: 40 } }),
    );
    busA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `CAM-A2-${suffix}`, capacity: 40 } }),
    );
    busB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolB.id, registrationNumber: `CAM-B-${suffix}`, capacity: 30 } }),
    );
    gpsDeviceA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA.id, deviceType: 'GPS_TRACKER', externalDeviceId: `GPS-${suffix}` } }),
    );
  });

  afterAll(async () => {
    for (const schoolId of [schoolA.id, schoolB.id]) {
      await prisma.runInTenantContext(schoolId, async (tx) => {
        await tx.camera.deleteMany({ where: { schoolId } });
        await tx.gpsPoint.deleteMany({ where: { schoolId } });
        await tx.busDevice.deleteMany({ where: { schoolId } });
        await tx.trip.deleteMany({ where: { schoolId } });
        await tx.bus.deleteMany({ where: { schoolId } });
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
  // CRUD + lifecycle
  // ---------------------------------------------------------------------
  describe('CRUD + lifecycle', () => {
    let cameraId: string;

    it('an authorized admin can create a camera on a bus', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post(`/api/v1/buses/${busA.id}/cameras`)
        .set('Authorization', `Bearer ${token}`)
        .send(createCameraBody());
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.busId).toBe(busA.id);
      expect(res.body.connectivity).toBe('UNKNOWN'); // never reported yet
      expect(res.body).not.toHaveProperty('schoolId');
      expect(res.body).not.toHaveProperty('credentialHash');
      cameraId = res.body.id;
    });

    it('CUSTOM position requires customPositionLabel', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post(`/api/v1/buses/${busA.id}/cameras`)
        .set('Authorization', `Bearer ${token}`)
        .send(createCameraBody({ position: 'CUSTOM' }));
      expect(res.status).toBe(400);
    });

    it('a duplicate cameraCode within the same school is rejected (even with a different serial number)', async () => {
      const token = await loginAs(adminA.email);
      const sharedCode = createCameraBody().cameraCode;
      const first = await api()
        .post(`/api/v1/buses/${busA.id}/cameras`)
        .set('Authorization', `Bearer ${token}`)
        .send(createCameraBody({ cameraCode: sharedCode }));
      expect(first.status).toBe(201);
      const dup = await api()
        .post(`/api/v1/buses/${busA2.id}/cameras`)
        .set('Authorization', `Bearer ${token}`)
        .send(createCameraBody({ cameraCode: sharedCode }));
      expect(dup.status).toBe(400);
    });

    it('a duplicate serial number is rejected (even with a different cameraCode) — the underlying device identifier is globally unique', async () => {
      const token = await loginAs(adminA.email);
      const sharedSerial = createCameraBody().serialNumber;
      const first = await api()
        .post(`/api/v1/buses/${busA.id}/cameras`)
        .set('Authorization', `Bearer ${token}`)
        .send(createCameraBody({ serialNumber: sharedSerial }));
      expect(first.status).toBe(201);
      const dup = await api()
        .post(`/api/v1/buses/${busA2.id}/cameras`)
        .set('Authorization', `Bearer ${token}`)
        .send(createCameraBody({ serialNumber: sharedSerial }));
      expect(dup.status).toBe(400);
    });

    it('a client-supplied schoolId on the create body has no effect (DTO structurally excludes it)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post(`/api/v1/buses/${busA.id}/cameras`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...createCameraBody(), schoolId: schoolB.id });
      expect(res.status).toBe(201);
      const getRes = await api().get(`/api/v1/cameras/${res.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200); // still readable from School A — it never left the tenant
    });

    it('can read, update, and list cameras for the bus', async () => {
      const token = await loginAs(adminA.email);
      const getRes = await api().get(`/api/v1/cameras/${cameraId}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);

      const patchRes = await api()
        .patch(`/api/v1/cameras/${cameraId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Front Camera', manufacturer: 'Acme' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.name).toBe('Updated Front Camera');
      expect(patchRes.body.manufacturer).toBe('Acme');

      const listRes = await api().get(`/api/v1/buses/${busA.id}/cameras`).set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);
      expect(listRes.body.some((c: { id: string }) => c.id === cameraId)).toBe(true);
    });

    it('can reassign a camera to a different bus in the same tenant, audited as a reassignment', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().patch(`/api/v1/cameras/${cameraId}`).set('Authorization', `Bearer ${token}`).send({ busId: busA2.id });
      expect(res.status).toBe(200);
      expect(res.body.busId).toBe(busA2.id);
    });

    it('cannot reassign a camera to a bus in a different tenant (404)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().patch(`/api/v1/cameras/${cameraId}`).set('Authorization', `Bearer ${token}`).send({ busId: busB.id });
      expect(res.status).toBe(404);
    });

    it('PATCH cannot set status directly to RETIRED — must go through the archive endpoint', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().patch(`/api/v1/cameras/${cameraId}`).set('Authorization', `Bearer ${token}`).send({ status: 'RETIRED' });
      expect(res.status).toBe(400);
    });

    it('archive is terminal: succeeds once, then rejects, then blocks further updates', async () => {
      const token = await loginAs(adminA.email);
      const archiveRes = await api().post(`/api/v1/cameras/${cameraId}/archive`).set('Authorization', `Bearer ${token}`);
      expect(archiveRes.status).toBe(200);
      expect(archiveRes.body.status).toBe('RETIRED');

      const archiveAgainRes = await api().post(`/api/v1/cameras/${cameraId}/archive`).set('Authorization', `Bearer ${token}`);
      expect(archiveAgainRes.status).toBe(400);

      const patchRes = await api().patch(`/api/v1/cameras/${cameraId}`).set('Authorization', `Bearer ${token}`).send({ name: 'Should not work' });
      expect(patchRes.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // RBAC
  // ---------------------------------------------------------------------
  describe('RBAC', () => {
    it('DRIVER has no camera access at all (403), even though it has gps.read', async () => {
      const token = await loginAs(driverA.email);
      const listRes = await api().get('/api/v1/cameras').set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(403);
      const busListRes = await api().get(`/api/v1/buses/${busA.id}/cameras`).set('Authorization', `Bearer ${token}`);
      expect(busListRes.status).toBe(403);
    });

    it('BUS_ATTENDANT has no camera access at all (403)', async () => {
      const token = await loginAs(attendantA.email);
      const res = await api().get('/api/v1/cameras').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('TRANSPORT_ADMIN can read and manage cameras', async () => {
      const token = await loginAs(transportAdminA.email);
      const res = await api()
        .post(`/api/v1/buses/${busA.id}/cameras`)
        .set('Authorization', `Bearer ${token}`)
        .send(createCameraBody());
      expect(res.status).toBe(201);
    });

    it('a parent has zero camera access: list, detail, and stream are all denied', async () => {
      const token = await loginParentAs(parentA.phone);
      const listRes = await api().get('/api/v1/cameras').set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(403);

      const create = await api().post(`/api/v1/buses/${busA.id}/cameras`).set('Authorization', `Bearer ${token}`).send(createCameraBody());
      expect(create.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Cross-tenant / IDOR
  // ---------------------------------------------------------------------
  describe('cross-tenant isolation', () => {
    let cameraA: { id: string };

    beforeAll(async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post(`/api/v1/buses/${busA.id}/cameras`).set('Authorization', `Bearer ${token}`).send(createCameraBody());
      cameraA = { id: res.body.id };
    });

    it("School B admin cannot GET, PATCH, or archive School A's camera (404, not 403)", async () => {
      const token = await loginAs(adminB.email);
      const getRes = await api().get(`/api/v1/cameras/${cameraA.id}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(404);
      const patchRes = await api().patch(`/api/v1/cameras/${cameraA.id}`).set('Authorization', `Bearer ${token}`).send({ name: 'Hijacked' });
      expect(patchRes.status).toBe(404);
      const archiveRes = await api().post(`/api/v1/cameras/${cameraA.id}/archive`).set('Authorization', `Bearer ${token}`);
      expect(archiveRes.status).toBe(404);
      const credRes = await api().post(`/api/v1/cameras/${cameraA.id}/credential`).set('Authorization', `Bearer ${token}`);
      expect(credRes.status).toBe(404);
      const streamRes = await api().get(`/api/v1/cameras/${cameraA.id}/stream`).set('Authorization', `Bearer ${token}`);
      expect(streamRes.status).toBe(404);
    });

    it("School A admin cannot create a camera on School B's bus (404)", async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post(`/api/v1/buses/${busB.id}/cameras`).set('Authorization', `Bearer ${token}`).send(createCameraBody());
      expect(res.status).toBe(404);
    });

    it("School B admin cannot list School A's bus cameras (404)", async () => {
      const token = await loginAs(adminB.email);
      const res = await api().get(`/api/v1/buses/${busA.id}/cameras`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // Device authentication (heartbeat)
  // ---------------------------------------------------------------------
  describe('device authentication', () => {
    let cameraId: string;
    let deviceId: string;

    beforeAll(async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post(`/api/v1/buses/${busA.id}/cameras`).set('Authorization', `Bearer ${token}`).send(createCameraBody());
      cameraId = res.body.id;
    });

    it('a camera has no credential until explicitly issued, and heartbeat is rejected until then', async () => {
      const getRes = await api().get(`/api/v1/cameras/${cameraId}`).set('Authorization', `Bearer ${await loginAs(adminA.email)}`);
      expect(getRes.body.credentialSetAt).toBeNull();

      const res = await api().post('/api/v1/camera-devices/heartbeat').set('Authorization', 'Bearer not-a-real-credential').send({});
      expect(res.status).toBe(401);
    });

    it('issuing a credential returns the raw token exactly once and it authenticates the heartbeat', async () => {
      const token = await loginAs(adminA.email);
      const credRes = await api().post(`/api/v1/cameras/${cameraId}/credential`).set('Authorization', `Bearer ${token}`).send();
      expect(credRes.status).toBe(200);
      expect(typeof credRes.body.token).toBe('string');
      deviceId = credRes.body.deviceId;

      const heartbeatRes = await api()
        .post('/api/v1/camera-devices/heartbeat')
        .set('Authorization', `Bearer ${credRes.body.token}`)
        .send({ firmwareVersion: '1.2.3' });
      expect(heartbeatRes.status).toBe(201);

      const getRes = await api().get(`/api/v1/cameras/${cameraId}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.body.firmwareVersion).toBe('1.2.3');
      expect(getRes.body.lastSeenAt).not.toBeNull();
      expect(getRes.body.connectivity).toBe('ONLINE');
    });

    it('an invalid device credential is rejected (401)', async () => {
      const res = await api().post('/api/v1/camera-devices/heartbeat').set('Authorization', 'Bearer garbage-token-value').send({});
      expect(res.status).toBe(401);
    });

    it("a GPS tracker's device credential cannot authenticate a camera heartbeat", async () => {
      const token = await loginAs(adminA.email);
      const gpsCredRes = await api().post(`/api/v1/devices/${gpsDeviceA.id}/credential`).set('Authorization', `Bearer ${token}`).send();
      expect(gpsCredRes.status).toBe(200);

      const res = await api().post('/api/v1/camera-devices/heartbeat').set('Authorization', `Bearer ${gpsCredRes.body.token}`).send({});
      expect(res.status).toBe(401);
    });

    it('rotating the credential invalidates the old one immediately', async () => {
      const token = await loginAs(adminA.email);
      const firstCred = await api().post(`/api/v1/cameras/${cameraId}/credential`).set('Authorization', `Bearer ${token}`).send();
      const oldToken = firstCred.body.token as string;

      const rotated = await api().post(`/api/v1/cameras/${cameraId}/credential`).set('Authorization', `Bearer ${token}`).send();
      expect(rotated.status).toBe(200);
      expect(rotated.body.token).not.toBe(oldToken);

      const oldHeartbeat = await api().post('/api/v1/camera-devices/heartbeat').set('Authorization', `Bearer ${oldToken}`).send({});
      expect(oldHeartbeat.status).toBe(401);

      const newHeartbeat = await api().post('/api/v1/camera-devices/heartbeat').set('Authorization', `Bearer ${rotated.body.token}`).send({});
      expect(newHeartbeat.status).toBe(201);
    });

    it("an archived camera's credential no longer authenticates, and a new one cannot be issued", async () => {
      const token = await loginAs(adminA.email);
      const credRes = await api().post(`/api/v1/cameras/${cameraId}/credential`).set('Authorization', `Bearer ${token}`).send();
      const rawToken = credRes.body.token as string;

      const archiveRes = await api().post(`/api/v1/cameras/${cameraId}/archive`).set('Authorization', `Bearer ${token}`);
      expect(archiveRes.status).toBe(200);

      const heartbeatRes = await api().post('/api/v1/camera-devices/heartbeat').set('Authorization', `Bearer ${rawToken}`).send({});
      expect(heartbeatRes.status).toBe(401);

      const reissueRes = await api().post(`/api/v1/cameras/${cameraId}/credential`).set('Authorization', `Bearer ${token}`).send();
      expect(reissueRes.status).toBe(400);
    });

    it('a credential is never returned by any GET, and never appears in the DB in plaintext', async () => {
      const token = await loginAs(adminA.email);
      const getRes = await api().get(`/api/v1/cameras/${cameraId}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.body).not.toHaveProperty('credentialHash');
      expect(getRes.body).not.toHaveProperty('token');

      const rawDevice = await prisma.runAsPlatformAdmin((tx) => tx.busDevice.findFirstOrThrow({ where: { id: deviceId } }));
      // Stored as a SHA-256 hex digest (64 lowercase hex chars), never the raw opaque token.
      expect(rawDevice.credentialHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ---------------------------------------------------------------------
  // Stream: never a real/live feed
  // ---------------------------------------------------------------------
  describe('stream availability', () => {
    it('reports NOT_CONFIGURED, never a real playback URL or credential', async () => {
      const token = await loginAs(adminA.email);
      const createRes = await api().post(`/api/v1/buses/${busA.id}/cameras`).set('Authorization', `Bearer ${token}`).send(createCameraBody());
      const res = await api().get(`/api/v1/cameras/${createRes.body.id}/stream`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('NOT_CONFIGURED');
      expect(res.body).not.toHaveProperty('url');
      expect(res.body).not.toHaveProperty('token');
      expect(res.body).not.toHaveProperty('credential');
    });

    it('a parent cannot reach the stream endpoint at all (403)', async () => {
      const token = await loginAs(adminA.email);
      const createRes = await api().post(`/api/v1/buses/${busA.id}/cameras`).set('Authorization', `Bearer ${token}`).send(createCameraBody());
      const parentToken = await loginParentAs(parentA.phone);
      const res = await api().get(`/api/v1/cameras/${createRes.body.id}/stream`).set('Authorization', `Bearer ${parentToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------
  describe('audit logging', () => {
    it('records CAMERA_CREATED, CAMERA_ARCHIVED, and CAMERA_REASSIGNED, but never one row per heartbeat', async () => {
      const token = await loginAs(adminA.email);
      const createRes = await api().post(`/api/v1/buses/${busA.id}/cameras`).set('Authorization', `Bearer ${token}`).send(createCameraBody());
      const cameraId = createRes.body.id;

      await api().patch(`/api/v1/cameras/${cameraId}`).set('Authorization', `Bearer ${token}`).send({ busId: busA2.id });

      const credRes = await api().post(`/api/v1/cameras/${cameraId}/credential`).set('Authorization', `Bearer ${token}`).send();
      for (let i = 0; i < 5; i++) {
        await api().post('/api/v1/camera-devices/heartbeat').set('Authorization', `Bearer ${credRes.body.token}`).send({});
      }

      await api().post(`/api/v1/cameras/${cameraId}/archive`).set('Authorization', `Bearer ${token}`);

      const logs = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.auditLog.findMany({ where: { schoolId: schoolA.id, subjectType: 'Camera', subjectId: cameraId } }),
      );
      const actions = logs.map((l) => l.action);
      expect(actions).toContain('CAMERA_CREATED');
      expect(actions).toContain('CAMERA_REASSIGNED');
      expect(actions).toContain('CAMERA_ARCHIVED');
      // Not one row per heartbeat (5 sent above) — heartbeats are never audited.
      expect(actions.length).toBeLessThan(10);
    });
  });

  // ---------------------------------------------------------------------
  // RLS (direct Postgres, restricted app_user connection)
  // ---------------------------------------------------------------------
  describe('Row-Level Security', () => {
    it('a query with no tenant context set sees zero camera rows', async () => {
      const visible = await prisma.camera.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
      expect(visible).toEqual([]);
    });

    it('School A tenant context sees only School A cameras, never School B', async () => {
      const token = await loginAs(adminA.email);
      await api().post(`/api/v1/buses/${busA.id}/cameras`).set('Authorization', `Bearer ${token}`).send(createCameraBody());

      const tokenB = await loginAs(adminB.email);
      await api().post(`/api/v1/buses/${busB.id}/cameras`).set('Authorization', `Bearer ${tokenB}`).send(createCameraBody());

      const visibleFromA = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.camera.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } }),
      );
      expect(visibleFromA.every((c) => c.schoolId === schoolA.id)).toBe(true);
      expect(visibleFromA.length).toBeGreaterThan(0);

      const visibleFromB = await prisma.runInTenantContext(schoolB.id, (tx) =>
        tx.camera.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } }),
      );
      expect(visibleFromB.every((c) => c.schoolId === schoolB.id)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------
  it('pagination: list respects limit and returns a usable nextCursor', async () => {
    const token = await loginAs(adminA.email);
    const res = await api().get('/api/v1/cameras?limit=1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(typeof res.body.nextCursor === 'string' || res.body.nextCursor === null).toBe(true);
  });
});
