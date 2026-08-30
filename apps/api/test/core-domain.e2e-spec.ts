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
import { TokenService } from '../src/auth/services/token.service';
import {
  AUTH_NOTIFICATION_ADAPTER,
  type AuthNotificationAdapter,
} from '../src/auth/notifications/notification-adapter.interface';

describe('School/User/Student/Parent domain (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const passwordService = new PasswordService();
  const suffix = Date.now();
  const STAFF_PASSWORD = 'CorrectHorse123';
  const PARENT_PASSWORD = 'ParentPassw0rd1';

  let capturedInvitationToken: string | undefined;
  const mockNotificationAdapter: AuthNotificationAdapter = {
    sendPasswordResetLink: async () => {},
    sendInvitationLink: async (params) => {
      capturedInvitationToken = params.invitationToken;
    },
  };

  // Fixtures
  let schoolA: { id: string };
  let schoolB: { id: string };
  let adminA: { id: string; email: string };
  let driverA: { id: string; email: string }; // holds no students.* permissions — used for 403 tests
  let adminB: { id: string; email: string };
  let studentA1: { id: string };
  let studentB1: { id: string };
  let parentA: { id: string; phone: string };
  let parentA2: { id: string; phone: string }; // a second, unrelated parent in school A
  let parentB: { id: string; phone: string };

  const api = () => request(app.getHttpServer());

  async function loginAs(email: string) {
    const res = await api().post('/api/v1/auth/staff/login').send({ email, password: STAFF_PASSWORD });
    return res.body.accessToken as string;
  }
  async function loginParentAs(phone: string) {
    const res = await api().post('/api/v1/auth/parent/login').send({ phone, password: PARENT_PASSWORD });
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_NOTIFICATION_ADAPTER)
      .useValue(mockNotificationAdapter)
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
      tx.school.create({ data: { name: 'Core Domain Test School A', slug: `core-test-a-${suffix}`, contactEmail: `a-${suffix}@core-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Core Domain Test School B', slug: `core-test-b-${suffix}`, contactEmail: `b-${suffix}@core-test.example` } }),
    );

    const schoolAdminRole = await prisma.runAsPlatformAdmin((tx) => tx.role.findFirstOrThrow({ where: { key: 'SCHOOL_ADMIN', schoolId: null } }));
    const driverRole = await prisma.runAsPlatformAdmin((tx) => tx.role.findFirstOrThrow({ where: { key: 'DRIVER', schoolId: null } }));

    adminA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({ data: { schoolId: schoolA.id, email: `admin.a.${suffix}@core-test.example`, fullName: 'Admin A', passwordHash: staffHash } }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) => tx.userRole.create({ data: { userId: adminA.id, roleId: schoolAdminRole.id } }));

    driverA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({ data: { schoolId: schoolA.id, email: `driver.a.${suffix}@core-test.example`, fullName: 'Driver A', passwordHash: staffHash } }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) => tx.userRole.create({ data: { userId: driverA.id, roleId: driverRole.id } }));

    adminB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.user.create({ data: { schoolId: schoolB.id, email: `admin.b.${suffix}@core-test.example`, fullName: 'Admin B', passwordHash: staffHash } }),
    );
    await prisma.runInTenantContext(schoolB.id, (tx) => tx.userRole.create({ data: { userId: adminB.id, roleId: schoolAdminRole.id } }));

    studentA1 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `CORE-A-${suffix}-1`, fullName: 'Student A1' } }),
    );
    parentB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolB.id, phone: `+9180003${suffix.toString().slice(-5)}`, fullName: 'Parent B', passwordHash: parentHash } }),
    );

    studentB1 = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolB.id, admissionNumber: `CORE-B-${suffix}-1`, fullName: 'Student B1' } }),
    );

    parentA = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9180000${suffix.toString().slice(-5)}`, fullName: 'Parent A', passwordHash: parentHash } }),
    );
    parentA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({ data: { schoolId: schoolA.id, phone: `+9180001${suffix.toString().slice(-5)}`, fullName: 'Parent A2', passwordHash: parentHash } }),
    );
    // A second student, linked ONLY to parentA2 — used for "parent cannot access another parent's child."
    const studentA2 = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `CORE-A-${suffix}-2`, fullName: 'Student A2' } }),
    );

    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parentStudent.create({ data: { schoolId: schoolA.id, parentId: parentA.id, studentId: studentA1.id, verified: true } }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parentStudent.create({ data: { schoolId: schoolA.id, parentId: parentA2.id, studentId: studentA2.id, verified: true } }),
    );
  });

  afterAll(async () => {
    for (const schoolId of [schoolA.id, schoolB.id]) {
      await prisma.runInTenantContext(schoolId, async (tx) => {
        await tx.parentStudent.deleteMany({ where: { schoolId } });
        await tx.invitation.deleteMany({ where: { schoolId } });
        await tx.refreshToken.deleteMany({ where: { schoolId } });
        await tx.auditLog.deleteMany({ where: { schoolId } });
        await tx.student.deleteMany({ where: { schoolId } });
        await tx.parent.deleteMany({ where: { schoolId } });
        await tx.user.deleteMany({ where: { schoolId } });
        await tx.school.delete({ where: { id: schoolId } });
      });
    }
    await app.close();
  });

  // ---------------------------------------------------------------------
  // Schools
  // ---------------------------------------------------------------------
  describe('schools', () => {
    it('an authorized admin can access their own school', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().get(`/api/v1/schools/${schoolA.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(schoolA.id);
    });

    it('a staff member without schools.read cannot access the school', async () => {
      const token = await loginAs(driverA.email);
      const res = await api().get(`/api/v1/schools/${schoolA.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it("cross-tenant: School A admin cannot GET School B (404, not 403)", async () => {
      const token = await loginAs(adminA.email);
      const res = await api().get(`/api/v1/schools/${schoolB.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('a school admin can update routine profile fields', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .patch(`/api/v1/schools/${schoolA.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Renamed Core Test School A' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Renamed Core Test School A');
    });

    it("a client-supplied `status` field on the profile-update body has no effect (DTO structurally excludes it)", async () => {
      const token = await loginAs(adminA.email);
      await api()
        .patch(`/api/v1/schools/${schoolA.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Still A', status: 'SUSPENDED' });
      const check = await api().get(`/api/v1/schools/${schoolA.id}`).set('Authorization', `Bearer ${token}`);
      expect(check.body.status).toBe('ACTIVE');
    });

    it('a school admin (without platform.schools.manage) cannot change school status', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .patch(`/api/v1/schools/${schoolA.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'SUSPENDED' });
      expect(res.status).toBe(403);
    });

    it('a SUSPENDED school blocks login for all of its users', async () => {
      await prisma.runAsPlatformAdmin((tx) => tx.school.update({ where: { id: schoolB.id }, data: { status: 'SUSPENDED' } }));
      const res = await api().post('/api/v1/auth/staff/login').send({ email: adminB.email, password: STAFF_PASSWORD });
      expect(res.status).toBe(401);
      await prisma.runAsPlatformAdmin((tx) => tx.school.update({ where: { id: schoolB.id }, data: { status: 'ACTIVE' } }));
    });
  });

  // ---------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------
  describe('staff (users)', () => {
    it('an authorized admin can invite staff and the invitee can accept and log in', async () => {
      const token = await loginAs(adminA.email);
      capturedInvitationToken = undefined;
      const inviteRes = await api()
        .post('/api/v1/users/invite')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: `invitee.${suffix}@core-test.example`, fullName: 'Invitee Staff', roleKeys: ['TRANSPORT_MANAGER'] });
      expect(inviteRes.status).toBe(201);
      expect(inviteRes.body.status).toBe('INVITED');
      expect(capturedInvitationToken).toEqual(expect.any(String));

      const acceptRes = await api()
        .post('/api/v1/invitations/accept')
        .send({ token: capturedInvitationToken, password: 'InviteeNewPass123' });
      expect(acceptRes.status).toBe(200);

      const loginRes = await api()
        .post('/api/v1/auth/staff/login')
        .send({ email: `invitee.${suffix}@core-test.example`, password: 'InviteeNewPass123' });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.principal.roles).toContain('TRANSPORT_MANAGER');
    });

    it('a staff member without users.create cannot invite staff', async () => {
      const token = await loginAs(driverA.email);
      const res = await api()
        .post('/api/v1/users/invite')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: `nope.${suffix}@core-test.example`, fullName: 'Nope', roleKeys: ['DRIVER'] });
      expect(res.status).toBe(403);
    });

    it('privilege escalation: a non-SUPER_ADMIN admin cannot grant the SUPER_ADMIN role', async () => {
      const token = await loginAs(adminA.email);
      const res = await api()
        .post('/api/v1/users/invite')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: `escalate.${suffix}@core-test.example`, fullName: 'Escalator', roleKeys: ['SUPER_ADMIN'] });
      expect(res.status).toBe(403);
    });

    it("cross-tenant: School A admin cannot GET or PATCH a School B staff member", async () => {
      const token = await loginAs(adminA.email);
      const getRes = await api().get(`/api/v1/users/${adminB.id}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(404);
      const patchRes = await api().patch(`/api/v1/users/${adminB.id}`).set('Authorization', `Bearer ${token}`).send({ fullName: 'Hacked' });
      expect(patchRes.status).toBe(404);
    });

    it('an admin cannot suspend their own account', async () => {
      const token = await loginAs(adminA.email);
      const res = await api().post(`/api/v1/users/${adminA.id}/suspend`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('suspend then activate works and affects login', async () => {
      const token = await loginAs(adminA.email);
      const targetHash = await passwordService.hash(STAFF_PASSWORD);
      const target = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.user.create({ data: { schoolId: schoolA.id, email: `suspend-target.${suffix}@core-test.example`, fullName: 'Suspend Target', passwordHash: targetHash, status: 'ACTIVE' } }),
      );

      const suspendRes = await api().post(`/api/v1/users/${target.id}/suspend`).set('Authorization', `Bearer ${token}`);
      expect(suspendRes.status).toBe(200);
      expect(suspendRes.body.status).toBe('SUSPENDED');

      const loginWhileSuspended = await api().post('/api/v1/auth/staff/login').send({ email: target.email, password: STAFF_PASSWORD });
      expect(loginWhileSuspended.status).toBe(401);

      const activateRes = await api().post(`/api/v1/users/${target.id}/activate`).set('Authorization', `Bearer ${token}`);
      expect(activateRes.status).toBe(200);
      expect(activateRes.body.status).toBe('ACTIVE');

      const loginAfterActivate = await api().post('/api/v1/auth/staff/login').send({ email: target.email, password: STAFF_PASSWORD });
      expect(loginAfterActivate.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------
  // Students
  // ---------------------------------------------------------------------
  describe('students', () => {
    it('authorized staff can create, read, update, and archive a student', async () => {
      const token = await loginAs(adminA.email);

      const createRes = await api()
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${token}`)
        .send({ admissionNumber: `CORE-A-${suffix}-CRUD`, fullName: 'CRUD Student', grade: '6' });
      expect(createRes.status).toBe(201);
      const id = createRes.body.id;

      const getRes = await api().get(`/api/v1/students/${id}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.fullName).toBe('CRUD Student');

      const updateRes = await api().patch(`/api/v1/students/${id}`).set('Authorization', `Bearer ${token}`).send({ section: 'Z' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.section).toBe('Z');

      const archiveRes = await api().post(`/api/v1/students/${id}/archive`).set('Authorization', `Bearer ${token}`);
      expect(archiveRes.status).toBe(200);
      expect(archiveRes.body.status).toBe('INACTIVE');
    });

    it('a staff member without students.create cannot create a student', async () => {
      const token = await loginAs(driverA.email);
      const res = await api()
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${token}`)
        .send({ admissionNumber: `CORE-A-${suffix}-DENIED`, fullName: 'Denied' });
      expect(res.status).toBe(403);
    });

    it("cross-tenant: School A admin cannot GET or PATCH School B's student", async () => {
      const token = await loginAs(adminA.email);
      const getRes = await api().get(`/api/v1/students/${studentB1.id}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(404);
      const patchRes = await api().patch(`/api/v1/students/${studentB1.id}`).set('Authorization', `Bearer ${token}`).send({ fullName: 'Hacked' });
      expect(patchRes.status).toBe(404);
    });

    it('a schoolId supplied in the update body cannot move a student to another tenant (the field does not exist on the DTO)', async () => {
      const token = await loginAs(adminA.email);
      await api()
        .patch(`/api/v1/students/${studentA1.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Still A1', schoolId: schoolB.id });
      const stillInA = await prisma.runInTenantContext(schoolA.id, (tx) => tx.student.findUnique({ where: { id: studentA1.id } }));
      expect(stillInA?.schoolId).toBe(schoolA.id);
    });

    it('pagination: list respects limit and returns a usable nextCursor', async () => {
      const token = await loginAs(adminA.email);
      for (let i = 0; i < 3; i++) {
        await api()
          .post('/api/v1/students')
          .set('Authorization', `Bearer ${token}`)
          .send({ admissionNumber: `CORE-A-${suffix}-PAGE-${i}`, fullName: `Page Student ${i}` });
      }
      const firstPage = await api().get('/api/v1/students?limit=2').set('Authorization', `Bearer ${token}`);
      expect(firstPage.status).toBe(200);
      expect(firstPage.body.data.length).toBe(2);
      expect(firstPage.body.nextCursor).toEqual(expect.any(String));

      const secondPage = await api()
        .get(`/api/v1/students?limit=2&cursor=${firstPage.body.nextCursor}`)
        .set('Authorization', `Bearer ${token}`);
      expect(secondPage.status).toBe(200);
      const firstIds = new Set(firstPage.body.data.map((s: { id: string }) => s.id));
      for (const student of secondPage.body.data) {
        expect(firstIds.has(student.id)).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------
  // Parents
  // ---------------------------------------------------------------------
  describe('parents', () => {
    it("a parent can see their own profile (/auth/me) and their own linked children", async () => {
      const token = await loginParentAs(parentA.phone);
      const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
      expect(me.status).toBe(200);
      expect(me.body.id).toBe(parentA.id);

      const children = await api().get('/api/v1/parent/children').set('Authorization', `Bearer ${token}`);
      expect(children.status).toBe(200);
      expect(children.body.map((c: { id: string }) => c.id)).toEqual([studentA1.id]);
    });

    it('a parent can access their own child by id', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get(`/api/v1/parent/children/${studentA1.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(studentA1.id);
    });

    it("IDOR: a parent cannot access another parent's child, even knowing its id (404, not 403)", async () => {
      const token = await loginParentAs(parentA.phone);
      const otherChild = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.parentStudent.findFirstOrThrow({ where: { parentId: parentA2.id } }),
      );
      const res = await api().get(`/api/v1/parent/children/${otherChild.studentId}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it("IDOR: a parent cannot access a student from a different school", async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api().get(`/api/v1/parent/children/${studentB1.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('a school admin can create a parent, link a student, and verify the link', async () => {
      const token = await loginAs(adminA.email);

      const createRes = await api()
        .post('/api/v1/parents')
        .set('Authorization', `Bearer ${token}`)
        .send({ phone: `+9180002${suffix.toString().slice(-5)}`, fullName: 'New Parent' });
      expect(createRes.status).toBe(201);
      expect(createRes.body.status).toBe('INVITED');
      const newParentId = createRes.body.id;

      const linkRes = await api()
        .post(`/api/v1/parents/${newParentId}/children`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentId: studentA1.id, relationship: 'FATHER' });
      expect(linkRes.status).toBe(201);
      expect(linkRes.body.verified).toBe(false);

      const verifyRes = await api().post(`/api/v1/parent-students/${linkRes.body.id}/verify`).set('Authorization', `Bearer ${token}`);
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.verified).toBe(true);
    });

    it("cross-tenant: School A admin cannot GET or PATCH School B's parent", async () => {
      const token = await loginAs(adminA.email);
      const getRes = await api().get(`/api/v1/parents/${parentB.id}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(404);
      const patchRes = await api().patch(`/api/v1/parents/${parentB.id}`).set('Authorization', `Bearer ${token}`).send({ fullName: 'Hacked' });
      expect(patchRes.status).toBe(404);
    });

    it('a parent cannot manipulate the parent_student relationship without staff authorization (no permission for parents.manage_relationships)', async () => {
      const token = await loginParentAs(parentA.phone);
      const res = await api()
        .post(`/api/v1/parents/${parentA.id}/children`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentId: studentA1.id });
      // Parent audience is rejected by @RequireAudience('STAFF') on this controller before any permission check runs.
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Invitation lifecycle
  // ---------------------------------------------------------------------
  describe('invitations', () => {
    it('an expired invitation cannot be accepted', async () => {
      const target = await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.user.create({ data: { schoolId: schoolA.id, email: `expired-invite.${suffix}@core-test.example`, fullName: 'Expired Invite Target', status: 'INVITED' } }),
      );
      const tokenService = app.get(TokenService);
      const { raw, hash } = tokenService.generateOpaqueToken();
      const adminAUser = await prisma.runInTenantContext(schoolA.id, (tx) => tx.user.findFirstOrThrow({ where: { id: adminA.id } }));
      await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.invitation.create({
          data: {
            schoolId: schoolA.id,
            principalType: 'STAFF',
            principalId: target.id,
            tokenHash: hash,
            invitedBy: adminAUser.id,
            expiresAt: new Date(Date.now() - 60_000),
          },
        }),
      );
      const res = await api().post('/api/v1/invitations/accept').send({ token: raw, password: 'WhateverPass123' });
      expect(res.status).toBe(400);
    });

    it('an invitation is single-use', async () => {
      const token = await loginAs(adminA.email);
      capturedInvitationToken = undefined;
      await api()
        .post('/api/v1/users/invite')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: `single-use.${suffix}@core-test.example`, fullName: 'Single Use', roleKeys: ['DRIVER'] });
      const raw = capturedInvitationToken!;

      const first = await api().post('/api/v1/invitations/accept').send({ token: raw, password: 'FirstPass123' });
      expect(first.status).toBe(200);

      const second = await api().post('/api/v1/invitations/accept').send({ token: raw, password: 'SecondPass123' });
      expect(second.status).toBe(400);
    });

    it('an invalid/nonexistent invitation token fails safely', async () => {
      const res = await api().post('/api/v1/invitations/accept').send({ token: 'not-a-real-token', password: 'WhateverPass123' });
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // Direct RLS verification (not through the API — proves the database
  // itself enforces isolation, independent of any application-layer bug)
  // ---------------------------------------------------------------------
  describe('RLS enforcement (direct, bypassing the API)', () => {
    it('a tenant-scoped query for School A never returns School B rows, for students/parents/users', async () => {
      const [studentsFromA, parentsFromA, usersFromA] = await Promise.all([
        prisma.runInTenantContext(schoolA.id, (tx) => tx.student.findMany({ where: { id: { in: [studentA1.id, studentB1.id] } } })),
        prisma.runInTenantContext(schoolA.id, (tx) => tx.parent.findMany({ where: { id: { in: [parentA.id] } } })),
        prisma.runInTenantContext(schoolA.id, (tx) => tx.user.findMany({ where: { id: { in: [adminA.id, adminB.id] } } })),
      ]);
      expect(studentsFromA.map((s) => s.id)).toEqual([studentA1.id]);
      expect(parentsFromA.map((p) => p.id)).toEqual([parentA.id]);
      expect(usersFromA.map((u) => u.id)).toEqual([adminA.id]);
    });
  });
});
