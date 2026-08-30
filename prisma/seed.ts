/**
 * Development seed data ONLY. Never used against a production database.
 * Everything here is obviously fake — no real child, parent, or staff data.
 *
 * Runs with the privileged connection (DATABASE_URL) via the Prisma CLI's
 * `db seed` step, which is why it can insert freely without setting the
 * `app.current_school_id` session variable that Row-Level Security requires
 * for the restricted `app_user` connection — see
 * docs/database.md#7-prisma-implementation-notes.
 */
import 'dotenv/config';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  ROLE_KEYS,
  PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  type PermissionKey,
} from '@school-transport/shared-types';

const prisma = new PrismaClient();

const DEV_PASSWORD = 'Passw0rd!123'; // dev-only login for every seeded account

/** Mirrors TokenService.generateOpaqueToken() exactly (same algorithm, no NestJS DI available in this standalone script) — see docs/adr/0014. */
function generateDeviceCredential(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: createHash('sha256').update(raw).digest('hex') };
}

/** YYYY-MM-DD, `offsetDays` from today — relative so seeded trips always look current, whenever the seed actually runs. */
function relativeDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Seed data bypasses the API/TripsService entirely (same as every other
 * seed entity), so it must replicate TripsService's TripStop-snapshot step
 * by hand — copying the route's current active stops into the trip at
 * creation, exactly like the real create() flow does. See
 * docs/adr/0012-trip-stop-snapshot-and-lifecycle.md.
 */
async function createSeedTrip(params: {
  schoolId: string;
  routeId: string;
  busId: string;
  driverId: string;
  attendantId?: string;
  serviceDate: string;
  shift: 'MORNING_PICKUP' | 'AFTERNOON_DROP' | 'CUSTOM';
  scheduledStartTime: string;
  scheduledEndTime: string;
  status?: 'SCHEDULED' | 'READY' | 'IN_PROGRESS' | 'COMPLETED';
  startedAt?: Date;
  endedAt?: Date;
}) {
  const stops = await prisma.routeStop.findMany({ where: { routeId: params.routeId, status: 'ACTIVE' }, orderBy: { sequenceNo: 'asc' } });
  return prisma.trip.create({
    data: {
      schoolId: params.schoolId,
      routeId: params.routeId,
      busId: params.busId,
      driverId: params.driverId,
      attendantId: params.attendantId,
      serviceDate: new Date(params.serviceDate),
      shift: params.shift,
      scheduledStartTime: params.scheduledStartTime,
      scheduledEndTime: params.scheduledEndTime,
      status: params.status ?? 'SCHEDULED',
      startedAt: params.startedAt,
      endedAt: params.endedAt,
      tripStops: {
        create: stops.map((s) => ({
          schoolId: params.schoolId,
          sourceRouteStopId: s.id,
          sequenceNo: s.sequenceNo,
          name: s.name,
          address: s.address,
          latitude: s.latitude,
          longitude: s.longitude,
          expectedOffsetMinutes: s.expectedOffsetMinutes,
          mode: s.mode,
        })),
      },
    },
    include: { tripStops: true },
  });
}

function describePermission(key: PermissionKey): { category: string; description: string } {
  const segments = key.split('.');
  const action = segments.at(-1)!.replace(/_/g, ' ');
  const category = segments.length > 2 ? segments.slice(0, -1).join('.') : segments[0]!;
  const resource = segments.length > 2 ? segments.slice(0, -1).join(' ') : segments[0]!;
  return { category, description: `${action} — ${resource}`.replace(/_/g, ' ') };
}

async function seedPermissions() {
  for (const key of PERMISSION_KEYS) {
    const { category, description } = describePermission(key);
    await prisma.permission.upsert({
      where: { key },
      update: { category, description },
      create: { key, category, description },
    });
  }
}

async function seedRolesAndGrants() {
  for (const roleKey of ROLE_KEYS) {
    // Prisma's compound-unique `where` input rejects `null` for a nullable
    // field (schoolId here) — find-then-create instead of upsert().
    let role = await prisma.role.findFirst({ where: { key: roleKey, schoolId: null } });
    role ??= await prisma.role.create({
      data: { key: roleKey, name: roleKey.replace(/_/g, ' '), isSystem: true, schoolId: null },
    });

    const grantedKeys = DEFAULT_ROLE_PERMISSIONS[roleKey];
    for (const permissionKey of grantedKeys) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { key: permissionKey },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
}

async function seedPlatformOperator() {
  // Reserved tenant row for SUPER_ADMIN accounts — see docs/database.md's note
  // on the `users` table: every user has exactly one tenant "home", even
  // platform operators, so there is no null-tenant special case in the schema.
  const platformSchool = await prisma.school.upsert({
    where: { slug: 'platform-operator' },
    update: {},
    create: {
      name: 'Platform Operator',
      slug: 'platform-operator',
      contactEmail: 'platform@school-transport.example',
      status: 'ACTIVE',
    },
  });

  const passwordHash = await argon2.hash(DEV_PASSWORD);
  const superAdmin = await prisma.user.upsert({
    where: { schoolId_email: { schoolId: platformSchool.id, email: 'super.admin@school-transport.example' } },
    update: {},
    create: {
      schoolId: platformSchool.id,
      email: 'super.admin@school-transport.example',
      fullName: 'Platform Super Admin (Dev)',
      passwordHash,
    },
  });

  const role = await prisma.role.findFirstOrThrow({ where: { key: 'SUPER_ADMIN', schoolId: null } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: superAdmin.id, roleId: role.id } },
    update: {},
    create: { userId: superAdmin.id, roleId: role.id },
  });
}

/**
 * The AI model registry (Phase 3 Step 14) is platform-wide, not per-school
 * — see docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md —
 * so it's seeded once here, before either school, and passed into both.
 * Two versions of the same model demonstrate that "updating" a model means
 * registering a new version row, never mutating an existing one — see
 * AiModelsService.
 */
async function seedAiModels() {
  const personDetector = await prisma.aIModel.upsert({
    where: { name_version: { name: 'person-detector', version: '1.3.0' } },
    update: {},
    create: { name: 'person-detector', version: '1.3.0', provider: 'internal', modelType: 'OBJECT_DETECTION', status: 'ACTIVE' },
  });
  await prisma.aIModel.upsert({
    where: { name_version: { name: 'person-detector', version: '1.2.0' } },
    update: {},
    create: { name: 'person-detector', version: '1.2.0', provider: 'internal', modelType: 'OBJECT_DETECTION', status: 'DEPRECATED' },
  });
  const fallDetector = await prisma.aIModel.upsert({
    where: { name_version: { name: 'fall-detector', version: '1.0.0' } },
    update: {},
    create: { name: 'fall-detector', version: '1.0.0', provider: 'internal', modelType: 'ACTION_RECOGNITION', status: 'ACTIVE' },
  });
  return { personDetector, fallDetector };
}

