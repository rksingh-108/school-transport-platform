import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AudienceGuard } from './audience.guard';
import type { AuthenticatedPrincipal } from '../types/principal';

function makeContext(principal: AuthenticatedPrincipal | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const staffPrincipal: AuthenticatedPrincipal = {
  type: 'STAFF',
  id: 'u1',
  schoolId: 's1',
  fullName: 'Staff One',
  email: 'staff@example.com',
  phone: null,
};

const parentPrincipal: AuthenticatedPrincipal = {
  type: 'PARENT',
  id: 'p1',
  schoolId: 's1',
  fullName: 'Parent One',
  email: null,
  phone: '+911234567890',
};

describe('AudienceGuard', () => {
  it('allows the request through when no @RequireAudience metadata is present', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new AudienceGuard(reflector);
    expect(guard.canActivate(makeContext(staffPrincipal))).toBe(true);
  });

  it('allows a STAFF principal on a STAFF-required route', () => {
    const reflector = { getAllAndOverride: () => 'STAFF' } as unknown as Reflector;
    const guard = new AudienceGuard(reflector);
    expect(guard.canActivate(makeContext(staffPrincipal))).toBe(true);
  });

  it('rejects a PARENT principal on a STAFF-required route', () => {
    const reflector = { getAllAndOverride: () => 'STAFF' } as unknown as Reflector;
    const guard = new AudienceGuard(reflector);
    expect(() => guard.canActivate(makeContext(parentPrincipal))).toThrow(ForbiddenException);
  });

  it('rejects a STAFF principal on a PARENT-required route', () => {
    const reflector = { getAllAndOverride: () => 'PARENT' } as unknown as Reflector;
    const guard = new AudienceGuard(reflector);
    expect(() => guard.canActivate(makeContext(staffPrincipal))).toThrow(ForbiddenException);
  });
});
