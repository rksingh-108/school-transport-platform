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
 * Phase 3 Step 15: the AI-observation human-review/promotion workflow,
 * per-school AI safety policies, SafetyEvent linkage, and safety
 * analytics. See docs/adr/0022-ai-observation-review-and-safety-analytics.md.
 */
describe('AI observation review + safety analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wsPort: number;
  const passwordService = new PasswordService();
  const suffix = Date.now();
  const STAFF_PASSWORD = 'CorrectHorse123';
  const PARENT_PASSWORD = 'ParentPassw0rd1';

  let schoolA: { id: string };
  let schoolB: { id: string };
  let adminA: { id: string; email: string }; // SCHOOL_ADMIN — ai_events.review + ai_safety_policies.manage + safety_analytics.read
  let managerA: { id: string; email: string }; // TRANSPORT_MANAGER — ai_events.review + ai_safety_policies.read (no manage)
  let driverA: { id: string; email: string };
  let adminB: { id: string; email: string };
  let parentA: { id: string; phone: string };
  let busA: { id: string };
  let cameraA: { id: string };
  let edgeCredentialA: string;
  let modelA: { name: string; version: string };

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

  function connectSafetySocket(token: string): Promise<ClientSocket> {
    return new Promise((resolvePromise, reject) => {
      const socket = ioClient(`http://localhost:${wsPort}/realtime/safety`, { auth: { token }, reconnection: false, timeout: 3000, transports: ['websocket'] });
      const timer = setTimeout(() => reject(new Error('connect timed out')), 4000);
      socket.on('connect', () => { clearTimeout(timer); resolvePromise(socket); });
      socket.on('connect_error', (err) => { clearTimeout(timer); reject(err); });
    });
  }

  // Every call to ingestObservation() below defaults to the same camera +
  // edge device + detectionType ('FALL_DETECTED') — the exact dedup key
  // AiObservationsService.ingest() collapses repeated detections on (see
  // docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md's
  // temporal-aggregation decision). Using `new Date()` directly for
  // `occurredAt` would let two calls made within the same 30s dedup window
  // silently collapse into the SAME row (updating it, not creating a new
  // one) — exactly the "shared resource + relative timestamps" pitfall
  // documented in the geofencing e2e suite. This monotonic counter, jumped
  // forward by more than the dedup window on every call, guarantees each
  // call lands in its own window and therefore creates a genuinely new,
  // independent CANDIDATE observation.
  // Anchored well in the past (within AI_OBSERVATION_MAX_PAST_AGE_SECONDS'
  // default 1-hour bound) so that, even after every call in this file has
  // advanced it forward by 35s, it can never cross into
  // AI_OBSERVATION_MAX_FUTURE_SKEW_SECONDS' future bound.
  let simulatedClockMs = Date.now() - 50 * 60 * 1000;
  function nextOccurredAt(): string {
    simulatedClockMs += 35_000;
    return new Date(simulatedClockMs).toISOString();
  }

  /** Creates a fresh CANDIDATE observation via the real device-ingestion endpoint, at a given confidence/detectionType. */
  async function ingestObservation(overrides: { detectionType?: string; confidence?: number } = {}) {
    const res = await api()
      .post('/api/v1/edge-ai/observations')
      .set('Authorization', `Bearer ${edgeCredentialA}`)
      .send({
        cameraId: cameraA.id,
        detectionType: overrides.detectionType ?? 'FALL_DETECTED',
        confidence: overrides.confidence ?? 0.95,
        occurredAt: nextOccurredAt(),
        modelName: modelA.name,
        modelVersion: modelA.version,
      });
    return res.body as { id: string; status: string };
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
      tx.school.create({ data: { name: 'AI Review Test School A', slug: `ai-review-a-${suffix}`, contactEmail: `a-${suffix}@ai-review-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'AI Review Test School B', slug: `ai-review-b-${suffix}`, contactEmail: `b-${suffix}@ai-review-test.example` } }),
    );

    adminA = await makeStaff(schoolA.id, `admin.a.${suffix}@ai-review-test.example`, 'SCHOOL_ADMIN', staffHash);
    managerA = await makeStaff(schoolA.id, `manager.a.${suffix}@ai-review-test.example`, 'TRANSPORT_MANAGER', staffHash);
    driverA = await makeStaff(schoolA.id, `driver.a.${suffix}@ai-review-test.example`, 'DRIVER', staffHash);
    adminB = await makeStaff(schoolB.id, `admin.b.${suffix}@ai-review-test.example`, 'SCHOOL_ADMIN', staffHash);

    parentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9185009${suffix.toString().slice(-5)}`, fullName: 'Parent A', passwordHash: parentHash } }),
    );

    busA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `AIR-A-${suffix}`, capacity: 40 } }));
    const edgeDeviceA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA.id, deviceType: 'EDGE_COMPUTER', externalDeviceId: `EDGE-AIR-A-${suffix}` } }),
    );
    const cameraDeviceA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA.id, deviceType: 'CAMERA_CONTROLLER', externalDeviceId: `CAM-DEV-AIR-A-${suffix}` } }),
    );
    cameraA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.camera.create({
        data: { schoolId: schoolA.id, busId: busA.id, busDeviceId: cameraDeviceA.id, cameraCode: `CAM-AIR-A-${suffix}`, name: 'Front', position: 'FRONT', edgeDeviceId: edgeDeviceA.id },
      }),
    );

    const superAdmin = await makeStaff(schoolA.id, `super.${suffix}@ai-review-test.example`, 'SUPER_ADMIN', staffHash);
    const superToken = await loginAs(superAdmin.email);
    const modelRes = await api()
      .post('/api/v1/ai-models')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: `ai-review-model-${suffix}`, version: '1.0.0', provider: 'internal', modelType: 'ACTION_RECOGNITION' });
    modelA = { name: modelRes.body.name, version: modelRes.body.version };

    const adminToken = await loginAs(adminA.email);
    const credA = await api().post(`/api/v1/devices/${edgeDeviceA.id}/credential`).set('Authorization', `Bearer ${adminToken}`).send();
    edgeCredentialA = credA.body.token;

    // Enable FALL_DETECTED for promotion at School A — the policy every
    // "successful promotion" test below relies on.
    const policyRes = await api()
      .post('/api/v1/ai-safety-policies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ detectionType: 'FALL_DETECTED', minimumConfidence: 0.85, defaultSeverity: 'HIGH' });
    await api().post(`/api/v1/ai-safety-policies/${policyRes.body.id}/enable`).set('Authorization', `Bearer ${adminToken}`).send();
  });

  afterAll(async () => {
    for (const schoolId of [schoolA.id, schoolB.id]) {
      await prisma.runInTenantContext(schoolId, async (tx) => {
        await tx.notificationDelivery.deleteMany({ where: { schoolId } });
        await tx.notification.deleteMany({ where: { schoolId } });
        await tx.safetyEvent.deleteMany({ where: { schoolId } });
        await tx.aIObservation.deleteMany({ where: { schoolId } });
        await tx.aiSafetyPolicy.deleteMany({ where: { schoolId } });
        await tx.camera.deleteMany({ where: { schoolId } });
        await tx.busDevice.deleteMany({ where: { schoolId } });
        await tx.bus.deleteMany({ where: { schoolId } });
        await tx.auditLog.deleteMany({ where: { schoolId } });
        await tx.refreshToken.deleteMany({ where: { schoolId } });
        await tx.parent.deleteMany({ where: { schoolId } });
        await tx.user.deleteMany({ where: { schoolId } });
        await tx.school.delete({ where: { id: schoolId } });
      });
    }
    await prisma.aIModel.deleteMany({ where: { name: `ai-review-model-${suffix}` } });
    await app.close();
  });

  // ---------------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------------
  describe('review state machine', () => {
    it('CANDIDATE → REVIEWED', async () => {
      const obs = await ingestObservation();
      const token = await loginAs(adminA.email);
      const res = await api().post(`/api/v1/ai-observations/${obs.id}/review`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REVIEWED');
      expect(res.body.reviewedByName).toBeTruthy();
    });

    it('CANDIDATE → DISMISSED', async () => {
      const obs = await ingestObservation();
      const token = await loginAs(adminA.email);
      const res = await api().post(`/api/v1/ai-observations/${obs.id}/dismiss`).set('Authorization', `Bearer ${token}`).send({ reviewNote: 'False positive.' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('DISMISSED');
      expect(res.body.reviewNote).toBe('False positive.');
    });

    it('CANDIDATE → PROMOTED', async () => {
      const obs = await ingestObservation();
      const token = await loginAs(adminA.email);
      const res = await api().post(`/api/v1/ai-observations/${obs.id}/promote`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PROMOTED');
      expect(res.body.safetyEventId).toBeTruthy();
    });

    it('REVIEWED → DISMISSED and REVIEWED → PROMOTED both work', async () => {
      const token = await loginAs(adminA.email);

      const obs1 = await ingestObservation();
      await api().post(`/api/v1/ai-observations/${obs1.id}/review`).set('Authorization', `Bearer ${token}`).send({});
      const dismissRes = await api().post(`/api/v1/ai-observations/${obs1.id}/dismiss`).set('Authorization', `Bearer ${token}`).send({});
      expect(dismissRes.status).toBe(200);

      const obs2 = await ingestObservation();
      await api().post(`/api/v1/ai-observations/${obs2.id}/review`).set('Authorization', `Bearer ${token}`).send({});
      const promoteRes = await api().post(`/api/v1/ai-observations/${obs2.id}/promote`).set('Authorization', `Bearer ${token}`).send({});
      expect(promoteRes.status).toBe(200);
    });

    it('DISMISSED/PROMOTED are terminal — every further transition is rejected (400)', async () => {
      const token = await loginAs(adminA.email);

      const dismissed = await ingestObservation();
      await api().post(`/api/v1/ai-observations/${dismissed.id}/dismiss`).set('Authorization', `Bearer ${token}`).send({});
      const promoteAfterDismiss = await api().post(`/api/v1/ai-observations/${dismissed.id}/promote`).set('Authorization', `Bearer ${token}`).send({});
      expect(promoteAfterDismiss.status).toBe(400);
      const reviewAfterDismiss = await api().post(`/api/v1/ai-observations/${dismissed.id}/review`).set('Authorization', `Bearer ${token}`).send({});
      expect(reviewAfterDismiss.status).toBe(400);

      const promoted = await ingestObservation();
      await api().post(`/api/v1/ai-observations/${promoted.id}/promote`).set('Authorization', `Bearer ${token}`).send({});
      const dismissAfterPromote = await api().post(`/api/v1/ai-observations/${promoted.id}/dismiss`).set('Authorization', `Bearer ${token}`).send({});
      expect(dismissAfterPromote.status).toBe(400);
      const reviewAfterPromote = await api().post(`/api/v1/ai-observations/${promoted.id}/review`).set('Authorization', `Bearer ${token}`).send({});
      expect(reviewAfterPromote.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // Policy gating
  // ---------------------------------------------------------------------
  describe('promotion policy gating', () => {
    it('a detection type with no policy (and a conservative disabled system default) cannot be promoted', async () => {
      const obs = await ingestObservation({ detectionType: 'PERSON_DETECTED', confidence: 0.99 });
      const token = await loginAs(adminA.email);
      const res = await api().post(`/api/v1/ai-observations/${obs.id}/promote`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(400);
    });

    it('confidence below the policy minimum cannot be promoted', async () => {
      const obs = await ingestObservation({ detectionType: 'FALL_DETECTED', confidence: 0.5 });
      const token = await loginAs(adminA.email);
      const res = await api().post(`/api/v1/ai-observations/${obs.id}/promote`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(400);
    });

    it('the created SafetyEvent uses the policy default severity/type unless overridden, and links back to the observation', async () => {
      const obs = await ingestObservation({ detectionType: 'FALL_DETECTED', confidence: 0.92 });
      const token = await loginAs(adminA.email);
      const promoteRes = await api().post(`/api/v1/ai-observations/${obs.id}/promote`).set('Authorization', `Bearer ${token}`).send({});
      expect(promoteRes.status).toBe(200);

      const eventRes = await api().get(`/api/v1/safety-events/${promoteRes.body.safetyEventId}`).set('Authorization', `Bearer ${token}`);
      expect(eventRes.status).toBe(200);
      expect(eventRes.body.type).toBe('MEDICAL');
      expect(eventRes.body.severity).toBe('HIGH'); // the policy's defaultSeverity
      expect(eventRes.body.source).toBe('AI');
      expect(eventRes.body.sourceAiObservationId).toBe(obs.id);
      expect(eventRes.body.createdBy).toBeTruthy(); // the reviewer, not null
    });

    it('a reviewer may override the default severity at promotion time', async () => {
      const obs = await ingestObservation({ detectionType: 'FALL_DETECTED', confidence: 0.92 });
      const token = await loginAs(adminA.email);
      const promoteRes = await api().post(`/api/v1/ai-observations/${obs.id}/promote`).set('Authorization', `Bearer ${token}`).send({ severity: 'CRITICAL' });
      expect(promoteRes.status).toBe(200);
      const eventRes = await api().get(`/api/v1/safety-events/${promoteRes.body.safetyEventId}`).set('Authorization', `Bearer ${token}`);
      expect(eventRes.body.severity).toBe('CRITICAL');
    });
  });

  // ---------------------------------------------------------------------
  // Concurrency / idempotency
  // ---------------------------------------------------------------------
  describe('concurrency and idempotency', () => {
    it('two concurrent promote attempts on the same observation: exactly one succeeds, and exactly one SafetyEvent is ever created', async () => {
      const obs = await ingestObservation({ detectionType: 'FALL_DETECTED', confidence: 0.9 });
      const token = await loginAs(adminA.email);

      const [first, second] = await Promise.all([
        api().post(`/api/v1/ai-observations/${obs.id}/promote`).set('Authorization', `Bearer ${token}`).send({}),
        api().post(`/api/v1/ai-observations/${obs.id}/promote`).set('Authorization', `Bearer ${token}`).send({}),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 400]);

      const count = await prisma.runInTenantContext(schoolA.id, (tx) => tx.safetyEvent.count({ where: { sourceAiObservationId: obs.id } }));
      expect(count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // RBAC
  // ---------------------------------------------------------------------
  describe('RBAC', () => {
    it('TRANSPORT_MANAGER can review/dismiss/promote but cannot manage AI safety policies', async () => {
      const obs = await ingestObservation();
      const token = await loginAs(managerA.email);
      const promoteRes = await api().post(`/api/v1/ai-observations/${obs.id}/promote`).set('Authorization', `Bearer ${token}`).send({});
      expect(promoteRes.status).toBe(200);

      const createPolicyRes = await api()
        .post('/api/v1/ai-safety-policies')
        .set('Authorization', `Bearer ${token}`)
        .send({ detectionType: 'SMOKE_DETECTED', minimumConfidence: 0.8, defaultSeverity: 'CRITICAL' });
      expect(createPolicyRes.status).toBe(403);

      const listRes = await api().get('/api/v1/ai-safety-policies').set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200); // read is allowed
    });

    it('DRIVER has no review/policy/analytics access at all (403)', async () => {
      const obs = await ingestObservation();
      const token = await loginAs(driverA.email);
      const reviewRes = await api().post(`/api/v1/ai-observations/${obs.id}/review`).set('Authorization', `Bearer ${token}`).send({});
      expect(reviewRes.status).toBe(403);
      const policyRes = await api().get('/api/v1/ai-safety-policies').set('Authorization', `Bearer ${token}`);
      expect(policyRes.status).toBe(403);
      const analyticsRes = await api()
        .get(`/api/v1/analytics/safety?from=${new Date(Date.now() - 86400000).toISOString()}&to=${new Date().toISOString()}`)
        .set('Authorization', `Bearer ${token}`);
      expect(analyticsRes.status).toBe(403);
    });

    it('a parent has zero access to review/policy/analytics endpoints (403)', async () => {
      const obs = await ingestObservation();
      const token = await loginParentAs(parentA.phone);
      const reviewRes = await api().post(`/api/v1/ai-observations/${obs.id}/review`).set('Authorization', `Bearer ${token}`).send({});
      expect(reviewRes.status).toBe(403);
      const policyRes = await api().get('/api/v1/ai-safety-policies').set('Authorization', `Bearer ${token}`);
      expect(policyRes.status).toBe(403);
      const analyticsRes = await api()
        .get(`/api/v1/analytics/safety?from=${new Date(Date.now() - 86400000).toISOString()}&to=${new Date().toISOString()}`)
        .set('Authorization', `Bearer ${token}`);
      expect(analyticsRes.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Cross-tenant IDOR
  // ---------------------------------------------------------------------
  describe('cross-tenant isolation', () => {
    it("School B admin cannot review/dismiss/promote School A's observation (404)", async () => {
      const obs = await ingestObservation();
      const token = await loginAs(adminB.email);
      const reviewRes = await api().post(`/api/v1/ai-observations/${obs.id}/review`).set('Authorization', `Bearer ${token}`).send({});
      expect(reviewRes.status).toBe(404);
      const promoteRes = await api().post(`/api/v1/ai-observations/${obs.id}/promote`).set('Authorization', `Bearer ${token}`).send({});
      expect(promoteRes.status).toBe(404);
    });

    it("School B admin cannot read or modify School A's AI safety policy (404)", async () => {
      const tokenA = await loginAs(adminA.email);
      const policyRes = await api()
        .post('/api/v1/ai-safety-policies')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ detectionType: 'DOOR_STATE_DETECTED', minimumConfidence: 0.75, defaultSeverity: 'MEDIUM' });
      expect(policyRes.status).toBe(201);

      const tokenB = await loginAs(adminB.email);
      const getRes = await api().get(`/api/v1/ai-safety-policies/${policyRes.body.id}`).set('Authorization', `Bearer ${tokenB}`);
      expect(getRes.status).toBe(404);
      const enableRes = await api().post(`/api/v1/ai-safety-policies/${policyRes.body.id}/enable`).set('Authorization', `Bearer ${tokenB}`).send();
      expect(enableRes.status).toBe(404);
    });

    it('a forged/nonexistent observation or policy id is 404, never a server error', async () => {
      const token = await loginAs(adminA.email);
      const fakeId = '00000000-0000-0000-0000-000000000000';
      expect((await api().post(`/api/v1/ai-observations/${fakeId}/promote`).set('Authorization', `Bearer ${token}`).send({})).status).toBe(404);
      expect((await api().get(`/api/v1/ai-safety-policies/${fakeId}`).set('Authorization', `Bearer ${token}`)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // AI safety policy CRUD
  // ---------------------------------------------------------------------
  describe('AI safety policy CRUD', () => {
    it('a duplicate (school, detectionType) policy is rejected (400)', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/ai-safety-policies')
        .set('Authorization', `Bearer ${token}`)
        .send({ detectionType: 'FALL_DETECTED', minimumConfidence: 0.9, defaultSeverity: 'HIGH' });
      expect(res.status).toBe(400);
    });

    it('PATCH cannot change detectionType or enabled — only enable/disable can toggle enabled', async () => {
      const token = await loginAs(adminA.email);
      const created = await api()
        .post('/api/v1/ai-safety-policies')
        .set('Authorization', `Bearer ${token}`)
        .send({ detectionType: 'UNUSUAL_MOTION', minimumConfidence: 0.7, defaultSeverity: 'LOW' });
      expect(created.body.enabled).toBe(false);

      const patched = await api()
        .patch(`/api/v1/ai-safety-policies/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ minimumConfidence: 0.75, detectionType: 'FIRE_DETECTED', enabled: true });
      expect(patched.status).toBe(200);
      expect(patched.body.minimumConfidence).toBe(0.75);
      expect(patched.body.detectionType).toBe('UNUSUAL_MOTION'); // ignored — structurally excluded
      expect(patched.body.enabled).toBe(false); // ignored — structurally excluded

      const enabled = await api().post(`/api/v1/ai-safety-policies/${created.body.id}/enable`).set('Authorization', `Bearer ${token}`).send();
      expect(enabled.body.enabled).toBe(true);
      const enableAgain = await api().post(`/api/v1/ai-safety-policies/${created.body.id}/enable`).set('Authorization', `Bearer ${token}`).send();
      expect(enableAgain.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------
  describe('notification integration', () => {
    it('promoting to CRITICAL notifies staff; promoting to LOW does not', async () => {
      const token = await loginAs(adminA.email);

      const criticalObs = await ingestObservation({ detectionType: 'FALL_DETECTED', confidence: 0.95 });
      const criticalPromote = await api().post(`/api/v1/ai-observations/${criticalObs.id}/promote`).set('Authorization', `Bearer ${token}`).send({ severity: 'CRITICAL' });
      await sleep(200);
      const criticalNotifs = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.findMany({ where: { schoolId: schoolA.id, eventType: 'SAFETY_EVENT_CRITICAL', entityId: criticalPromote.body.safetyEventId } }),
      );
      expect(criticalNotifs.length).toBeGreaterThan(0);

      const lowObs = await ingestObservation({ detectionType: 'FALL_DETECTED', confidence: 0.95 });
      const lowPromote = await api().post(`/api/v1/ai-observations/${lowObs.id}/promote`).set('Authorization', `Bearer ${token}`).send({ severity: 'LOW' });
      await sleep(200);
      const lowNotifs = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.findMany({ where: { schoolId: schoolA.id, eventType: 'SAFETY_EVENT_CRITICAL', entityId: lowPromote.body.safetyEventId } }),
      );
      expect(lowNotifs.length).toBe(0);
    });

    it('no AI-related notification is ever addressed to a parent', async () => {
      const notifs = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.findMany({ where: { schoolId: schoolA.id, recipientType: 'PARENT' } }),
      );
      expect(notifs.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // Realtime — promotion flows through the EXISTING /realtime/safety
  // ---------------------------------------------------------------------
  describe('realtime', () => {
    it('a promoted AI observation reaches authorized staff via /realtime/safety as a normal safety.event.created', async () => {
      const token = await loginAs(adminA.email);
      const socket = await connectSafetySocket(token);
      try {
        const eventPromise = new Promise((res) => socket.once('safety.event.created', res));
        const obs = await ingestObservation({ detectionType: 'FALL_DETECTED', confidence: 0.93 });
        const promoteRes = await api().post(`/api/v1/ai-observations/${obs.id}/promote`).set('Authorization', `Bearer ${token}`).send({});
        expect(promoteRes.status).toBe(200);
        const received = (await eventPromise) as { id: string; source: string; sourceAiObservationId: string };
        expect(received.id).toBe(promoteRes.body.safetyEventId);
        expect(received.source).toBe('AI');
        expect(received.sourceAiObservationId).toBe(obs.id);
      } finally {
        socket.close();
      }
    });
  });

  // ---------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------
  describe('safety analytics', () => {
    it('returns aggregated counts consistent with known data, scoped to the tenant and date range', async () => {
      const token = await loginAs(adminA.email);
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const to = new Date(Date.now() + 60 * 1000).toISOString();
      const res = await api().get(`/api/v1/analytics/safety?from=${from}&to=${to}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.summary.totalObservations).toBeGreaterThan(0);
      expect(res.body.summary.promoted).toBeGreaterThan(0);
      expect(res.body.summary.totalSafetyEvents).toBeGreaterThanOrEqual(res.body.summary.promoted);
      expect(Array.isArray(res.body.observationsByDetectionType)).toBe(true);
      expect(Array.isArray(res.body.dailyTrend)).toBe(true);
      // Never raw rows.
      expect(res.body).not.toHaveProperty('observations');
      expect(res.body).not.toHaveProperty('rows');
    });

    it('rejects a date range beyond the maximum bound (400)', async () => {
      const token = await loginAs(adminA.email);
      const from = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
      const to = new Date().toISOString();
      const res = await api().get(`/api/v1/analytics/safety?from=${from}&to=${to}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it("School B analytics never include School A's data", async () => {
      const tokenB = await loginAs(adminB.email);
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const to = new Date(Date.now() + 60 * 1000).toISOString();
      const res = await api().get(`/api/v1/analytics/safety?from=${from}&to=${to}`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(200);
      expect(res.body.summary.totalObservations).toBe(0);
      expect(res.body.summary.totalSafetyEvents).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // RLS (direct Postgres, restricted app_user connection)
  // ---------------------------------------------------------------------
  describe('Row-Level Security', () => {
    it('ai_safety_policies: no tenant context sees zero rows; School A/B are mutually exclusive', async () => {
      const noContext = await prisma.aiSafetyPolicy.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
      expect(noContext).toEqual([]);

      const fromA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.aiSafetyPolicy.findMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } }));
      expect(fromA.length).toBeGreaterThan(0);
      expect(fromA.every((p) => p.schoolId === schoolA.id)).toBe(true);
    });

    it('safety_events.source_ai_observation_id is unique — the database itself rejects a second event for the same observation', async () => {
      const obs = await ingestObservation({ detectionType: 'FALL_DETECTED', confidence: 0.9 });
      const token = await loginAs(adminA.email);
      const promoteRes = await api().post(`/api/v1/ai-observations/${obs.id}/promote`).set('Authorization', `Bearer ${token}`).send({});
      expect(promoteRes.status).toBe(200);

      await expect(
        prisma.runInTenantContext(schoolA.id, (tx) =>
          tx.safetyEvent.create({
            data: { schoolId: schoolA.id, busId: busA.id, type: 'MEDICAL', severity: 'LOW', source: 'AI', occurredAt: new Date(), createdBy: adminA.id, sourceAiObservationId: obs.id },
          }),
        ),
      ).rejects.toThrow();
    });
  });
});
