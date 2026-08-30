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
import { RedisService } from '../src/redis/redis.service';
import { DomainEventsService } from '../src/common/events/domain-events.service';

jest.setTimeout(20000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Notifications + alerts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let domainEvents: DomainEventsService;
  const passwordService = new PasswordService();
  const suffix = Date.now();
  const STAFF_PASSWORD = 'CorrectHorse123';
  const PARENT_PASSWORD = 'ParentPassw0rd1';

  let schoolA: { id: string };
  let schoolB: { id: string };
  let adminA: { id: string; email: string };
  let managerA: { id: string; email: string }; // TRANSPORT_MANAGER, no notifications.read grant pre-Step-9... now has it
  let driverA: { id: string; email: string };
  let parentA: { id: string; phone: string; email: string | null };
  let parentA2: { id: string; phone: string }; // unrelated parent, not linked to studentA
  let studentA: { id: string };
  let busA: { id: string };
  let tripInProgress: { id: string };
  let tripStudentA: { id: string };
  let tripToCancel: { id: string };
  let tripToNoShow: { id: string };

  let adminB: { id: string; email: string };

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

  function locationRedisKey(schoolId: string, busId: string): string {
    return `school:${schoolId}:bus:${busId}:location`;
  }

  /** Directly seeds the Redis current-location snapshot GpsService reads — bypasses real ingestion to deterministically simulate a fix from N seconds ago, without waiting real time. */
  async function seedLocationSnapshot(schoolId: string, busId: string, tripId: string, ageSeconds: number): Promise<void> {
    const deviceTime = new Date(Date.now() - ageSeconds * 1000).toISOString();
    const snapshot = {
      tripId,
      latitude: 12.9,
      longitude: 77.6,
      speedKmh: 20,
      heading: 90,
      accuracyM: 5,
      deviceTime,
      receivedAt: deviceTime,
    };
    await redis.client.set(locationRedisKey(schoolId, busId), JSON.stringify(snapshot), 'EX', 3600);
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
    redis = app.get(RedisService);
    domainEvents = app.get(DomainEventsService);

    const staffHash = await passwordService.hash(STAFF_PASSWORD);
    const parentHash = await passwordService.hash(PARENT_PASSWORD);

    schoolA = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Notif Test School A', slug: `notif-test-a-${suffix}`, contactEmail: `a-${suffix}@notif-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Notif Test School B', slug: `notif-test-b-${suffix}`, contactEmail: `b-${suffix}@notif-test.example` } }),
    );

    adminA = await makeStaff(schoolA.id, `admin.a.${suffix}@notif-test.example`, 'SCHOOL_ADMIN', staffHash);
    managerA = await makeStaff(schoolA.id, `manager.a.${suffix}@notif-test.example`, 'TRANSPORT_MANAGER', staffHash);
    driverA = await makeStaff(schoolA.id, `driver.a.${suffix}@notif-test.example`, 'DRIVER', staffHash);
    const driverProfileA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.driver.create({ data: { schoolId: schoolA.id, userId: driverA.id, licenseNumber: `NT-LIC-A-${suffix}` } }),
    );
    const attendantUserA = await makeStaff(schoolA.id, `attendant.a.${suffix}@notif-test.example`, 'BUS_ATTENDANT', staffHash);
    const attendantProfileA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.attendant.create({ data: { schoolId: schoolA.id, userId: attendantUserA.id } }),
    );

    const routeA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.route.create({ data: { schoolId: schoolA.id, name: `Notif Route A ${suffix}`, direction: 'HOME_TO_SCHOOL', shift: 'MORNING_PICKUP' } }),
    );
    const routeA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.route.create({ data: { schoolId: schoolA.id, name: `Notif Route A2 ${suffix}`, direction: 'HOME_TO_SCHOOL', shift: 'AFTERNOON_DROP' } }),
    );
    const routeA3 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.route.create({ data: { schoolId: schoolA.id, name: `Notif Route A3 ${suffix}`, direction: 'SCHOOL_TO_HOME', shift: 'AFTERNOON_DROP' } }),
    );
    busA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `NT-BUS-A-${suffix}`, fleetNumber: 'N1', capacity: 40 } }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.busDevice.create({ data: { schoolId: schoolA.id, busId: busA.id, deviceType: 'GPS_TRACKER', externalDeviceId: `NT-DEV-A-${suffix}` } }),
    );

    studentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `NT-A-${suffix}-1`, fullName: 'Notif Child A' } }),
    );
    const studentA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `NT-A-${suffix}-2`, fullName: 'Notif Child A2 (unrelated)' } }),
    );
    parentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({
        data: { schoolId: schoolA.id, phone: `+9180011${suffix.toString().slice(-5)}`, email: `parentA.${suffix}@notif-test.example`, fullName: 'Notif Parent A', passwordHash: parentHash },
      }),
    );
    parentA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9180012${suffix.toString().slice(-5)}`, fullName: 'Notif Parent A2', passwordHash: parentHash } }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parentStudent.create({
        data: { schoolId: schoolA.id, parentId: parentA.id, studentId: studentA.id, relationship: 'MOTHER', verified: true, verifiedBy: adminA.id, verifiedAt: new Date() },
      }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parentStudent.create({
        data: { schoolId: schoolA.id, parentId: parentA2.id, studentId: studentA2.id, relationship: 'MOTHER', verified: true, verifiedBy: adminA.id, verifiedAt: new Date() },
      }),
    );

    tripInProgress = await prisma.runInTenantContext(schoolA.id, (tx) =>
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
    tripStudentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.tripStudent.create({ data: { schoolId: schoolA.id, tripId: tripInProgress.id, studentId: studentA.id, membershipStatus: 'ACTIVE' } }),
    );

    // A second, standalone SCHEDULED trip (own route to avoid the
    // [routeId, serviceDate, shift] unique constraint) for cancel/no-show
    // domain-event tests, with studentA on its manifest too.
    tripToCancel = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.trip.create({
        data: {
          schoolId: schoolA.id,
          routeId: routeA2.id,
          busId: busA.id,
          driverId: driverProfileA.id,
          serviceDate: new Date(),
          shift: 'AFTERNOON_DROP',
          scheduledStartTime: '14:00',
          scheduledEndTime: '15:00',
          status: 'READY',
        },
      }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.tripStudent.create({ data: { schoolId: schoolA.id, tripId: tripToCancel.id, studentId: studentA.id } }),
    );

    tripToNoShow = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.trip.create({
        data: {
          schoolId: schoolA.id,
          routeId: routeA3.id,
          busId: busA.id,
          driverId: driverProfileA.id,
          serviceDate: new Date(),
          shift: 'AFTERNOON_DROP',
          scheduledStartTime: '16:00',
          scheduledEndTime: '17:00',
          status: 'SCHEDULED',
        },
      }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.tripStudent.create({ data: { schoolId: schoolA.id, tripId: tripToNoShow.id, studentId: studentA.id } }),
    );

    // School B — cross-tenant fixture
    adminB = await makeStaff(schoolB.id, `admin.b.${suffix}@notif-test.example`, 'SCHOOL_ADMIN', staffHash);
  });

  afterAll(async () => {
    for (const schoolId of [schoolA.id, schoolB.id]) {
      await prisma.runInTenantContext(schoolId, async (tx) => {
        await tx.notificationDelivery.deleteMany({ where: { schoolId } });
        await tx.notification.deleteMany({ where: { schoolId } });
        await tx.notificationPreference.deleteMany({ where: { schoolId } });
        await tx.attendanceEvent.deleteMany({ where: { schoolId } });
        await tx.tripStudent.deleteMany({ where: { schoolId } });
        await tx.trip.deleteMany({ where: { schoolId } });
        await tx.route.deleteMany({ where: { schoolId } });
        await tx.busDevice.deleteMany({ where: { schoolId } });
        await tx.bus.deleteMany({ where: { schoolId } });
        await tx.driver.deleteMany({ where: { schoolId } });
        await tx.attendant.deleteMany({ where: { schoolId } });
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
  // Attendance events -> parent notifications
  // ---------------------------------------------------------------------
  describe('attendance domain events', () => {
    it('boarding creates exactly one notification for the verified parent', async () => {
      const token = await loginAs(managerA.email);
      const res = await api().post(`/api/v1/trips/${tripInProgress.id}/students/${tripStudentA.id}/board`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(200);
      await sleep(150); // domain events are handled asynchronously after the HTTP response

      const parentToken = await loginParentAs(parentA.phone);
      const list = await api().get('/api/v1/parent/notifications').set('Authorization', `Bearer ${parentToken}`);
      expect(list.status).toBe(200);
      const boarded = list.body.data.filter((n: { eventType: string }) => n.eventType === 'CHILD_BOARDED');
      expect(boarded).toHaveLength(1);
      expect(boarded[0].title).toBe('Child boarded');
      expect(boarded[0].body).not.toMatch(/device|trip_student|staff|driver|attendant/i);

      const count = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.count({ where: { eventType: 'CHILD_BOARDED', entityType: 'ATTENDANCE_EVENT' } }),
      );
      expect(count).toBe(1);
    });

    it('reprocessing the same domain event does not create a duplicate notification (idempotency)', async () => {
      const before = await prisma.runInTenantContext(schoolA.id, (tx) => tx.notification.count({ where: { eventType: 'CHILD_BOARDED' } }));
      const event = await prisma.runInTenantContext(schoolA.id, (tx) => tx.attendanceEvent.findFirstOrThrow({ where: { tripStudentId: tripStudentA.id, eventType: 'BOARDING_CONFIRMED' } }));

      domainEvents.publish({ type: 'CHILD_BOARDED', schoolId: schoolA.id, tripId: tripInProgress.id, studentId: studentA.id, attendanceEventId: event.id });
      await sleep(150);

      const after = await prisma.runInTenantContext(schoolA.id, (tx) => tx.notification.count({ where: { eventType: 'CHILD_BOARDED' } }));
      expect(after).toBe(before);
    });

    it('drop-off creates exactly one notification', async () => {
      const token = await loginAs(managerA.email);
      const res = await api().post(`/api/v1/trips/${tripInProgress.id}/students/${tripStudentA.id}/dropoff`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(200);
      await sleep(150);

      const count = await prisma.runInTenantContext(schoolA.id, (tx) => tx.notification.count({ where: { eventType: 'CHILD_DROPPED_OFF' } }));
      expect(count).toBe(1);
    });

    it('a correction never resends a boarding/drop-off notification', async () => {
      const token = await loginAs(managerA.email);
      const beforeBoarded = await prisma.runInTenantContext(schoolA.id, (tx) => tx.notification.count({ where: { eventType: 'CHILD_BOARDED' } }));

      const history = await api().get(`/api/v1/trips/${tripInProgress.id}/students/${tripStudentA.id}/attendance`).set('Authorization', `Bearer ${token}`);
      const originalEventId = history.body[0].id;
      const correctRes = await api()
        .post(`/api/v1/trips/${tripInProgress.id}/students/${tripStudentA.id}/attendance/${originalEventId}/correct`)
        .set('Authorization', `Bearer ${token}`)
        .send({ eventType: 'BOARDING_CONFIRMED', notes: 'correction test' });
      expect(correctRes.status).toBe(200);
      await sleep(150);

      const afterBoarded = await prisma.runInTenantContext(schoolA.id, (tx) => tx.notification.count({ where: { eventType: 'CHILD_BOARDED' } }));
      expect(afterBoarded).toBe(beforeBoarded);
    });
  });

  // ---------------------------------------------------------------------
  // Trip lifecycle events -> parent + staff notifications
  // ---------------------------------------------------------------------
  describe('trip lifecycle domain events', () => {
    it('trip cancellation notifies the affected parent and operational staff, never an unrelated parent', async () => {
      const token = await loginAs(managerA.email);
      const res = await api().post(`/api/v1/trips/${tripToCancel.id}/cancel`).set('Authorization', `Bearer ${token}`).send({ reason: 'Bus breakdown' });
      expect(res.status).toBe(200);
      await sleep(150);

      const parentToken = await loginParentAs(parentA.phone);
      const parentList = await api().get('/api/v1/parent/notifications').set('Authorization', `Bearer ${parentToken}`);
      const cancelled = parentList.body.data.filter((n: { eventType: string }) => n.eventType === 'TRIP_CANCELLED');
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0].body).toBe("Today's school bus trip has been cancelled.");

      const unrelatedParentToken = await loginParentAs(parentA2.phone);
      const unrelatedList = await api().get('/api/v1/parent/notifications').set('Authorization', `Bearer ${unrelatedParentToken}`);
      expect(unrelatedList.body.data.filter((n: { eventType: string }) => n.eventType === 'TRIP_CANCELLED')).toHaveLength(0);

      const adminToken = await loginAs(adminA.email);
      const staffList = await api().get('/api/v1/notifications').set('Authorization', `Bearer ${adminToken}`);
      expect(staffList.status).toBe(200);
      const staffCancelled = staffList.body.data.filter((n: { eventType: string }) => n.eventType === 'TRIP_CANCELLED');
      expect(staffCancelled).toHaveLength(1);

      // TRANSPORT_MANAGER gained notifications.read in this phase (was SCHOOL_ADMIN-only).
      const managerList = await api().get('/api/v1/notifications').set('Authorization', `Bearer ${token}`);
      expect(managerList.status).toBe(200);
      expect(managerList.body.data.filter((n: { eventType: string }) => n.eventType === 'TRIP_CANCELLED')).toHaveLength(1);
    });

    it('trip no-show notifies the affected parent', async () => {
      const token = await loginAs(managerA.email);
      const res = await api().post(`/api/v1/trips/${tripToNoShow.id}/no-show`).set('Authorization', `Bearer ${token}`).send({ reason: 'Driver unavailable' });
      expect(res.status).toBe(200);
      await sleep(150);

      const count = await prisma.runInTenantContext(schoolA.id, (tx) => tx.notification.count({ where: { eventType: 'TRIP_NO_SHOW' } }));
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('TRIP_STARTED/TRIP_COMPLETED transitions create no notification (no audience mapped yet)', async () => {
      // tripInProgress was already started in beforeAll; complete it now.
      const token = await loginAs(managerA.email);
      const res = await api().post(`/api/v1/trips/${tripInProgress.id}/complete`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(200);
      await sleep(150);

      const count = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.count({ where: { OR: [{ entityId: tripInProgress.id }] } }),
      );
      // Only the earlier CHILD_BOARDED/CHILD_DROPPED_OFF (entityId = attendance event, not the trip) exist — no TRIP_STARTED/TRIP_COMPLETED row is possible since that's not even a valid enum value.
      expect(count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // GPS alert semantics — state transitions, not every check
  // ---------------------------------------------------------------------
  describe('GPS alert semantics', () => {
    it('a fresh LIVE fix creates no alert', async () => {
      await seedLocationSnapshot(schoolA.id, busA.id, tripInProgress.id, 5);
      const token = await loginAs(adminA.email);
      // tripInProgress was completed in the previous describe block, so re-open it for this isolated check.
      await prisma.runInTenantContext(schoolA.id, (tx) => tx.trip.update({ where: { id: tripInProgress.id }, data: { status: 'IN_PROGRESS' } }));
      const res = await api().get(`/api/v1/buses/${busA.id}/location`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.freshness).toBe('LIVE');
      await sleep(100);

      const count = await prisma.runInTenantContext(schoolA.id, (tx) => tx.notification.count({ where: { eventType: { in: ['GPS_STALE', 'GPS_OFFLINE'] } } }));
      expect(count).toBe(0);
    });

    it('a transition into STALE creates exactly one staff alert per operational recipient, and repeated reads do not create more (no storm)', async () => {
      await seedLocationSnapshot(schoolA.id, busA.id, tripInProgress.id, 200); // beyond the 90s LIVE default, within the 300s STALE default
      const token = await loginAs(adminA.email);

      const first = await api().get(`/api/v1/buses/${busA.id}/location`).set('Authorization', `Bearer ${token}`);
      expect(first.body.freshness).toBe('STALE');
      await sleep(150);

      // Read it several more times — freshness hasn't changed, so no new alert should fire.
      await api().get(`/api/v1/buses/${busA.id}/location`).set('Authorization', `Bearer ${token}`);
      await sleep(100);
      await api().get(`/api/v1/buses/${busA.id}/location`).set('Authorization', `Bearer ${token}`);
      await sleep(150);

      // Scoped to one specific recipient (adminA) rather than a blanket
      // count — there are 2 operational-role staff in this fixture
      // (adminA + managerA), so *each* legitimately gets their own row;
      // the invariant under test is "one per recipient", not "one total".
      const count = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.count({ where: { eventType: 'GPS_STALE', recipientType: 'USER', recipientId: adminA.id } }),
      );
      expect(count).toBe(1);
    });

    it('a further transition into UNKNOWN (offline) creates a distinct alert', async () => {
      await seedLocationSnapshot(schoolA.id, busA.id, tripInProgress.id, 400); // beyond the 300s STALE default
      const token = await loginAs(adminA.email);
      const res = await api().get(`/api/v1/buses/${busA.id}/location`).set('Authorization', `Bearer ${token}`);
      expect(res.body.freshness).toBe('UNKNOWN');
      await sleep(150);

      const count = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.count({ where: { eventType: 'GPS_OFFLINE', recipientType: 'USER', recipientId: adminA.id } }),
      );
      expect(count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // Delivery: in-app + NOT_CONFIGURED external channels
  // ---------------------------------------------------------------------
  describe('delivery', () => {
    it('a parent notification with email/phone on file gets EMAIL/SMS delivery rows, both NOT_CONFIGURED (no real provider)', async () => {
      const notification = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.findFirst({ where: { recipientType: 'PARENT', recipientId: parentA.id, eventType: 'CHILD_BOARDED' } }),
      );
      const deliveries = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notificationDelivery.findMany({ where: { notificationId: notification!.id } }),
      );
      const channels = deliveries.map((d) => d.channel).sort();
      expect(channels).toEqual(['EMAIL', 'SMS']);
      for (const delivery of deliveries) {
        expect(delivery.status).toBe('NOT_CONFIGURED');
        expect(delivery.attempts).toBeGreaterThanOrEqual(1);
      }
    });

    it('IN_APP has no delivery row at all — the Notification row\'s existence is its own delivery', async () => {
      const notification = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.findFirst({ where: { recipientType: 'PARENT', recipientId: parentA.id, eventType: 'CHILD_BOARDED' } }),
      );
      const inAppDelivery = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notificationDelivery.findFirst({ where: { notificationId: notification!.id, channel: 'IN_APP' } }),
      );
      expect(inAppDelivery).toBeNull();
    });

    it('a disabled channel preference suppresses that delivery row', async () => {
      await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notificationPreference.upsert({
          where: { parentId_channel: { parentId: parentA.id, channel: 'SMS' } },
          update: { enabled: false },
          create: { schoolId: schoolA.id, parentId: parentA.id, channel: 'SMS', enabled: false },
        }),
      );

      const token = await loginAs(managerA.email);
      // Trigger a fresh boarding on a brand-new manifest entry so a new notification (and delivery attempt) is created.
      const existingRoute = await prisma.runInTenantContext(schoolA.id, (tx) => tx.route.findFirstOrThrow({ where: { schoolId: schoolA.id } }));
      const existingDriver = await prisma.runInTenantContext(schoolA.id, (tx) => tx.driver.findFirstOrThrow({ where: { schoolId: schoolA.id } }));
      const freshTrip = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.trip.create({
          data: {
            schoolId: schoolA.id,
            routeId: existingRoute.id,
            busId: busA.id,
            driverId: existingDriver.id,
            serviceDate: new Date(),
            shift: 'CUSTOM',
            scheduledStartTime: '09:00',
            scheduledEndTime: '10:00',
            status: 'IN_PROGRESS',
            startedAt: new Date(),
          },
        }),
      );
      const freshEntry = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.tripStudent.create({ data: { schoolId: schoolA.id, tripId: freshTrip.id, studentId: studentA.id, membershipStatus: 'ACTIVE' } }),
      );
      const res = await api().post(`/api/v1/trips/${freshTrip.id}/students/${freshEntry.id}/board`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(200);
      await sleep(150);

      const attendanceEvent = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.attendanceEvent.findFirstOrThrow({ where: { tripStudentId: freshEntry.id, eventType: 'BOARDING_CONFIRMED' } }),
      );
      const notification = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.findFirstOrThrow({ where: { entityId: attendanceEvent.id, eventType: 'CHILD_BOARDED' } }),
      );
      const deliveries = await prisma.runInTenantContext(schoolA.id, (tx) => tx.notificationDelivery.findMany({ where: { notificationId: notification.id } }));
      expect(deliveries.map((d) => d.channel)).toEqual(['EMAIL']); // SMS suppressed by preference
    });
  });

  // ---------------------------------------------------------------------
  // In-app read model: unread count, mark read, mark all read
  // ---------------------------------------------------------------------
  describe('in-app read model', () => {
    it('unread count reflects unread notifications, and mark-read decrements it', async () => {
      const parentToken = await loginParentAs(parentA.phone);
      const before = await api().get('/api/v1/parent/notifications/unread-count').set('Authorization', `Bearer ${parentToken}`);
      expect(before.body.count).toBeGreaterThan(0);

      const list = await api().get('/api/v1/parent/notifications').set('Authorization', `Bearer ${parentToken}`);
      const firstUnread = list.body.data.find((n: { readAt: string | null }) => n.readAt === null);
      const markRes = await api().post(`/api/v1/parent/notifications/${firstUnread.id}/read`).set('Authorization', `Bearer ${parentToken}`).send({});
      expect(markRes.status).toBe(200);
      expect(markRes.body.readAt).toBeTruthy();

      const after = await api().get('/api/v1/parent/notifications/unread-count').set('Authorization', `Bearer ${parentToken}`);
      expect(after.body.count).toBe(before.body.count - 1);
    });

    it('mark-all-read zeroes the unread count', async () => {
      const parentToken = await loginParentAs(parentA.phone);
      const markAll = await api().post('/api/v1/parent/notifications/read-all').set('Authorization', `Bearer ${parentToken}`).send({});
      expect(markAll.status).toBe(200);

      const after = await api().get('/api/v1/parent/notifications/unread-count').set('Authorization', `Bearer ${parentToken}`);
      expect(after.body.count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // Security: parent isolation, staff isolation, cross-tenant, forgery
  // ---------------------------------------------------------------------
  describe('security', () => {
    it("Parent A2 never sees Parent A's notifications", async () => {
      const token = await loginParentAs(parentA2.phone);
      const list = await api().get('/api/v1/parent/notifications').set('Authorization', `Bearer ${token}`);
      expect(list.body.data.every((n: { eventType: string }) => n.eventType !== 'CHILD_BOARDED')).toBe(true);
    });

    it("Parent A2 cannot mark Parent A's notification as read (404)", async () => {
      const notification = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.notification.findFirstOrThrow({ where: { recipientType: 'PARENT', recipientId: parentA.id } }),
      );
      const token = await loginParentAs(parentA2.phone);
      const res = await api().post(`/api/v1/parent/notifications/${notification.id}/read`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(404);
    });

    it('there is no client-callable notification-creation endpoint at all', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().post('/api/v1/parent/notifications').set('Authorization', `Bearer ${token}`).send({ title: 'forged', body: 'forged' });
      expect(res.status).toBe(404);
    });

    it('a staff member without notifications.read (DRIVER) cannot access staff notifications', async () => {
      const token = await loginAs(driverA.email);
      const res = await api().get('/api/v1/notifications').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it("School B staff cannot see School A's notifications", async () => {
      const token = await loginAs(adminB.email);
      const res = await api().get('/api/v1/notifications').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('a parent token cannot use the staff notifications endpoint, and vice versa', async () => {
      const parentToken = await loginParentAs(parentA.phone);
      const asStaffRoute = await api().get('/api/v1/notifications').set('Authorization', `Bearer ${parentToken}`);
      expect(asStaffRoute.status).toBe(403);

      const staffToken = await loginAs(adminA.email);
      const asParentRoute = await api().get('/api/v1/parent/notifications').set('Authorization', `Bearer ${staffToken}`);
      expect(asParentRoute.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Direct RLS verification
  // ---------------------------------------------------------------------
  describe('RLS enforcement (direct, bypassing the API)', () => {
    it('a tenant-scoped query for School A never returns School B notifications', async () => {
      const notifB = await prisma.runInTenantContext(schoolB.id, (tx) =>
        tx.notification.create({
          data: {
            schoolId: schoolB.id,
            eventType: 'GPS_STALE',
            entityType: 'TRIP',
            entityId: 'fake-trip-id',
            recipientType: 'USER',
            recipientId: adminB.id,
            title: 'x',
            body: 'y',
          },
        }),
      );
      const fromA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.notification.findMany({ where: { id: notifB.id } }));
      expect(fromA).toEqual([]);
    });

    it('no tenant context set at all returns zero rows for notifications and notification_deliveries', async () => {
      expect(await prisma.notification.count()).toBe(0);
      expect(await prisma.notificationDelivery.count()).toBe(0);
    });
  });
});
