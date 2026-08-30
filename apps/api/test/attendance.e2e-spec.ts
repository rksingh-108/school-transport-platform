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

describe('Attendance: boarding, drop-off, absence, correction (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const passwordService = new PasswordService();
  const suffix = Date.now();
  const STAFF_PASSWORD = 'CorrectHorse123';
  const PARENT_PASSWORD = 'ParentPassw0rd1';

  let schoolA: { id: string };
  let schoolB: { id: string };
  let adminA: { id: string; email: string };
  let transportManagerA: { id: string; email: string };
  let attendantUserA: { id: string; email: string };
  let attendantA: { id: string };
  let attendantUserA2: { id: string; email: string };
  let driverUserA: { id: string; email: string };
  let parentA: { id: string; phone: string };
  let studentA1: { id: string };
  let studentA2: { id: string };
  const routeAStopIds: string[] = [];

  let tripInProgress: { id: string };
  let tripInProgressStudents: { id: string; studentId: string }[] = [];
  let tripScheduled: { id: string };
  let tripScheduledStudent: { id: string };

  let schoolBTrip: { id: string };
  let schoolBTripStudent: { id: string };

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

  /** Bypasses TripsService (like other e2e fixture setup) — builds a Trip + TripStop snapshot + manifest directly for a desired status. */
  async function makeTrip(params: {
    schoolId: string;
    routeId: string;
    busId: string;
    driverId: string;
    attendantId?: string;
    status: 'SCHEDULED' | 'IN_PROGRESS';
    serviceDate: string;
    stopSourceIds: string[];
  }) {
    const stops = await prisma.runInTenantContext(params.schoolId, (tx) =>
      tx.routeStop.findMany({ where: { routeId: params.routeId, status: 'ACTIVE' }, orderBy: { sequenceNo: 'asc' } }),
    );
    const trip = await prisma.runInTenantContext(params.schoolId, (tx) =>
      tx.trip.create({
        data: {
          schoolId: params.schoolId,
          routeId: params.routeId,
          busId: params.busId,
          driverId: params.driverId,
          attendantId: params.attendantId,
          serviceDate: new Date(params.serviceDate),
          shift: 'MORNING_PICKUP',
          scheduledStartTime: '07:00',
          scheduledEndTime: '08:00',
          status: params.status,
          startedAt: params.status === 'IN_PROGRESS' ? new Date() : undefined,
          tripStops: {
            create: stops.map((s) => ({
              schoolId: params.schoolId,
              sourceRouteStopId: s.id,
              sequenceNo: s.sequenceNo,
              name: s.name,
              latitude: s.latitude,
              longitude: s.longitude,
              expectedOffsetMinutes: s.expectedOffsetMinutes,
              mode: s.mode,
            })),
          },
        },
        include: { tripStops: true },
      }),
    );
    params.stopSourceIds.push(...trip.tripStops.map((s) => s.id));
    return trip;
  }

  async function addManifestEntry(schoolId: string, tripId: string, studentId: string, pickupTripStopId: string) {
    return prisma.runInTenantContext(schoolId, (tx) =>
      tx.tripStudent.create({ data: { schoolId, tripId, studentId, pickupTripStopId, dropoffTripStopId: null } }),
    );
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
      tx.school.create({ data: { name: 'Attendance Test School A', slug: `attendance-test-a-${suffix}`, contactEmail: `a-${suffix}@attendance-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Attendance Test School B', slug: `attendance-test-b-${suffix}`, contactEmail: `b-${suffix}@attendance-test.example` } }),
    );

    adminA = await makeStaff(schoolA.id, `admin.a.${suffix}@attendance-test.example`, 'SCHOOL_ADMIN', staffHash);
    transportManagerA = await makeStaff(schoolA.id, `manager.a.${suffix}@attendance-test.example`, 'TRANSPORT_MANAGER', staffHash);
    attendantUserA = await makeStaff(schoolA.id, `attendant.a.${suffix}@attendance-test.example`, 'BUS_ATTENDANT', staffHash);
    attendantUserA2 = await makeStaff(schoolA.id, `attendant.a2.${suffix}@attendance-test.example`, 'BUS_ATTENDANT', staffHash);
    driverUserA = await makeStaff(schoolA.id, `driver.a.${suffix}@attendance-test.example`, 'DRIVER', staffHash);

    attendantA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.attendant.create({ data: { schoolId: schoolA.id, userId: attendantUserA.id } }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) => tx.attendant.create({ data: { schoolId: schoolA.id, userId: attendantUserA2.id } }));
    const driverA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.driver.create({ data: { schoolId: schoolA.id, userId: driverUserA.id, licenseNumber: `LIC-A-${suffix}` } }),
    );

    const routeA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.route.create({
        data: {
          schoolId: schoolA.id,
          name: `Attendance Test Route A ${suffix}`,
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
    const busA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolA.id, registrationNumber: `ATT-A-${suffix}`, capacity: 40 } }),
    );

    studentA1 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `ATT-A-${suffix}-1`, fullName: 'Student A1' } }),
    );
    studentA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `ATT-A-${suffix}-2`, fullName: 'Student A2' } }),
    );
    parentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9180006${suffix.toString().slice(-5)}`, fullName: 'Parent A', passwordHash: parentHash } }),
    );

    tripInProgress = await makeTrip({
      schoolId: schoolA.id,
      routeId: routeA.id,
      busId: busA.id,
      driverId: driverA.id,
      attendantId: attendantA.id,
      status: 'IN_PROGRESS',
      serviceDate: '2026-09-15',
      stopSourceIds: routeAStopIds,
    });
    const entry1 = await addManifestEntry(schoolA.id, tripInProgress.id, studentA1.id, routeAStopIds[0]!);
    const entry2 = await addManifestEntry(schoolA.id, tripInProgress.id, studentA2.id, routeAStopIds[1]!);
    tripInProgressStudents = [
      { id: entry1.id, studentId: studentA1.id },
      { id: entry2.id, studentId: studentA2.id },
    ];

    const scheduledStopIds: string[] = [];
    tripScheduled = await makeTrip({
      schoolId: schoolA.id,
      routeId: routeA.id,
      busId: busA.id,
      driverId: driverA.id,
      attendantId: attendantA.id,
      status: 'SCHEDULED',
      serviceDate: '2026-09-16',
      stopSourceIds: scheduledStopIds,
    });
    const scheduledEntry = await addManifestEntry(schoolA.id, tripScheduled.id, studentA1.id, scheduledStopIds[0]!);
    tripScheduledStudent = { id: scheduledEntry.id };

    // School B — for cross-tenant IDOR tests
    const managerB = await makeStaff(schoolB.id, `manager.b.${suffix}@attendance-test.example`, 'TRANSPORT_MANAGER', staffHash);
    const driverB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.driver.create({ data: { schoolId: schoolB.id, userId: managerB.id, licenseNumber: `LIC-B-${suffix}` } }),
    );
    const routeB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.route.create({
        data: {
          schoolId: schoolB.id,
          name: `Attendance Test Route B ${suffix}`,
          direction: 'HOME_TO_SCHOOL',
          shift: 'MORNING_PICKUP',
          stops: { create: [{ schoolId: schoolB.id, sequenceNo: 1, name: 'B Stop 1', latitude: 19.07, longitude: 72.87, expectedOffsetMinutes: 0 }] },
        },
      }),
    );
    const busB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.bus.create({ data: { schoolId: schoolB.id, registrationNumber: `ATT-B-${suffix}`, capacity: 35 } }),
    );
    const studentB1 = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolB.id, admissionNumber: `ATT-B-${suffix}-1`, fullName: 'Student B1' } }),
    );
    const bStopIds: string[] = [];
    schoolBTrip = await makeTrip({
      schoolId: schoolB.id,
      routeId: routeB.id,
      busId: busB.id,
      driverId: driverB.id,
      status: 'IN_PROGRESS',
      serviceDate: '2026-09-15',
      stopSourceIds: bStopIds,
    });
    const bEntry = await addManifestEntry(schoolB.id, schoolBTrip.id, studentB1.id, bStopIds[0]!);
    schoolBTripStudent = { id: bEntry.id };
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

  // ---------------------------------------------------------------------
  // Boarding
  // ---------------------------------------------------------------------
  describe('boarding', () => {
    it('an authorized transport manager can board a student, deriving the stop and actor server-side', async () => {
      const token = await loginAs(transportManagerA.email);
      const entry = tripInProgressStudents[0]!;
      const res = await api()
        .post(`/api/v1/trips/${tripInProgress.id}/students/${entry.id}/board`)
        .set('Authorization', `Bearer ${token}`)
        .send({ recordedByUserId: 'some-other-user-id', notes: 'boarded fine' });
      expect(res.status).toBe(200);
      expect(res.body.currentStatus).toBe('BOARDED');
      expect(res.body.boardedAt).toBeTruthy();

      const history = await api()
        .get(`/api/v1/trips/${tripInProgress.id}/students/${entry.id}/attendance`)
        .set('Authorization', `Bearer ${token}`);
      expect(history.body).toHaveLength(1);
      expect(history.body[0].eventType).toBe('BOARDING_CONFIRMED');
      expect(history.body[0].tripStopName).toBe('Stop 1');
      expect(history.body[0].recordedByName).toContain('manager.a');
    });

    it('rejects a duplicate boarding', async () => {
      const token = await loginAs(transportManagerA.email);
      const entry = tripInProgressStudents[0]!;
      const res = await api().post(`/api/v1/trips/${tripInProgress.id}/students/${entry.id}/board`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(400);
    });

    it('rejects boarding on an invalid trip or manifest entry', async () => {
      const token = await loginAs(transportManagerA.email);
      const badTrip = await api()
        .post(`/api/v1/trips/00000000-0000-0000-0000-000000000000/students/${tripInProgressStudents[0]!.id}/board`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(badTrip.status).toBe(404);

      const badEntry = await api()
        .post(`/api/v1/trips/${tripInProgress.id}/students/00000000-0000-0000-0000-000000000000/board`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(badEntry.status).toBe(404);
    });

    it('rejects boarding while the trip is not in progress', async () => {
      const token = await loginAs(transportManagerA.email);
      const res = await api()
        .post(`/api/v1/trips/${tripScheduled.id}/students/${tripScheduledStudent.id}/board`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('a parent cannot board a student', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api()
        .post(`/api/v1/trips/${tripInProgress.id}/students/${tripInProgressStudents[1]!.id}/board`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(403);
    });

    it('a driver (no attendance permission) cannot board a student', async () => {
      const token = await loginAs(driverUserA.email);
      const res = await api()
        .post(`/api/v1/trips/${tripInProgress.id}/students/${tripInProgressStudents[1]!.id}/board`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(403);
    });

    it('a school admin (attendance.read only, not manage) cannot board a student', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post(`/api/v1/trips/${tripInProgress.id}/students/${tripInProgressStudents[1]!.id}/board`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(403);
    });

    it("an attendant not assigned to the trip cannot board a student (own-trip scoping)", async () => {
      const token = await loginAs(attendantUserA2.email);
      const res = await api()
        .post(`/api/v1/trips/${tripInProgress.id}/students/${tripInProgressStudents[1]!.id}/board`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(403);
    });

    it('the assigned attendant can board a student on their own trip', async () => {
      const token = await loginAs(attendantUserA.email);
      const res = await api()
        .post(`/api/v1/trips/${tripInProgress.id}/students/${tripInProgressStudents[1]!.id}/board`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.currentStatus).toBe('BOARDED');
    });
  });

  // ---------------------------------------------------------------------
  // Drop-off
  // ---------------------------------------------------------------------
  describe('drop-off', () => {
    it('rejects drop-off before boarding', async () => {
      const token = await loginAs(transportManagerA.email);
      const res = await api()
        .post(`/api/v1/trips/${tripScheduled.id}/students/${tripScheduledStudent.id}/dropoff`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      // Trip isn't IN_PROGRESS either, but the boarded-state check applies regardless.
      expect(res.status).toBe(400);
    });

    it('an authorized manager can drop off a boarded student, and a second drop-off is rejected', async () => {
      const token = await loginAs(transportManagerA.email);
      const entry = tripInProgressStudents[0]!; // already BOARDED from the boarding describe block

      const res = await api().post(`/api/v1/trips/${tripInProgress.id}/students/${entry.id}/dropoff`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.currentStatus).toBe('DROPPED_OFF');
      expect(res.body.droppedOffAt).toBeTruthy();

      const again = await api().post(`/api/v1/trips/${tripInProgress.id}/students/${entry.id}/dropoff`).set('Authorization', `Bearer ${token}`).send({});
      expect(again.status).toBe(400);
    });

    it('a parent cannot drop off a student', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api()
        .post(`/api/v1/trips/${tripInProgress.id}/students/${tripInProgressStudents[1]!.id}/dropoff`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Absence
  // ---------------------------------------------------------------------
  describe('absence', () => {
    let absentTripId: string;
    let absentTripStudentId: string;

    beforeAll(async () => {
      const stopIds: string[] = [];
      const route = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.route.findFirstOrThrow({ where: { schoolId: schoolA.id, direction: 'HOME_TO_SCHOOL' } }),
      );
      const bus = await prisma.runInTenantContext(schoolA.id, (tx) => tx.bus.findFirstOrThrow({ where: { schoolId: schoolA.id } }));
      const driver = await prisma.runInTenantContext(schoolA.id, (tx) => tx.driver.findFirstOrThrow({ where: { schoolId: schoolA.id } }));
      const trip = await makeTrip({
        schoolId: schoolA.id,
        routeId: route.id,
        busId: bus.id,
        driverId: driver.id,
        attendantId: attendantA.id,
        status: 'SCHEDULED',
        serviceDate: '2026-09-17',
        stopSourceIds: stopIds,
      });
      const entry = await addManifestEntry(schoolA.id, trip.id, studentA2.id, stopIds[0]!);
      absentTripId = trip.id;
      absentTripStudentId = entry.id;
    });

    it('marks a student explicitly absent, then rejects a duplicate', async () => {
      const token = await loginAs(transportManagerA.email);
      const res = await api().post(`/api/v1/trips/${absentTripId}/students/${absentTripStudentId}/absent`).set('Authorization', `Bearer ${token}`).send({ notes: 'called in sick' });
      expect(res.status).toBe(200);
      expect(res.body.currentStatus).toBe('ABSENT');

      const again = await api().post(`/api/v1/trips/${absentTripId}/students/${absentTripStudentId}/absent`).set('Authorization', `Bearer ${token}`).send({});
      expect(again.status).toBe(400);
    });

    it('cannot mark a boarded student absent', async () => {
      const token = await loginAs(transportManagerA.email);
      const boardedEntry = tripInProgressStudents[1]!; // BOARDED then DROPPED_OFF is not yet true for this one — still BOARDED from earlier test
      const res = await api().post(`/api/v1/trips/${tripInProgress.id}/students/${boardedEntry.id}/absent`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // Correction
  // ---------------------------------------------------------------------
  describe('correction', () => {
    it('corrects a mistaken absence to boarded, preserving history', async () => {
      const token = await loginAs(transportManagerA.email);
      const stopIds: string[] = [];
      const route = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.route.findFirstOrThrow({ where: { schoolId: schoolA.id, direction: 'HOME_TO_SCHOOL' } }),
      );
      const bus = await prisma.runInTenantContext(schoolA.id, (tx) => tx.bus.findFirstOrThrow({ where: { schoolId: schoolA.id } }));
      const driver = await prisma.runInTenantContext(schoolA.id, (tx) => tx.driver.findFirstOrThrow({ where: { schoolId: schoolA.id } }));
      const trip = await makeTrip({
        schoolId: schoolA.id,
        routeId: route.id,
        busId: bus.id,
        driverId: driver.id,
        status: 'IN_PROGRESS',
        serviceDate: '2026-09-18',
        stopSourceIds: stopIds,
      });
      const entry = await addManifestEntry(schoolA.id, trip.id, studentA1.id, stopIds[0]!);

      const absentRes = await api().post(`/api/v1/trips/${trip.id}/students/${entry.id}/absent`).set('Authorization', `Bearer ${token}`).send({});
      expect(absentRes.status).toBe(200);

      const history1 = await api().get(`/api/v1/trips/${trip.id}/students/${entry.id}/attendance`).set('Authorization', `Bearer ${token}`);
      const originalEventId = history1.body[0].id;

      const correctRes = await api()
        .post(`/api/v1/trips/${trip.id}/students/${entry.id}/attendance/${originalEventId}/correct`)
        .set('Authorization', `Bearer ${token}`)
        .send({ eventType: 'BOARDING_CONFIRMED', notes: 'was actually boarded, marked absent by mistake' });
      expect(correctRes.status).toBe(200);
      expect(correctRes.body.currentStatus).toBe('BOARDED');

      const history2 = await api().get(`/api/v1/trips/${trip.id}/students/${entry.id}/attendance`).set('Authorization', `Bearer ${token}`);
      expect(history2.body).toHaveLength(2);
      expect(history2.body[0].eventType).toBe('MARKED_ABSENT');
      expect(history2.body[1].eventType).toBe('BOARDING_CONFIRMED');
      expect(history2.body[1].correctsEventId).toBe(originalEventId);
    });

    it('a driver cannot correct an attendance event', async () => {
      const token = await loginAs(driverUserA.email);
      const entry = tripInProgressStudents[0]!;
      const historyToken = await loginAs(transportManagerA.email);
      const history = await api().get(`/api/v1/trips/${tripInProgress.id}/students/${entry.id}/attendance`).set('Authorization', `Bearer ${historyToken}`);
      const eventId = history.body[0].id;

      const res = await api()
        .post(`/api/v1/trips/${tripInProgress.id}/students/${entry.id}/attendance/${eventId}/correct`)
        .set('Authorization', `Bearer ${token}`)
        .send({ eventType: 'BOARDING_CONFIRMED' });
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Cross-tenant IDOR
  // ---------------------------------------------------------------------
  describe('cross-tenant IDOR', () => {
    it("School A staff cannot record or read attendance on School B's trip/manifest entry", async () => {
      const token = await loginAs(transportManagerA.email);

      const boardRes = await api()
        .post(`/api/v1/trips/${schoolBTrip.id}/students/${schoolBTripStudent.id}/board`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(boardRes.status).toBe(404);

      const historyRes = await api()
        .get(`/api/v1/trips/${schoolBTrip.id}/students/${schoolBTripStudent.id}/attendance`)
        .set('Authorization', `Bearer ${token}`);
      expect(historyRes.status).toBe(404);
    });

    it("School A staff cannot board School B's manifest entry via a School A trip id, or vice versa", async () => {
      const token = await loginAs(transportManagerA.email);
      const res = await api()
        .post(`/api/v1/trips/${tripInProgress.id}/students/${schoolBTripStudent.id}/board`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // Direct RLS verification (bypassing the API entirely)
  // ---------------------------------------------------------------------
  describe('RLS enforcement (direct, bypassing the API)', () => {
    it('a tenant-scoped query for School A never returns School B attendance events', async () => {
      // No test above ever successfully wrote a School B event (the IDOR
      // tests correctly failed at 404) — create one directly to verify RLS.
      const eventB = await prisma.runInTenantContext(schoolB.id, (tx) =>
        tx.attendanceEvent.create({
          data: { schoolId: schoolB.id, tripId: schoolBTrip.id, tripStudentId: schoolBTripStudent.id, eventType: 'BOARDING_CONFIRMED' },
        }),
      );

      const fromA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.attendanceEvent.findMany({ where: { id: eventB.id } }));
      expect(fromA).toEqual([]);
    });

    it('no tenant context set at all returns zero rows (FORCE ROW LEVEL SECURITY default-deny)', async () => {
      const count = await prisma.attendanceEvent.count();
      expect(count).toBe(0);
    });
  });
});
