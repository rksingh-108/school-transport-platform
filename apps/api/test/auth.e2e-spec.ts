import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: resolve(__dirname, '../../../.env') });

import { Controller, Get, INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/database/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';
import {
  AUTH_NOTIFICATION_ADAPTER,
  type AuthNotificationAdapter,
} from '../src/auth/notifications/notification-adapter.interface';
import { RequireAudience } from '../src/auth/decorators/require-audience.decorator';
import { RequirePermission } from '../src/auth/decorators/require-permission.decorator';
import { RequireVerifiedChild } from '../src/auth/decorators/require-verified-child.decorator';

// A minimal, test-only controller used solely to exercise the reusable
// authorization guards (AudienceGuard, PermissionsGuard,
// ParentChildAccessGuard) through a real HTTP pipeline. It is registered
// only in this test's module, never in the real AppModule — no student/bus/
// trip endpoints exist yet for these guards to protect in production code,
// but the guards themselves are real, shipped infrastructure (see
// docs/security.md#8-staff-authorization and #9-parent-authorization) and
// this is the standard way to integration-test middleware/guards in
// isolation from the features that will eventually use them.
@Controller('test-only')
class TestOnlyController {
  @RequireAudience('STAFF')
  @Get('staff-only')
  staffOnly() {
    return { ok: true };
  }

  @RequireAudience('PARENT')
  @Get('parent-only')
  parentOnly() {
    return { ok: true };
  }

  @RequirePermission('students.read')
  @Get('needs-students-read')
  needsPermission() {
    return { ok: true };
  }

  @RequireVerifiedChild('studentId')
  @Get('children/:studentId')
  childOnly() {
    return { ok: true };
  }
}

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const passwordService = new PasswordService();
  let capturedResetToken: string | undefined;

  const mockNotificationAdapter: AuthNotificationAdapter = {
    sendPasswordResetLink: jest.fn(async (params) => {
      capturedResetToken = params.resetToken;
    }),
    sendInvitationLink: jest.fn(async () => {}),
  };

  // Fixtures
  let schoolA: { id: string };
  let schoolB: { id: string };
  const suffix = Date.now();
  const STAFF_PASSWORD = 'CorrectHorse123';
  const PARENT_PASSWORD = 'ParentPassw0rd1';
  let staffActive: { id: string; email: string };
  let staffSuspended: { id: string; email: string };
  let staffDriver: { id: string; email: string };
  let staffSchoolB: { id: string; email: string };
  let staffForPasswordChange: { id: string; email: string };
  let staffForReset: { id: string; email: string };
  let parentActive: { id: string; phone: string };
  let parentOther: { id: string; phone: string };
  let ownChildStudentId: string;
  let otherParentChildStudentId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestOnlyController],
    })
      .overrideProvider(AUTH_NOTIFICATION_ADAPTER)
      .useValue(mockNotificationAdapter)
      // Rate limiting is a cross-cutting concern tested on its own, isolated
      // app instance below (`rateLimitApp`) — this suite calls the login
      // endpoint far more than 5x/min across many unrelated scenarios, which
      // would otherwise trip the real throttle and produce false failures
      // that have nothing to do with what each test actually checks.
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

    schoolA = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Auth Test School A', slug: `auth-test-a-${suffix}`, contactEmail: `a-${suffix}@auth-test.example` } }),
    );
    schoolB = await prisma.runAsPlatformAdmin((tx) =>
      tx.school.create({ data: { name: 'Auth Test School B', slug: `auth-test-b-${suffix}`, contactEmail: `b-${suffix}@auth-test.example` } }),
    );

    const schoolAdminRole = await prisma.runAsPlatformAdmin((tx) =>
      tx.role.findFirstOrThrow({ where: { key: 'SCHOOL_ADMIN', schoolId: null } }),
    );
    const driverRole = await prisma.runAsPlatformAdmin((tx) =>
      tx.role.findFirstOrThrow({ where: { key: 'DRIVER', schoolId: null } }),
    );

    const staffPasswordHash = await passwordService.hash(STAFF_PASSWORD);
    const parentPasswordHash = await passwordService.hash(PARENT_PASSWORD);

    staffActive = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({
        data: { schoolId: schoolA.id, email: `staff.active.${suffix}@auth-test.example`, fullName: 'Staff Active', passwordHash: staffPasswordHash },
      }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.userRole.create({ data: { userId: staffActive.id, roleId: schoolAdminRole.id } }),
    );

    staffSuspended = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({
        data: {
          schoolId: schoolA.id,
          email: `staff.suspended.${suffix}@auth-test.example`,
          fullName: 'Staff Suspended',
          passwordHash: staffPasswordHash,
          status: 'SUSPENDED',
        },
      }),
    );

    staffDriver = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({
        data: { schoolId: schoolA.id, email: `staff.driver.${suffix}@auth-test.example`, fullName: 'Staff Driver', passwordHash: staffPasswordHash },
      }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.userRole.create({ data: { userId: staffDriver.id, roleId: driverRole.id } }),
    );

    staffSchoolB = await prisma.runInTenantContext(schoolB.id, (tx) =>
      tx.user.create({
        data: { schoolId: schoolB.id, email: `staff.b.${suffix}@auth-test.example`, fullName: 'Staff School B', passwordHash: staffPasswordHash },
      }),
    );

    staffForPasswordChange = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({
        data: { schoolId: schoolA.id, email: `staff.pwchange.${suffix}@auth-test.example`, fullName: 'Staff PwChange', passwordHash: staffPasswordHash },
      }),
    );

    staffForReset = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.user.create({
        data: { schoolId: schoolA.id, email: `staff.reset.${suffix}@auth-test.example`, fullName: 'Staff Reset', passwordHash: staffPasswordHash },
      }),
    );

    parentActive = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({
        data: { schoolId: schoolA.id, phone: `+9190000${suffix.toString().slice(-5)}`, fullName: 'Parent Active', passwordHash: parentPasswordHash },
      }),
    );
    parentOther = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parent.create({
        data: { schoolId: schoolA.id, phone: `+9190001${suffix.toString().slice(-5)}`, fullName: 'Parent Other', passwordHash: parentPasswordHash },
      }),
    );

    const ownStudent = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `AUTH-TEST-${suffix}-1`, fullName: 'Own Child' } }),
    );
    const otherStudent = await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.student.create({ data: { schoolId: schoolA.id, admissionNumber: `AUTH-TEST-${suffix}-2`, fullName: 'Other Parent Child' } }),
    );
    ownChildStudentId = ownStudent.id;
    otherParentChildStudentId = otherStudent.id;

    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parentStudent.create({
        data: { schoolId: schoolA.id, parentId: parentActive.id, studentId: ownStudent.id, verified: true },
      }),
    );
    await prisma.runInTenantContext(schoolA.id, (tx) =>
      tx.parentStudent.create({
        data: { schoolId: schoolA.id, parentId: parentOther.id, studentId: otherStudent.id, verified: true },
      }),
    );
  });

  afterAll(async () => {
    // Tenant-scoped cleanup, per school — deliberately NOT runAsPlatformAdmin
    // here. `parent_students`/`students` (unlike users/parents/refresh_tokens/
    // password_reset_tokens) correctly have no platform-admin RLS bypass,
    // since production code never queries them pre-tenant — see
    // docs/adr/0010-credential-resolution-rls-bypass.md and
    // docs/database.md#5-row-level-security's "every table queried via
    // runAsPlatformAdmin must carry this clause" rule. A deleteMany against
    // one of those tables via runAsPlatformAdmin would silently match zero
    // rows under RLS (this is exactly the bug that broke login itself,
    // recurring here in test cleanup rather than app code), leaving orphans
    // that then fail the FK-RESTRICT delete below. We already know the
    // schoolId for every row created in this file, so there's no need for
    // the cross-tenant bypass at all in this cleanup.
    for (const schoolId of [schoolA.id, schoolB.id]) {
      await prisma.runInTenantContext(schoolId, async (tx) => {
        await tx.parentStudent.deleteMany({ where: { schoolId } });
        await tx.refreshToken.deleteMany({ where: { schoolId } });
        await tx.passwordResetToken.deleteMany({ where: { schoolId } });
        await tx.auditLog.deleteMany({ where: { schoolId } });
        await tx.student.deleteMany({ where: { schoolId } });
        await tx.parent.deleteMany({ where: { schoolId } });
        await tx.user.deleteMany({ where: { schoolId } }); // cascades to user_roles
        await tx.school.delete({ where: { id: schoolId } });
      });
    }
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  // ---------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------
  describe('login', () => {
    it('valid staff login succeeds and sets the staff refresh cookie', async () => {
      const res = await api().post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: STAFF_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OK');
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.principal.type).toBe('STAFF');
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('staff_refresh_token='))).toBe(true);
    });

    it('valid parent login succeeds and sets the parent refresh cookie', async () => {
      const res = await api().post('/api/v1/auth/parent/login').send({ phone: parentActive.phone, password: PARENT_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OK');
      expect(res.body.principal.type).toBe('PARENT');
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('parent_refresh_token='))).toBe(true);
    });

    it('invalid staff password is rejected with a generic message (no hint of what specifically was wrong)', async () => {
      const res = await api().post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: 'wrong-password' });
      expect(res.status).toBe(401);
      // "invalid email/phone OR password" is a standard, deliberately generic
      // message — the security property under test is that it never
      // distinguishes "that account doesn't exist" from "wrong password"
      // (see the enumeration-safety test below), not that the word
      // "password" is absent.
      expect(res.body.error.message).toBe('Invalid email/phone or password.');
    });

    it('invalid parent password is rejected', async () => {
      const res = await api().post('/api/v1/auth/parent/login').send({ phone: parentActive.phone, password: 'wrong-password' });
      expect(res.status).toBe(401);
    });

    it('suspended staff account cannot login', async () => {
      const res = await api().post('/api/v1/auth/staff/login').send({ email: staffSuspended.email, password: STAFF_PASSWORD });
      expect(res.status).toBe(401);
    });

    it('a wrong password and a nonexistent email produce an IDENTICAL response (no account enumeration)', async () => {
      const wrongPassword = await api().post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: 'wrong-password' });
      const nonexistent = await api()
        .post('/api/v1/auth/staff/login')
        .send({ email: `nobody-${suffix}@auth-test.example`, password: 'wrong-password' });
      expect(wrongPassword.status).toBe(nonexistent.status);
      // requestId is intentionally unique per request (a correlation ID, not
      // an enumeration signal — docs/api.md#1-conventions) so it's excluded
      // from this comparison; every field a client could act on must match.
      expect(wrongPassword.body.error.code).toEqual(nonexistent.body.error.code);
      expect(wrongPassword.body.error.message).toEqual(nonexistent.body.error.message);
    });
  });

  // ---------------------------------------------------------------------
  // Access token validation
  // ---------------------------------------------------------------------
  describe('access token validation', () => {
    it('rejects a request with no token', async () => {
      const res = await api().get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('rejects an expired access token', async () => {
      const forged = jwt.sign({ schoolId: schoolA.id, principalType: 'STAFF' }, process.env.JWT_STAFF_SECRET!, {
        subject: staffActive.id,
        audience: process.env.JWT_STAFF_AUDIENCE,
        issuer: process.env.JWT_ISSUER,
        expiresIn: -10,
      });
      const res = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it('rejects a token whose schoolId claim does not match where the subject actually lives (defense-in-depth against a forged claim)', async () => {
      const forged = jwt.sign({ schoolId: schoolB.id, principalType: 'STAFF' }, process.env.JWT_STAFF_SECRET!, {
        subject: staffActive.id, // real user, but really belongs to schoolA, not schoolB
        audience: process.env.JWT_STAFF_AUDIENCE,
        issuer: process.env.JWT_ISSUER,
        expiresIn: '15m',
      });
      const res = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it("a School B staff login resolves to School B specifically, never School A (cross-tenant sanity check)", async () => {
      const login = await api().post('/api/v1/auth/staff/login').send({ email: staffSchoolB.email, password: STAFF_PASSWORD });
      expect(login.status).toBe(200);
      const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(me.status).toBe(200);
      expect(me.body.school.id).toBe(schoolB.id);
      expect(me.body.school.id).not.toBe(schoolA.id);
    });
  });

  // ---------------------------------------------------------------------
  // /auth/me
  // ---------------------------------------------------------------------
  describe('/auth/me', () => {
    it('returns staff shape with roles and permissions', async () => {
      const login = await api().post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: STAFF_PASSWORD });
      const res = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('STAFF');
      expect(res.body.roles).toContain('SCHOOL_ADMIN');
      expect(res.body.permissions).toContain('students.read');
    });

    it('returns parent shape with linkedChildrenCount limited to their OWN verified children', async () => {
      const login = await api().post('/api/v1/auth/parent/login').send({ phone: parentActive.phone, password: PARENT_PASSWORD });
      const res = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('PARENT');
      expect(res.body.linkedChildrenCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // Audience separation
  // ---------------------------------------------------------------------
  describe('audience separation', () => {
    it('a staff token is rejected by a parent-only endpoint', async () => {
      const login = await api().post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: STAFF_PASSWORD });
      const res = await api().get('/api/v1/test-only/parent-only').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(403);
    });

    it('a parent token is rejected by a staff-only endpoint', async () => {
      const login = await api().post('/api/v1/auth/parent/login').send({ phone: parentActive.phone, password: PARENT_PASSWORD });
      const res = await api().get('/api/v1/test-only/staff-only').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(403);
    });

    it('a staff token is accepted by a staff-only endpoint', async () => {
      const login = await api().post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: STAFF_PASSWORD });
      const res = await api().get('/api/v1/test-only/staff-only').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------
  // Staff RBAC
  // ---------------------------------------------------------------------
  describe('staff RBAC (PermissionsGuard)', () => {
    it('a staff member with the required permission succeeds', async () => {
      const login = await api().post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: STAFF_PASSWORD });
      const res = await api().get('/api/v1/test-only/needs-students-read').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(200);
    });

    it('a staff member without the required permission (DRIVER) is rejected', async () => {
      const login = await api().post('/api/v1/auth/staff/login').send({ email: staffDriver.email, password: STAFF_PASSWORD });
      const res = await api().get('/api/v1/test-only/needs-students-read').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // Parent-child authorization
  // ---------------------------------------------------------------------
  describe('parent-child authorization (ParentChildAccessGuard)', () => {
    it('a parent can access their own verified child', async () => {
      const login = await api().post('/api/v1/auth/parent/login').send({ phone: parentActive.phone, password: PARENT_PASSWORD });
      const res = await api()
        .get(`/api/v1/test-only/children/${ownChildStudentId}`)
        .set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(200);
    });

    it("a parent cannot access another parent's child (404, not 403)", async () => {
      const login = await api().post('/api/v1/auth/parent/login').send({ phone: parentActive.phone, password: PARENT_PASSWORD });
      const res = await api()
        .get(`/api/v1/test-only/children/${otherParentChildStudentId}`)
        .set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(404);
    });

    it('a parent cannot access a nonexistent/other-tenant student id (still 404)', async () => {
      const login = await api().post('/api/v1/auth/parent/login').send({ phone: parentActive.phone, password: PARENT_PASSWORD });
      const res = await api()
        .get('/api/v1/test-only/children/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(404);
    });

    it('a staff token cannot use the parent-child endpoint at all', async () => {
      const login = await api().post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: STAFF_PASSWORD });
      const res = await api()
        .get(`/api/v1/test-only/children/${ownChildStudentId}`)
        .set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // Refresh: rotation + reuse detection
  // ---------------------------------------------------------------------
  describe('refresh token rotation and reuse detection', () => {
    it('a valid refresh returns a new access token and rotates the cookie', async () => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: STAFF_PASSWORD });
      const res = await agent.post('/api/v1/auth/refresh').send();
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
    });

    it('reusing an already-rotated-away refresh token is rejected AND kills the whole session', async () => {
      const login = await api().post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: STAFF_PASSWORD });
      const originalCookie = extractCookie(login, 'staff_refresh_token');

      const firstRefresh = await api().post('/api/v1/auth/refresh').set('Cookie', originalCookie);
      expect(firstRefresh.status).toBe(200);
      const rotatedCookie = extractCookie(firstRefresh, 'staff_refresh_token');

      // Replay the OLD (already-rotated-away) token.
      const replay = await api().post('/api/v1/auth/refresh').set('Cookie', originalCookie);
      expect(replay.status).toBe(401);

      // The legitimately-rotated NEW token must ALSO now be dead — reuse
      // detection revokes the entire session family, not just the replayed token.
      const afterReuse = await api().post('/api/v1/auth/refresh').set('Cookie', rotatedCookie);
      expect(afterReuse.status).toBe(401);
    });

    it('a revoked (logged out) refresh token is rejected', async () => {
      const login = await api().post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: STAFF_PASSWORD });
      const cookie = extractCookie(login, 'staff_refresh_token');

      const logoutRes = await api().post('/api/v1/auth/logout').set('Cookie', cookie);
      expect(logoutRes.status).toBe(200);

      const afterLogout = await api().post('/api/v1/auth/refresh').set('Cookie', cookie);
      expect(afterLogout.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------
  // Logout / logout-all
  // ---------------------------------------------------------------------
  describe('logout-all', () => {
    it('revokes every session for the principal, not just the current one', async () => {
      const loginA = await api().post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: STAFF_PASSWORD });
      const loginB = await api().post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: STAFF_PASSWORD });
      const cookieA = extractCookie(loginA, 'staff_refresh_token');
      const cookieB = extractCookie(loginB, 'staff_refresh_token');

      const logoutAllRes = await api()
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${loginA.body.accessToken}`);
      expect(logoutAllRes.status).toBe(200);

      const refreshA = await api().post('/api/v1/auth/refresh').set('Cookie', cookieA);
      const refreshB = await api().post('/api/v1/auth/refresh').set('Cookie', cookieB);
      expect(refreshA.status).toBe(401);
      expect(refreshB.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------
  // Change password
  // ---------------------------------------------------------------------
  describe('change password', () => {
    it('rejects an incorrect current password', async () => {
      const login = await api().post('/api/v1/auth/staff/login').send({ email: staffForPasswordChange.email, password: STAFF_PASSWORD });
      const res = await api()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .send({ currentPassword: 'totally-wrong', newPassword: 'BrandNewPass123' });
      expect(res.status).toBe(400);
    });

    it('changes the password and revokes existing sessions', async () => {
      const login = await api().post('/api/v1/auth/staff/login').send({ email: staffForPasswordChange.email, password: STAFF_PASSWORD });
      const oldCookie = extractCookie(login, 'staff_refresh_token');

      const changeRes = await api()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .send({ currentPassword: STAFF_PASSWORD, newPassword: 'BrandNewPass123' });
      expect(changeRes.status).toBe(200);

      const oldSessionRefresh = await api().post('/api/v1/auth/refresh').set('Cookie', oldCookie);
      expect(oldSessionRefresh.status).toBe(401);

      const oldPasswordLogin = await api()
        .post('/api/v1/auth/staff/login')
        .send({ email: staffForPasswordChange.email, password: STAFF_PASSWORD });
      expect(oldPasswordLogin.status).toBe(401);

      const newPasswordLogin = await api()
        .post('/api/v1/auth/staff/login')
        .send({ email: staffForPasswordChange.email, password: 'BrandNewPass123' });
      expect(newPasswordLogin.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------
  // Password reset
  // ---------------------------------------------------------------------
  describe('password reset', () => {
    it('request always returns the same generic response, whether or not the account exists', async () => {
      const real = await api().post('/api/v1/auth/password-reset/request').send({ audience: 'STAFF', identifier: staffForReset.email });
      const fake = await api()
        .post('/api/v1/auth/password-reset/request')
        .send({ audience: 'STAFF', identifier: `nobody-${suffix}@auth-test.example` });
      expect(real.status).toBe(fake.status);
      expect(real.body).toEqual(fake.body);
    });

    it('confirming with the issued token resets the password; the token is then single-use', async () => {
      capturedResetToken = undefined;
      await api().post('/api/v1/auth/password-reset/request').send({ audience: 'STAFF', identifier: staffForReset.email });
      expect(capturedResetToken).toEqual(expect.any(String));
      const token = capturedResetToken!;

      const confirmRes = await api().post('/api/v1/auth/password-reset/confirm').send({ token, newPassword: 'ResetPassw0rd99' });
      expect(confirmRes.status).toBe(200);

      const loginWithNew = await api().post('/api/v1/auth/staff/login').send({ email: staffForReset.email, password: 'ResetPassw0rd99' });
      expect(loginWithNew.status).toBe(200);

      // Same token again — already used.
      const reuseRes = await api().post('/api/v1/auth/password-reset/confirm').send({ token, newPassword: 'AnotherPass123' });
      expect(reuseRes.status).toBe(400);
    });

    it('rejects an expired reset token', async () => {
      const tokenService = app.get(TokenService);
      const { raw, hash } = tokenService.generateOpaqueToken();
      await prisma.runInTenantContext(schoolA.id, (tx) =>
        tx.passwordResetToken.create({
          data: {
            schoolId: schoolA.id,
            principalType: 'STAFF',
            principalId: staffActive.id,
            tokenHash: hash,
            expiresAt: new Date(Date.now() - 60_000), // already expired
          },
        }),
      );
      const res = await api().post('/api/v1/auth/password-reset/confirm').send({ token: raw, newPassword: 'WhateverPass123' });
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // Rate limiting — isolated in its own app instance. ThrottlerGuard's
  // in-memory counters are per-application-instance; sharing the main `app`
  // here would either get tripped by every other test's login calls above,
  // or (depending on ordering) trip up THEM — neither is what this test is
  // actually trying to prove.
  // ---------------------------------------------------------------------
  describe('rate limiting', () => {
    let rateLimitApp: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      rateLimitApp = moduleRef.createNestApplication();
      rateLimitApp.use(cookieParser());
      rateLimitApp.setGlobalPrefix('api', { exclude: ['health', 'health/ready'] });
      rateLimitApp.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
      rateLimitApp.useGlobalFilters(new AllExceptionsFilter());
      await rateLimitApp.init();
    });

    afterAll(async () => {
      await rateLimitApp.close();
    });

    it('blocks repeated login attempts past the configured per-IP threshold', async () => {
      const identifier = `rate-limit-test-${suffix}@auth-test.example`;
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        const res = await request(rateLimitApp.getHttpServer())
          .post('/api/v1/auth/staff/login')
          .send({ email: identifier, password: 'whatever' });
        statuses.push(res.status);
      }
      expect(statuses).toContain(429);
    });
  });

  // ---------------------------------------------------------------------
  // Security: audit trail never contains secrets
  // ---------------------------------------------------------------------
  describe('audit log hygiene', () => {
    it('never writes the raw password, access token, or refresh token into audit_logs.metadata', async () => {
      const login = await api().post('/api/v1/auth/staff/login').send({ email: staffActive.email, password: STAFF_PASSWORD });
      const cookie = extractCookie(login, 'staff_refresh_token');
      await api().post('/api/v1/auth/refresh').set('Cookie', cookie);

      const rows = await prisma.runAsPlatformAdmin((tx) =>
        tx.auditLog.findMany({ where: { actorId: staffActive.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      );
      const serialized = JSON.stringify(rows.map((r) => r.metadata));
      expect(serialized).not.toContain(STAFF_PASSWORD);
      expect(serialized).not.toContain(login.body.accessToken);
      const rawCookieValue = cookie.split('=')[1]?.split(';')[0];
      expect(serialized).not.toContain(rawCookieValue);
    });
  });
});

function extractCookie(res: request.Response, name: string): string {
  const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  const found = cookies.find((c) => c.startsWith(`${name}=`));
  if (!found) throw new Error(`Cookie ${name} not found in response`);
  return found.split(';')[0]!;
}