async function seedDemoSchool(aiModels: { personDetector: { id: string; version: string }; fallDetector: { id: string; version: string } }) {
  const passwordHash = await argon2.hash(DEV_PASSWORD);

  const school = await prisma.school.upsert({
    where: { slug: 'demo-school' },
    update: {},
    create: {
      name: 'Demo Public School',
      slug: 'demo-school',
      contactEmail: 'admin@demo-school.example',
      contactPhone: '+91 90000 00000',
      address: { line1: '1 Example Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
      status: 'ACTIVE',
    },
  });

  async function makeStaffUser(email: string, fullName: string, roleKey: (typeof ROLE_KEYS)[number]) {
    const user = await prisma.user.upsert({
      where: { schoolId_email: { schoolId: school.id, email } },
      update: {},
      create: { schoolId: school.id, email, fullName, passwordHash },
    });
    const role = await prisma.role.findFirstOrThrow({ where: { key: roleKey, schoolId: null } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
    return user;
  }

  await makeStaffUser('school.admin@demo-school.example', 'Asha Rao (School Admin, Dev)', 'SCHOOL_ADMIN');
  await makeStaffUser('transport.admin@demo-school.example', 'Vikram Shah (Transport Admin, Dev)', 'TRANSPORT_ADMIN');
  await makeStaffUser('principal@demo-school.example', 'Meera Iyer (Principal, Dev)', 'PRINCIPAL');
  const driverUser = await makeStaffUser('driver@demo-school.example', 'Ramesh Kumar (Driver, Dev)', 'DRIVER');
  const driverUser2 = await makeStaffUser('driver2@demo-school.example', 'Suresh Nair (Driver, Dev)', 'DRIVER');
  const attendantUser = await makeStaffUser('attendant@demo-school.example', 'Sunita Devi (Attendant, Dev)', 'BUS_ATTENDANT');
  const attendantUser2 = await makeStaffUser('attendant2@demo-school.example', 'Lakshmi Menon (Attendant, Dev)', 'BUS_ATTENDANT');

  const driver = await prisma.driver.upsert({
    where: { userId: driverUser.id },
    update: {},
    create: { schoolId: school.id, userId: driverUser.id, licenseNumber: 'KA-DEV-000111' },
  });
  const driver2 = await prisma.driver.upsert({
    where: { userId: driverUser2.id },
    update: {},
    create: { schoolId: school.id, userId: driverUser2.id, licenseNumber: 'KA-DEV-000112' },
  });

  const attendant = await prisma.attendant.upsert({
    where: { userId: attendantUser.id },
    update: {},
    create: { schoolId: school.id, userId: attendantUser.id },
  });
  const attendant2 = await prisma.attendant.upsert({
    where: { userId: attendantUser2.id },
    update: {},
    create: { schoolId: school.id, userId: attendantUser2.id },
  });

  const bus = await prisma.bus.upsert({
    where: { schoolId_registrationNumber: { schoolId: school.id, registrationNumber: 'KA-01-DEV-1234' } },
    update: {},
    create: {
      schoolId: school.id,
      fleetNumber: 'A-01',
      registrationNumber: 'KA-01-DEV-1234',
      capacity: 40,
      make: 'Tata',
      model: 'Starbus',
      manufactureYear: 2019,
    },
  });
  const bus2 = await prisma.bus.upsert({
    where: { schoolId_registrationNumber: { schoolId: school.id, registrationNumber: 'KA-01-DEV-5678' } },
    update: {},
    create: {
      schoolId: school.id,
      fleetNumber: 'A-02',
      registrationNumber: 'KA-01-DEV-5678',
      capacity: 30,
      make: 'Ashok Leyland',
      model: 'Falcon',
      manufactureYear: 2021,
    },
  });

  // A stable, obviously-fake dev credential — printed at the end of seeding
  // (like the dev login password) so a developer can immediately try real
  // GPS ingestion against this device without first calling
  // POST /devices/:id/credential themselves. Regenerating only happens on a
  // fresh DB (create path) — an existing device keeps whatever credential
  // it already has across reseeds.
  const devGpsCredential = generateDeviceCredential();
  const deviceGpsA1 = await prisma.busDevice.upsert({
    where: { deviceType_externalDeviceId: { deviceType: 'GPS_TRACKER', externalDeviceId: 'DEV-GPS-A-0001' } },
    update: {},
    create: {
      schoolId: school.id,
      busId: bus.id,
      deviceType: 'GPS_TRACKER',
      externalDeviceId: 'DEV-GPS-A-0001',
      firmwareVersion: '1.4.0',
      credentialHash: devGpsCredential.hash,
      credentialSetAt: new Date(),
    },
  });
  await prisma.busDevice.upsert({
    where: { deviceType_externalDeviceId: { deviceType: 'GPS_TRACKER', externalDeviceId: 'DEV-GPS-A-0002' } },
    update: {},
    create: { schoolId: school.id, busId: bus2.id, deviceType: 'GPS_TRACKER', externalDeviceId: 'DEV-GPS-A-0002', firmwareVersion: '1.4.0' },
  });
  const deviceEdgeA1 = await prisma.busDevice.upsert({
    where: { deviceType_externalDeviceId: { deviceType: 'EDGE_COMPUTER', externalDeviceId: 'DEV-EDGE-A-0001' } },
    update: {},
    create: { schoolId: school.id, busId: bus.id, deviceType: 'EDGE_COMPUTER', externalDeviceId: 'DEV-EDGE-A-0001' },
  });

  // Cameras (Phase 2 Step 11) — a small, deliberately varied fixture set:
  // two ACTIVE cameras on the primary bus (enough to exercise "a bus has
  // multiple cameras"), one INACTIVE camera to exercise the non-default
  // status in the UI, and no credential issued on any of them by default
  // (matching GPS devices' own "NULL until explicitly issued" convention —
  // see docs/security.md#5.1-device-security). Not seeded: any recording or
  // AI-event data — neither exists in this phase.
  async function upsertCamera(params: {
    busId: string;
    cameraCode: string;
    name: string;
    position: 'FRONT' | 'CABIN' | 'REAR' | 'LEFT' | 'RIGHT' | 'DOOR' | 'CUSTOM';
    serialNumber: string;
    status?: 'ACTIVE' | 'INACTIVE' | 'FAULT' | 'RETIRED';
    // Phase 3 Step 14: the EDGE_COMPUTER BusDevice assigned to process this
    // camera's feed, if any.
    edgeDeviceId?: string;
  }) {
    const device = await prisma.busDevice.upsert({
      where: { deviceType_externalDeviceId: { deviceType: 'CAMERA_CONTROLLER', externalDeviceId: params.serialNumber } },
      update: {},
      create: { schoolId: school.id, busId: params.busId, deviceType: 'CAMERA_CONTROLLER', externalDeviceId: params.serialNumber, firmwareVersion: '2.0.1' },
    });
    return prisma.camera.upsert({
      where: { schoolId_cameraCode: { schoolId: school.id, cameraCode: params.cameraCode } },
      update: {},
      create: {
        schoolId: school.id,
        busId: params.busId,
        busDeviceId: device.id,
        cameraCode: params.cameraCode,
        name: params.name,
        position: params.position,
        manufacturer: 'Hikvision',
        model: 'DS-Fleet-200',
        status: params.status ?? 'ACTIVE',
        edgeDeviceId: params.edgeDeviceId,
      },
    });
  }
  const cameraAFront = await upsertCamera({
    busId: bus.id,
    cameraCode: 'CAM-A-FRONT',
    name: 'Front Camera',
    position: 'FRONT',
    serialNumber: 'DEV-CAM-A-0001',
    edgeDeviceId: deviceEdgeA1.id,
  });
  await upsertCamera({ busId: bus.id, cameraCode: 'CAM-A-CABIN', name: 'Cabin Camera', position: 'CABIN', serialNumber: 'DEV-CAM-A-0002' });
  await upsertCamera({
    busId: bus2.id,
    cameraCode: 'CAM-A2-REAR',
    name: 'Rear Camera',
    position: 'REAR',
    serialNumber: 'DEV-CAM-A-0003',
    status: 'INACTIVE',
  });

  let route = await prisma.route.findFirst({ where: { schoolId: school.id, name: 'Route 1 — Morning' } });
  if (!route) {
    route = await prisma.route.create({
      data: {
        schoolId: school.id,
        code: 'R-01',
        name: 'Route 1 — Morning',
        direction: 'HOME_TO_SCHOOL',
        shift: 'MORNING_PICKUP',
        stops: {
          create: [
            {
              schoolId: school.id,
              sequenceNo: 1,
              name: 'Green Park Gate',
              address: '1 Green Park Road, Bengaluru',
              latitude: 12.9716,
              longitude: 77.5946,
              expectedOffsetMinutes: 0,
              mode: 'PICKUP',
            },
            {
              schoolId: school.id,
              sequenceNo: 2,
              name: 'Lake View Apartments',
              address: '14 Lake View Layout, Bengaluru',
              latitude: 12.9784,
              longitude: 77.6408,
              expectedOffsetMinutes: 10,
              mode: 'PICKUP',
            },
            {
              schoolId: school.id,
              sequenceNo: 3,
              name: 'Cedar Heights',
              address: '22 Cedar Heights, Bengaluru',
              latitude: 12.9855,
              longitude: 77.6023,
              expectedOffsetMinutes: 18,
              mode: 'PICKUP',
            },
            {
              schoolId: school.id,
              sequenceNo: 4,
              name: 'Oak Street Corner',
              address: 'Oak Street & 3rd Cross, Bengaluru',
              latitude: 12.9912,
              longitude: 77.5891,
              expectedOffsetMinutes: 26,
              mode: 'PICKUP',
            },
            {
              schoolId: school.id,
              sequenceNo: 5,
              name: 'Maple Court',
              address: '5 Maple Court, Bengaluru',
              latitude: 12.9760,
              longitude: 77.6150,
              expectedOffsetMinutes: 33,
              mode: 'PICKUP',
            },
          ],
        },
      },
    });
  }

  let afternoonRoute = await prisma.route.findFirst({ where: { schoolId: school.id, name: 'Route 1 — Afternoon' } });
  if (!afternoonRoute) {
    afternoonRoute = await prisma.route.create({
      data: {
        schoolId: school.id,
        code: 'R-02',
        name: 'Route 1 — Afternoon',
        direction: 'SCHOOL_TO_HOME',
        shift: 'AFTERNOON_DROP',
        stops: {
          create: [
            {
              schoolId: school.id,
              sequenceNo: 1,
              name: 'Maple Court',
              address: '5 Maple Court, Bengaluru',
              latitude: 12.9760,
              longitude: 77.6150,
              expectedOffsetMinutes: 8,
              mode: 'DROPOFF',
            },
            {
              schoolId: school.id,
              sequenceNo: 2,
              name: 'Oak Street Corner',
              address: 'Oak Street & 3rd Cross, Bengaluru',
              latitude: 12.9912,
              longitude: 77.5891,
              expectedOffsetMinutes: 16,
              mode: 'DROPOFF',
            },
            {
              schoolId: school.id,
              sequenceNo: 3,
              name: 'Lake View Apartments',
              address: '14 Lake View Layout, Bengaluru',
              latitude: 12.9784,
              longitude: 77.6408,
              expectedOffsetMinutes: 24,
              mode: 'DROPOFF',
            },
            {
              schoolId: school.id,
              sequenceNo: 4,
              name: 'Green Park Gate',
              address: '1 Green Park Road, Bengaluru',
              latitude: 12.9716,
              longitude: 77.5946,
              expectedOffsetMinutes: 33,
              mode: 'DROPOFF',
            },
          ],
        },
      },
    });
  }

  const student = await prisma.student.upsert({
    where: { schoolId_admissionNumber: { schoolId: school.id, admissionNumber: 'DEV-0001' } },
    update: {},
    create: {
      schoolId: school.id,
      admissionNumber: 'DEV-0001',
      fullName: 'Aarav Sharma (Dev)',
      grade: '4',
      section: 'B',
    },
  });

  const student2 = await prisma.student.upsert({
    where: { schoolId_admissionNumber: { schoolId: school.id, admissionNumber: 'DEV-0002' } },
    update: {},
    create: {
      schoolId: school.id,
      admissionNumber: 'DEV-0002',
      fullName: 'Kavya Nair (Dev)',
      grade: '4',
      section: 'B',
    },
  });

  const parent = await prisma.parent.upsert({
    where: { schoolId_phone: { schoolId: school.id, phone: '+91 90000 00001' } },
    update: {},
    create: {
      schoolId: school.id,
      phone: '+91 90000 00001',
      email: 'parent@example.com',
      fullName: 'Priya Sharma (Dev Parent)',
      passwordHash,
    },
  });

  const schoolAdmin = await prisma.user.findFirstOrThrow({
    where: { schoolId: school.id, email: 'school.admin@demo-school.example' },
  });

  await prisma.parentStudent.upsert({
    where: { parentId_studentId: { parentId: parent.id, studentId: student.id } },
    update: {},
    create: {
      schoolId: school.id,
      parentId: parent.id,
      studentId: student.id,
      relationship: 'MOTHER',
      verified: true,
      verifiedBy: schoolAdmin.id,
      verifiedAt: new Date(),
    },
  });

  // Same parent, second child (Phase 1 Step 8) — so the parent dashboard's
  // multi-child case has real data to show without a second dev login.
  await prisma.parentStudent.upsert({
    where: { parentId_studentId: { parentId: parent.id, studentId: student2.id } },
    update: {},
    create: {
      schoolId: school.id,
      parentId: parent.id,
      studentId: student2.id,
      relationship: 'MOTHER',
      verified: true,
      verifiedBy: schoolAdmin.id,
      verifiedAt: new Date(),
    },
  });

  // Trips — see docs/adr/0012-trip-stop-snapshot-and-lifecycle.md for what
  // each field/status means. Realistic fake data across today/yesterday so
  // the dashboard and cross-tenant security tests both have something to
  // exercise regardless of when the seed actually runs.
  // IN_PROGRESS (not SCHEDULED) so attendance actions are immediately
  // testable without first clicking through ready()/start() — one student
  // already boarded (to exercise drop-off/correction), one still EXPECTED
  // (to exercise board/absent).
  const morningTripToday = await createSeedTrip({
    schoolId: school.id,
    routeId: route.id,
    busId: bus.id,
    driverId: driver.id,
    attendantId: attendant.id,
    serviceDate: relativeDate(0),
    shift: 'MORNING_PICKUP',
    scheduledStartTime: '07:00',
    scheduledEndTime: '08:00',
    status: 'IN_PROGRESS',
    startedAt: new Date(),
  });
  const morningEntry1 = await prisma.tripStudent.create({
    data: {
      schoolId: school.id,
      tripId: morningTripToday.id,
      studentId: student.id,
      pickupTripStopId: morningTripToday.tripStops[0]?.id,
      dropoffTripStopId: null,
      membershipStatus: 'ACTIVE',
    },
  });
  await prisma.tripStudent.create({
    data: {
      schoolId: school.id,
      tripId: morningTripToday.id,
      studentId: student2.id,
      pickupTripStopId: morningTripToday.tripStops[1]?.id ?? morningTripToday.tripStops[0]?.id,
      dropoffTripStopId: null,
      membershipStatus: 'ACTIVE',
    },
  });
  const boardedAt = new Date();
  const morningBoardEvent = await prisma.attendanceEvent.create({
    data: {
      schoolId: school.id,
      tripId: morningTripToday.id,
      tripStudentId: morningEntry1.id,
      tripStopId: morningEntry1.pickupTripStopId,
      eventType: 'BOARDING_CONFIRMED',
      recordedBy: (await prisma.user.findFirstOrThrow({ where: { schoolId: school.id, email: 'attendant@demo-school.example' } })).id,
      occurredAt: boardedAt,
    },
  });
  await prisma.tripStudent.update({ where: { id: morningEntry1.id }, data: { currentStatus: 'BOARDED', boardedAt } });

  // A short, realistic GPS history for the in-progress trip's bus — not the
  // seed's job to be exhaustive, just enough for the live dashboard and bus
  // detail page to show something real on first login. Traces roughly
  // between the route's first two stops, ending near "now" so it reads as
  // LIVE immediately after seeding. Ingested directly (bypassing the real
  // HTTP endpoint, like every other seed row bypasses its service layer) —
  // GpsService's own dedup/monotonic rules aren't exercised here, only by
  // the e2e suite.
  const gpsTrackNow = Date.now();
  await prisma.gpsPoint.createMany({
    data: [
      { minutesAgo: 6, latitude: 12.9716, longitude: 77.5946, speedKmh: 0, heading: 40 },
      { minutesAgo: 4, latitude: 12.9738, longitude: 77.6034, speedKmh: 28, heading: 52 },
      { minutesAgo: 2, latitude: 12.9761, longitude: 77.6189, speedKmh: 31, heading: 58 },
      { minutesAgo: 0.5, latitude: 12.9779, longitude: 77.6352, speedKmh: 22, heading: 61 },
    ].map((p) => ({
      schoolId: school.id,
      busId: bus.id,
      deviceId: deviceGpsA1.id,
      tripId: morningTripToday.id,
      latitude: p.latitude,
      longitude: p.longitude,
      speedKmh: p.speedKmh,
      heading: p.heading,
      accuracyM: 6,
      deviceTime: new Date(gpsTrackNow - p.minutesAgo * 60_000),
    })),
  });

  const afternoonTripToday = await createSeedTrip({
    schoolId: school.id,
    routeId: afternoonRoute.id,
    busId: bus2.id,
    driverId: driver2.id,
    attendantId: attendant2.id,
    serviceDate: relativeDate(0),
    shift: 'AFTERNOON_DROP',
    scheduledStartTime: '14:30',
    scheduledEndTime: '15:30',
    status: 'READY',
  });
  await prisma.tripStudent.createMany({
    data: [
      {
        schoolId: school.id,
        tripId: afternoonTripToday.id,
        studentId: student.id,
        pickupTripStopId: null,
        dropoffTripStopId: afternoonTripToday.tripStops[0]?.id,
      },
    ],
    skipDuplicates: true,
  });

  const yesterdayTrip = await createSeedTrip({
    schoolId: school.id,
    routeId: route.id,
    busId: bus.id,
    driverId: driver.id,
    attendantId: attendant.id,
    serviceDate: relativeDate(-1),
    shift: 'MORNING_PICKUP',
    scheduledStartTime: '07:00',
    scheduledEndTime: '08:00',
    status: 'COMPLETED',
    startedAt: new Date(`${relativeDate(-1)}T07:02:00Z`),
    endedAt: new Date(`${relativeDate(-1)}T08:05:00Z`),
  });
  // A completed trip with a full, already-processed attendance history —
  // including one correction, to show that path exists too.
  const yesterdayEntry = await prisma.tripStudent.create({
    data: {
      schoolId: school.id,
      tripId: yesterdayTrip.id,
      studentId: student.id,
      pickupTripStopId: yesterdayTrip.tripStops[0]?.id,
      dropoffTripStopId: null,
      membershipStatus: 'ACTIVE',
    },
  });
  const attendantUserId = (await prisma.user.findFirstOrThrow({ where: { schoolId: school.id, email: 'attendant@demo-school.example' } })).id;
  const wrongAbsentAt = new Date(`${relativeDate(-1)}T07:03:00Z`);
  const correctedBoardAt = new Date(`${relativeDate(-1)}T07:06:00Z`);
  const droppedOffAt = new Date(`${relativeDate(-1)}T08:02:00Z`);
  const originalAbsentEvent = await prisma.attendanceEvent.create({
    data: {
      schoolId: school.id,
      tripId: yesterdayTrip.id,
      tripStudentId: yesterdayEntry.id,
      eventType: 'MARKED_ABSENT',
      recordedBy: attendantUserId,
      occurredAt: wrongAbsentAt,
    },
  });
  await prisma.attendanceEvent.create({
    data: {
      schoolId: school.id,
      tripId: yesterdayTrip.id,
      tripStudentId: yesterdayEntry.id,
      tripStopId: yesterdayEntry.pickupTripStopId,
      eventType: 'BOARDING_CONFIRMED',
      recordedBy: attendantUserId,
      occurredAt: correctedBoardAt,
      correctsEventId: originalAbsentEvent.id,
      notes: 'Marked absent by mistake — student had boarded.',
    },
  });
  const yesterdayDropoffEvent = await prisma.attendanceEvent.create({
    data: {
      schoolId: school.id,
      tripId: yesterdayTrip.id,
      tripStudentId: yesterdayEntry.id,
      eventType: 'DROPPED_OFF',
      recordedBy: attendantUserId,
      occurredAt: droppedOffAt,
    },
  });
  await prisma.tripStudent.update({
    where: { id: yesterdayEntry.id },
    data: { currentStatus: 'DROPPED_OFF', boardedAt: correctedBoardAt, droppedOffAt },
  });

  // A small, realistic notification dataset (Phase 1 Step 9) — inserted
  // directly, the same "bypass the service layer, seed the final state"
  // approach every prior phase's seed already uses (NotificationsService
  // itself has no meaning outside a running app with a live event bus; see
  // docs/adr/0016-notifications-and-alerts.md). Titles/bodies match
  // NotificationTemplates exactly, so the seeded rows are indistinguishable
  // from ones the real pipeline would have produced.
  await prisma.notification.create({
    data: {
      schoolId: school.id,
      recipientType: 'PARENT',
      recipientId: parent.id,
      eventType: 'CHILD_BOARDED',
      entityType: 'ATTENDANCE_EVENT',
      entityId: morningBoardEvent.id,
      title: 'Child boarded',
      body: 'Your child has boarded the school bus.',
      payload: { tripId: morningTripToday.id },
    },
  });
  await prisma.notification.create({
    data: {
      schoolId: school.id,
      recipientType: 'PARENT',
      recipientId: parent.id,
      eventType: 'CHILD_DROPPED_OFF',
      entityType: 'ATTENDANCE_EVENT',
      entityId: yesterdayDropoffEvent.id,
      title: 'Child dropped off',
      body: 'Your child has been dropped off.',
      payload: { tripId: yesterdayTrip.id },
      readAt: new Date(`${relativeDate(-1)}T09:00:00Z`),
    },
  });
  await prisma.notification.create({
    data: {
      schoolId: school.id,
      recipientType: 'USER',
      recipientId: schoolAdmin.id,
      eventType: 'GPS_STALE',
      entityType: 'TRIP',
      entityId: morningTripToday.id,
      title: 'Bus location is stale',
      body: `${bus.fleetNumber ? `Bus ${bus.fleetNumber}` : bus.registrationNumber} has not reported a fresh GPS position recently.`,
      payload: { busId: bus.id },
    },
  });

  // Safety events + emergency management (Phase 2 Step 12) — a small,
  // deliberately varied set: one NEW (untouched), one ACKNOWLEDGED, one
  // RESOLVED safety event; one ACTIVE and one RESOLVED emergency (the
  // latter escalated from a safety event, with a short append-only
  // response-action history). No fake AI events, no fake recordings, no
  // fake external-service contact — see docs/adr/0019.
  await prisma.safetyEvent.create({
    data: {
      schoolId: school.id,
      type: 'DOOR_OPEN',
      severity: 'LOW',
      status: 'NEW',
      source: 'HUMAN_OPERATOR',
      occurredAt: new Date(),
      description: 'Seed data: door sensor reported briefly open while the bus was stationary.',
      createdBy: schoolAdmin.id,
    },
  });
  await prisma.safetyEvent.create({
    data: {
      schoolId: school.id,
      busId: bus.id,
      tripId: morningTripToday.id,
      type: 'DRIVER_ALERT',
      severity: 'MEDIUM',
      status: 'ACKNOWLEDGED',
      source: 'DRIVER',
      occurredAt: new Date(),
      description: 'Seed data: driver reported a minor disruption on board, now under control.',
      createdBy: schoolAdmin.id,
      reviewedBy: schoolAdmin.id,
      reviewedAt: new Date(),
    },
  });
  await prisma.safetyEvent.create({
    data: {
      schoolId: school.id,
      busId: bus.id,
      type: 'MEDICAL',
      severity: 'HIGH',
      status: 'RESOLVED',
      source: 'ATTENDANT',
      occurredAt: new Date(`${relativeDate(-1)}T08:15:00Z`),
      description: 'Seed data: student felt unwell; attendant administered first aid.',
      createdBy: schoolAdmin.id,
      reviewedBy: schoolAdmin.id,
      reviewedAt: new Date(`${relativeDate(-1)}T08:30:00Z`),
      resolutionNote: 'Seed data: student recovered, parent informed by phone at pickup.',
    },
  });

  const escalatedEvent = await prisma.safetyEvent.create({
    data: {
      schoolId: school.id,
      busId: bus.id,
      tripId: morningTripToday.id,
      type: 'ACCIDENT',
      severity: 'CRITICAL',
      status: 'ESCALATED',
      source: 'DRIVER',
      occurredAt: new Date(`${relativeDate(-2)}T07:45:00Z`),
      description: 'Seed data: minor collision while parked; no injuries reported.',
      createdBy: schoolAdmin.id,
      reviewedBy: schoolAdmin.id,
      reviewedAt: new Date(`${relativeDate(-2)}T07:50:00Z`),
    },
  });
  const resolvedEmergency = await prisma.emergency.create({
    data: {
      schoolId: school.id,
      busId: bus.id,
      tripId: morningTripToday.id,
      initiatedBy: schoolAdmin.id,
      sourceSafetyEventId: escalatedEvent.id,
      status: 'RESOLVED',
      severity: 'CRITICAL',
      reason: 'Escalated from safety event: ACCIDENT',
      startedAt: new Date(`${relativeDate(-2)}T07:50:00Z`),
      acknowledgedAt: new Date(`${relativeDate(-2)}T07:52:00Z`),
      resolvedAt: new Date(`${relativeDate(-2)}T08:30:00Z`),
      resolvedBy: schoolAdmin.id,
      resolutionNote: 'Seed data: bus inspected and cleared to resume service; no injuries.',
    },
  });
  await prisma.emergencyAction.create({
    data: { schoolId: school.id, emergencyId: resolvedEmergency.id, actorId: schoolAdmin.id, actionType: 'ACKNOWLEDGED' },
  });
  await prisma.emergencyAction.create({
    data: {
      schoolId: school.id,
      emergencyId: resolvedEmergency.id,
      actorId: schoolAdmin.id,
      actionType: 'CONTACTED_SCHOOL',
      note: 'Seed data: notified the school office.',
    },
  });
  await prisma.emergencyAction.create({
    data: { schoolId: school.id, emergencyId: resolvedEmergency.id, actorId: schoolAdmin.id, actionType: 'RESOLVED' },
  });

  // A currently-ACTIVE emergency, directly triggered (no source safety
  // event) — the "something is happening right now" fixture for the
  // dashboard's default view.
  await prisma.emergency.create({
    data: {
      schoolId: school.id,
      busId: bus.id,
      tripId: morningTripToday.id,
      initiatedBy: schoolAdmin.id,
      status: 'ACTIVE',
      severity: 'CRITICAL',
      reason: 'Seed data: emergency button pressed on board.',
    },
  });

  // Geofencing + operational safety rules (Phase 2 Step 13) — a school
  // premises zone, a depot zone, one enabled ROUTE_DEVIATION rule
  // (school-wide), one enabled GEOFENCE rule (watching the depot), and one
  // DISABLED rule, so the dashboard shows all three states. Coordinates
  // reuse this seed's existing Bengaluru-area stop coordinates for realism.
  // No fake AI events, no fake camera detections — see
  // docs/adr/0020-geofencing-and-operational-safety-rules.md.
  await prisma.geofence.create({
    data: { schoolId: school.id, name: 'School Premises', type: 'SCHOOL', latitude: 12.9716, longitude: 77.5946, radiusMeters: 200 },
  });
  const depotGeofence = await prisma.geofence.create({
    data: { schoolId: school.id, name: 'Bus Depot', type: 'DEPOT', latitude: 12.95, longitude: 77.62, radiusMeters: 150 },
  });
  await prisma.safetyRule.create({
    data: {
      schoolId: school.id,
      type: 'ROUTE_DEVIATION',
      enabled: true,
      severity: 'HIGH',
      thresholdMeters: 300,
      minConsecutivePoints: 3,
      cooldownSeconds: 300,
      createdBy: schoolAdmin.id,
    },
  });
  await prisma.safetyRule.create({
    data: {
      schoolId: school.id,
      type: 'GEOFENCE',
      enabled: true,
      severity: 'MEDIUM',
      geofenceId: depotGeofence.id,
      minConsecutivePoints: 2,
      cooldownSeconds: 300,
      createdBy: schoolAdmin.id,
    },
  });
  await prisma.safetyRule.create({
    data: {
      schoolId: school.id,
      type: 'SPEED',
      enabled: false,
      severity: 'CRITICAL',
      thresholdSpeedKmh: 60,
      minConsecutivePoints: 3,
      cooldownSeconds: 300,
      createdBy: schoolAdmin.id,
    },
  });

  // Edge AI / computer vision pipeline foundation (Phase 3 Step 14) —
  // deterministic candidate observations from the seeded edge device/camera,
  // covering both models and a range of confidence levels. No fake
  // SafetyEvent/Emergency is created from any of these — that boundary is
  // Step 15's job, not this seed's. No face/biometric/identity data of any
  // kind. See docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md.
  const aiObsNow = Date.now();
  await prisma.aIObservation.create({
    data: {
      schoolId: school.id,
      busId: bus.id,
      tripId: morningTripToday.id,
      cameraId: cameraAFront.id,
      edgeDeviceId: deviceEdgeA1.id,
      modelId: aiModels.personDetector.id,
      modelVersion: aiModels.personDetector.version,
      detectionType: 'PERSON_DETECTED',
      confidence: 0.94,
      occurredAt: new Date(aiObsNow - 5 * 60 * 1000),
      windowStart: new Date(Math.floor((aiObsNow - 5 * 60 * 1000) / 30_000) * 30_000),
      metadata: { count: 4 },
    },
  });
  await prisma.aIObservation.create({
    data: {
      schoolId: school.id,
      busId: bus.id,
      tripId: morningTripToday.id,
      cameraId: cameraAFront.id,
      edgeDeviceId: deviceEdgeA1.id,
      modelId: aiModels.fallDetector.id,
      modelVersion: aiModels.fallDetector.version,
      detectionType: 'FALL_DETECTED',
      confidence: 0.89,
      occurredAt: new Date(aiObsNow - 3 * 60 * 1000),
      windowStart: new Date(Math.floor((aiObsNow - 3 * 60 * 1000) / 30_000) * 30_000),
      metadata: { frameWindowMs: 4000 },
    },
  });
  await prisma.aIObservation.create({
    data: {
      schoolId: school.id,
      busId: bus.id,
      tripId: morningTripToday.id,
      cameraId: cameraAFront.id,
      edgeDeviceId: deviceEdgeA1.id,
      modelId: aiModels.personDetector.id,
      modelVersion: aiModels.personDetector.version,
      detectionType: 'UNUSUAL_MOTION',
      confidence: 0.61,
      occurredAt: new Date(aiObsNow - 1 * 60 * 1000),
      windowStart: new Date(Math.floor((aiObsNow - 1 * 60 * 1000) / 30_000) * 30_000),
    },
  });

  return { school, bus, route, driver, attendant, student, parent, deviceGpsA1, devGpsCredential };
}

/**
 * A second, deliberately leaner school — exists specifically so tests (and a
 * developer poking around manually) have a genuine cross-tenant pair: an
 * admin/staff/parent/students that must NEVER be visible to School A's users,
 * and vice versa. See docs/security.md#14-tenant-isolation.
 */
async function seedSchoolB(aiModels: { personDetector: { id: string; version: string }; fallDetector: { id: string; version: string } }) {
  const passwordHash = await argon2.hash(DEV_PASSWORD);

  const school = await prisma.school.upsert({
    where: { slug: 'demo-school-b' },
    update: {},
    create: {
      name: 'Demo Public School B',
      slug: 'demo-school-b',
      contactEmail: 'admin@demo-school-b.example',
      contactPhone: '+91 90000 00100',
      address: { line1: '2 Example Avenue', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
      status: 'ACTIVE',
    },
  });

  async function makeStaffUser(email: string, fullName: string, roleKey: (typeof ROLE_KEYS)[number]) {
    const user = await prisma.user.upsert({
      where: { schoolId_email: { schoolId: school.id, email } },
      update: {},
      create: { schoolId: school.id, email, fullName, passwordHash },
    });
    const role = await prisma.role.findFirstOrThrow({ where: { key: roleKey, schoolId: null } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
    return user;
  }

  const admin = await makeStaffUser('school.admin@demo-school-b.example', 'Karan Mehta (School Admin B, Dev)', 'SCHOOL_ADMIN');
  await makeStaffUser('transport.manager@demo-school-b.example', 'Neha Joshi (Transport Manager B, Dev)', 'TRANSPORT_MANAGER');

  const driverUserB = await makeStaffUser('driver@demo-school-b.example', 'Anil Kumar (Driver, Dev, School B)', 'DRIVER');
  const attendantUserB = await makeStaffUser('attendant@demo-school-b.example', 'Kavya Reddy (Attendant, Dev, School B)', 'BUS_ATTENDANT');

  const driverB = await prisma.driver.upsert({
    where: { userId: driverUserB.id },
    update: {},
    create: { schoolId: school.id, userId: driverUserB.id, licenseNumber: 'MH-DEV-000211' },
  });
  const attendantB = await prisma.attendant.upsert({
    where: { userId: attendantUserB.id },
    update: {},
    create: { schoolId: school.id, userId: attendantUserB.id },
  });

  const busB1 = await prisma.bus.upsert({
    where: { schoolId_registrationNumber: { schoolId: school.id, registrationNumber: 'MH-01-DEV-2222' } },
    update: {},
    create: {
      schoolId: school.id,
      fleetNumber: 'B-01',
      registrationNumber: 'MH-01-DEV-2222',
      capacity: 35,
      make: 'Tata',
      model: 'Starbus',
      manufactureYear: 2020,
    },
  });
  await prisma.bus.upsert({
    where: { schoolId_registrationNumber: { schoolId: school.id, registrationNumber: 'MH-01-DEV-3333' } },
    update: {},
    create: {
      schoolId: school.id,
      fleetNumber: 'B-02',
      registrationNumber: 'MH-01-DEV-3333',
      capacity: 25,
      make: 'Force Motors',
      model: 'Traveller',
      manufactureYear: 2018,
    },
  });

  await prisma.busDevice.upsert({
    where: { deviceType_externalDeviceId: { deviceType: 'GPS_TRACKER', externalDeviceId: 'DEV-GPS-B-0001' } },
    update: {},
    create: { schoolId: school.id, busId: busB1.id, deviceType: 'GPS_TRACKER', externalDeviceId: 'DEV-GPS-B-0001', firmwareVersion: '1.3.2' },
  });

  // One camera for School B — exists solely so cross-tenant isolation
  // (School A must never see it, and vice versa) has a real second-tenant
  // row to test against, same reasoning as this school's GPS device above.
  const cameraDeviceB1 = await prisma.busDevice.upsert({
    where: { deviceType_externalDeviceId: { deviceType: 'CAMERA_CONTROLLER', externalDeviceId: 'DEV-CAM-B-0001' } },
    update: {},
    create: { schoolId: school.id, busId: busB1.id, deviceType: 'CAMERA_CONTROLLER', externalDeviceId: 'DEV-CAM-B-0001', firmwareVersion: '2.0.1' },
  });
  // Phase 3 Step 14: a separate edge-AI device, exists solely for the same
  // cross-tenant-isolation reason as the camera/GPS device above.
  const deviceEdgeB1 = await prisma.busDevice.upsert({
    where: { deviceType_externalDeviceId: { deviceType: 'EDGE_COMPUTER', externalDeviceId: 'DEV-EDGE-B-0001' } },
    update: {},
    create: { schoolId: school.id, busId: busB1.id, deviceType: 'EDGE_COMPUTER', externalDeviceId: 'DEV-EDGE-B-0001' },
  });
  const cameraBFront = await prisma.camera.upsert({
    where: { schoolId_cameraCode: { schoolId: school.id, cameraCode: 'CAM-B-FRONT' } },
    update: {},
    create: {
      schoolId: school.id,
      busId: busB1.id,
      busDeviceId: cameraDeviceB1.id,
      cameraCode: 'CAM-B-FRONT',
      name: 'Front Camera',
      position: 'FRONT',
      manufacturer: 'Hikvision',
      model: 'DS-Fleet-200',
      edgeDeviceId: deviceEdgeB1.id,
    },
  });

  let routeB = await prisma.route.findFirst({ where: { schoolId: school.id, name: 'Route 1 — Morning (School B)' } });
  if (!routeB) {
    routeB = await prisma.route.create({
      data: {
        schoolId: school.id,
        code: 'B-R-01',
        name: 'Route 1 — Morning (School B)',
        direction: 'HOME_TO_SCHOOL',
        shift: 'MORNING_PICKUP',
        stops: {
          create: [
            {
              schoolId: school.id,
              sequenceNo: 1,
              name: 'Marine Drive Junction',
              address: 'Marine Drive, Mumbai',
              latitude: 18.9432,
              longitude: 72.8235,
              expectedOffsetMinutes: 0,
              mode: 'PICKUP',
            },
            {
              schoolId: school.id,
              sequenceNo: 2,
              name: 'Bandra Market',
              address: 'Bandra Market, Mumbai',
              latitude: 19.0596,
              longitude: 72.8295,
              expectedOffsetMinutes: 15,
              mode: 'PICKUP',
            },
            {
              schoolId: school.id,
              sequenceNo: 3,
              name: 'Andheri Circle',
              address: 'Andheri Circle, Mumbai',
              latitude: 19.1197,
              longitude: 72.8468,
              expectedOffsetMinutes: 28,
              mode: 'PICKUP',
            },
          ],
        },
      },
    });
  }

  const studentA1 = await prisma.student.upsert({
    where: { schoolId_admissionNumber: { schoolId: school.id, admissionNumber: 'DEV-B-0001' } },
    update: {},
    create: { schoolId: school.id, admissionNumber: 'DEV-B-0001', fullName: 'Diya Patel (Dev, School B)', grade: '3', section: 'A' },
  });
  const studentB1 = await prisma.student.upsert({
    where: { schoolId_admissionNumber: { schoolId: school.id, admissionNumber: 'DEV-B-0002' } },
    update: {},
    create: { schoolId: school.id, admissionNumber: 'DEV-B-0002', fullName: 'Ishaan Gupta (Dev, School B)', grade: '5', section: 'C' },
  });

  const parent = await prisma.parent.upsert({
    where: { schoolId_phone: { schoolId: school.id, phone: '+91 90000 00101' } },
    update: {},
    create: {
      schoolId: school.id,
      phone: '+91 90000 00101',
      email: 'parent@demo-school-b.example',
      fullName: 'Ritu Gupta (Dev Parent, School B)',
      passwordHash,
    },
  });

  await prisma.parentStudent.upsert({
    where: { parentId_studentId: { parentId: parent.id, studentId: studentB1.id } },
    update: {},
    create: {
      schoolId: school.id,
      parentId: parent.id,
      studentId: studentB1.id,
      relationship: 'MOTHER',
      verified: true,
      verifiedBy: admin.id,
      verifiedAt: new Date(),
    },
  });

  const morningTripB = await createSeedTrip({
    schoolId: school.id,
    routeId: routeB.id,
    busId: busB1.id,
    driverId: driverB.id,
    attendantId: attendantB.id,
    serviceDate: relativeDate(0),
    shift: 'MORNING_PICKUP',
    scheduledStartTime: '07:15',
    scheduledEndTime: '08:10',
    status: 'IN_PROGRESS',
    startedAt: new Date(),
  });
  const tripBEntry = await prisma.tripStudent.create({
    data: {
      schoolId: school.id,
      tripId: morningTripB.id,
      studentId: studentB1.id,
      pickupTripStopId: morningTripB.tripStops[0]?.id,
      dropoffTripStopId: null,
      membershipStatus: 'ACTIVE',
    },
  });
  const tripBBoardedAt = new Date();
  await prisma.attendanceEvent.create({
    data: {
      schoolId: school.id,
      tripId: morningTripB.id,
      tripStudentId: tripBEntry.id,
      tripStopId: tripBEntry.pickupTripStopId,
      eventType: 'BOARDING_CONFIRMED',
      recordedBy: (await prisma.user.findFirstOrThrow({ where: { schoolId: school.id, email: 'attendant@demo-school-b.example' } })).id,
      occurredAt: tripBBoardedAt,
    },
  });
  await prisma.tripStudent.update({ where: { id: tripBEntry.id }, data: { currentStatus: 'BOARDED', boardedAt: tripBBoardedAt } });

  // One safety event (Phase 2 Step 12) — exists solely so cross-tenant
  // isolation has a real second-tenant row to test against, same reasoning
  // as this school's single camera/GPS device fixtures.
  await prisma.safetyEvent.create({
    data: {
      schoolId: school.id,
      busId: busB1.id,
      tripId: morningTripB.id,
      type: 'MANUAL_ALERT',
      severity: 'LOW',
      status: 'NEW',
      source: 'HUMAN_OPERATOR',
      occurredAt: new Date(),
      description: 'Seed data: routine manual note.',
      createdBy: admin.id,
    },
  });

  // One geofence + one enabled rule (Phase 2 Step 13) — cross-tenant
  // isolation fixture, same reasoning as the safety event above.
  const depotGeofenceB = await prisma.geofence.create({
    data: { schoolId: school.id, name: 'Bus Depot (School B)', type: 'DEPOT', latitude: 19.05, longitude: 72.85, radiusMeters: 150 },
  });
  await prisma.safetyRule.create({
    data: {
      schoolId: school.id,
      type: 'GEOFENCE',
      enabled: true,
      severity: 'MEDIUM',
      geofenceId: depotGeofenceB.id,
      minConsecutivePoints: 2,
      cooldownSeconds: 300,
      createdBy: admin.id,
    },
  });

  // One AI observation (Phase 3 Step 14) — cross-tenant isolation fixture,
  // same reasoning as the safety event/geofence above.
  const aiObsNowB = Date.now();
  await prisma.aIObservation.create({
    data: {
      schoolId: school.id,
      busId: busB1.id,
      tripId: morningTripB.id,
      cameraId: cameraBFront.id,
      edgeDeviceId: deviceEdgeB1.id,
      modelId: aiModels.personDetector.id,
      modelVersion: aiModels.personDetector.version,
      detectionType: 'PERSON_DETECTED',
      confidence: 0.9,
      occurredAt: new Date(aiObsNowB - 2 * 60 * 1000),
      windowStart: new Date(Math.floor((aiObsNowB - 2 * 60 * 1000) / 30_000) * 30_000),
      metadata: { count: 2 },
    },
  });

  return { school, students: [studentA1, studentB1], parent, admin };
}

async function main() {
  console.log('Seeding permissions...');
  await seedPermissions();
  console.log('Seeding system roles and permission grants...');
  await seedRolesAndGrants();
  console.log('Seeding platform operator tenant...');
  await seedPlatformOperator();
  console.log('Seeding AI model registry...');
  const aiModels = await seedAiModels();
  console.log('Seeding demo school (A)...');
  const demo = await seedDemoSchool(aiModels);
  console.log('Seeding second demo school (B) for cross-tenant testing...');
  const demoB = await seedSchoolB(aiModels);
  console.log(
    `Done. Schools: ${demo.school.slug}, ${demoB.school.slug}. Dev login password for every seeded account: ${DEV_PASSWORD}`,
  );
  console.log(
    `Dev GPS device credential (device ${demo.deviceGpsA1.externalDeviceId}, bus ${demo.bus.registrationNumber}): ${demo.devGpsCredential.raw}`,
  );
  console.log(
    `  Try it: curl -X POST http://localhost:3001/api/v1/telemetry/gps -H "Authorization: Bearer ${demo.devGpsCredential.raw}" -H "Content-Type: application/json" -d '{"latitude":12.98,"longitude":77.64,"recordedAt":"${new Date().toISOString()}"}'`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
