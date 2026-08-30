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

async function seedDemoSchool() {
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
  await prisma.driver.upsert({
    where: { userId: driverUser2.id },
    update: {},
    create: { schoolId: school.id, userId: driverUser2.id, licenseNumber: 'KA-DEV-000112' },
  });

  const attendant = await prisma.attendant.upsert({
    where: { userId: attendantUser.id },
    update: {},
    create: { schoolId: school.id, userId: attendantUser.id },
  });
  await prisma.attendant.upsert({
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

  await prisma.busDevice.upsert({
    where: { deviceType_externalDeviceId: { deviceType: 'GPS_TRACKER', externalDeviceId: 'DEV-GPS-A-0001' } },
    update: {},
    create: { schoolId: school.id, busId: bus.id, deviceType: 'GPS_TRACKER', externalDeviceId: 'DEV-GPS-A-0001', firmwareVersion: '1.4.0' },
  });
  await prisma.busDevice.upsert({
    where: { deviceType_externalDeviceId: { deviceType: 'GPS_TRACKER', externalDeviceId: 'DEV-GPS-A-0002' } },
    update: {},
    create: { schoolId: school.id, busId: bus2.id, deviceType: 'GPS_TRACKER', externalDeviceId: 'DEV-GPS-A-0002', firmwareVersion: '1.4.0' },
  });
  await prisma.busDevice.upsert({
    where: { deviceType_externalDeviceId: { deviceType: 'EDGE_COMPUTER', externalDeviceId: 'DEV-EDGE-A-0001' } },
    update: {},
    create: { schoolId: school.id, busId: bus.id, deviceType: 'EDGE_COMPUTER', externalDeviceId: 'DEV-EDGE-A-0001' },
  });

  let route = await prisma.route.findFirst({ where: { schoolId: school.id, name: 'Route 1 — Morning' } });
  if (!route) {
    route = await prisma.route.create({
      data: {
        schoolId: school.id,
        name: 'Route 1 — Morning',
        shift: 'MORNING_PICKUP',
        defaultBusId: bus.id,
        stops: {
          create: [
            {
              schoolId: school.id,
              sequenceNo: 1,
              name: 'Green Park Gate',
              latitude: 12.9716,
              longitude: 77.5946,
              expectedOffsetMinutes: 0,
            },
            {
              schoolId: school.id,
              sequenceNo: 2,
              name: 'Lake View Apartments',
              latitude: 12.9784,
              longitude: 77.6408,
              expectedOffsetMinutes: 10,
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

  return { school, bus, route, driver, attendant, student, parent };
}

/**
 * A second, deliberately leaner school — exists specifically so tests (and a
 * developer poking around manually) have a genuine cross-tenant pair: an
 * admin/staff/parent/students that must NEVER be visible to School A's users,
 * and vice versa. See docs/security.md#14-tenant-isolation.
 */
async function seedSchoolB() {
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

  await prisma.driver.upsert({
    where: { userId: driverUserB.id },
    update: {},
    create: { schoolId: school.id, userId: driverUserB.id, licenseNumber: 'MH-DEV-000211' },
  });
  await prisma.attendant.upsert({
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

  return { school, students: [studentA1, studentB1], parent, admin };
}

async function main() {
  console.log('Seeding permissions...');
  await seedPermissions();
  console.log('Seeding system roles and permission grants...');
  await seedRolesAndGrants();
  console.log('Seeding platform operator tenant...');
  await seedPlatformOperator();
  console.log('Seeding demo school (A)...');
  const demo = await seedDemoSchool();
  console.log('Seeding second demo school (B) for cross-tenant testing...');
  const demoB = await seedSchoolB();
  console.log(
    `Done. Schools: ${demo.school.slug}, ${demoB.school.slug}. Dev login password for every seeded account: ${DEV_PASSWORD}`,
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
