/**
 * Production bootstrap — the minimum needed to make a freshly migrated
 * database usable. Unlike prisma/seed.ts this creates NO demo data: no fake
 * schools, students, buses, or shared password. It is idempotent and safe to
 * run against a real database.
 *
 * It does two things:
 *   1. Seeds the system RBAC catalogue (permissions, roles, role→permission
 *      grants) exactly as the application expects it — an empty catalogue
 *      makes every account useless.
 *   2. Creates the first platform SUPER_ADMIN (and optionally one school plus
 *      its first SCHOOL_ADMIN) from environment variables, so a human can log
 *      in and build the rest through the product.
 *
 * Usage (privileged connection — same DATABASE_URL the Prisma CLI uses):
 *   BOOTSTRAP_ADMIN_EMAIL=you@example.com \
 *   BOOTSTRAP_ADMIN_PASSWORD='<a-strong-password>' \
 *   DATABASE_URL='postgresql://...' \
 *   pnpm exec tsx prisma/bootstrap.ts
 *
 * Optional school (omit to bootstrap the platform admin only):
 *   BOOTSTRAP_SCHOOL_NAME='Springfield Public School' \
 *   BOOTSTRAP_SCHOOL_SLUG='springfield-public-school' \
 *   BOOTSTRAP_SCHOOL_ADMIN_EMAIL='admin@springfield.example' \
 *   BOOTSTRAP_SCHOOL_ADMIN_PASSWORD='<a-strong-password>'
 *
 * Never commit the passwords. This script only reads them from the
 * environment and never logs them.
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

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required (see the header of prisma/bootstrap.ts).`);
  }
  return value;
}

function describePermission(key: PermissionKey): { category: string; description: string } {
  const segments = key.split('.');
  const action = segments.at(-1)!.replace(/_/g, ' ');
  const category = segments.length > 2 ? segments.slice(0, -1).join('.') : segments[0]!;
  const resource = segments.length > 2 ? segments.slice(0, -1).join(' ') : segments[0]!;
  return { category, description: `${action} — ${resource}`.replace(/_/g, ' ') };
}

async function seedRbac(): Promise<void> {
  for (const key of PERMISSION_KEYS) {
    const { category, description } = describePermission(key);
    await prisma.permission.upsert({
      where: { key },
      update: { category, description },
      create: { key, category, description },
    });
  }

  for (const roleKey of ROLE_KEYS) {
    let role = await prisma.role.findFirst({ where: { key: roleKey, schoolId: null } });
    role ??= await prisma.role.create({
      data: { key: roleKey, name: roleKey.replace(/_/g, ' '), isSystem: true, schoolId: null },
    });

    for (const permissionKey of DEFAULT_ROLE_PERMISSIONS[roleKey]) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
}

async function makeAdmin(params: {
  schoolId: string;
  email: string;
  fullName: string;
  password: string;
  roleKey: string;
}): Promise<void> {
  const passwordHash = await argon2.hash(params.password);
  const user = await prisma.user.upsert({
    where: { schoolId_email: { schoolId: params.schoolId, email: params.email.toLowerCase() } },
    update: { fullName: params.fullName, passwordHash },
    create: {
      schoolId: params.schoolId,
      email: params.email.toLowerCase(),
      fullName: params.fullName,
      passwordHash,
    },
  });
  const role = await prisma.role.findFirstOrThrow({ where: { key: params.roleKey, schoolId: null } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });
}

async function main(): Promise<void> {
  console.log('Seeding system roles and permission grants...');
  await seedRbac();

  console.log('Creating platform SUPER_ADMIN (idempotent)...');
  const platformSchool = await prisma.school.upsert({
    where: { slug: 'platform-operator' },
    update: {},
    create: {
      name: 'Platform Operator',
      slug: 'platform-operator',
      contactEmail: requiredEnv('BOOTSTRAP_ADMIN_EMAIL').toLowerCase(),
      status: 'ACTIVE',
    },
  });
  await makeAdmin({
    schoolId: platformSchool.id,
    email: requiredEnv('BOOTSTRAP_ADMIN_EMAIL'),
    fullName: process.env.BOOTSTRAP_ADMIN_NAME ?? 'Platform Super Admin',
    password: requiredEnv('BOOTSTRAP_ADMIN_PASSWORD'),
    roleKey: 'SUPER_ADMIN',
  });

  if (process.env.BOOTSTRAP_SCHOOL_NAME && process.env.BOOTSTRAP_SCHOOL_SLUG) {
    console.log(`Creating school '${process.env.BOOTSTRAP_SCHOOL_SLUG}' and its SCHOOL_ADMIN...`);
    const school = await prisma.school.upsert({
      where: { slug: process.env.BOOTSTRAP_SCHOOL_SLUG },
      update: { name: process.env.BOOTSTRAP_SCHOOL_NAME },
      create: {
        name: process.env.BOOTSTRAP_SCHOOL_NAME,
        slug: process.env.BOOTSTRAP_SCHOOL_SLUG,
        status: 'ACTIVE',
        contactEmail: requiredEnv('BOOTSTRAP_SCHOOL_ADMIN_EMAIL').toLowerCase(),
      },
    });
    await makeAdmin({
      schoolId: school.id,
      email: requiredEnv('BOOTSTRAP_SCHOOL_ADMIN_EMAIL'),
      fullName: process.env.BOOTSTRAP_SCHOOL_ADMIN_NAME ?? 'School Admin',
      password: requiredEnv('BOOTSTRAP_SCHOOL_ADMIN_PASSWORD'),
      roleKey: 'SCHOOL_ADMIN',
    });
  }

  console.log('Bootstrap complete.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
