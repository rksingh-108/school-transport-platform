import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import type { RbacService } from '../services/rbac.service';
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

describe('PermissionsGuard', () => {
  it('allows the request through when no @RequirePermission metadata is present', async () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const rbac = { hasPermission: jest.fn() } as unknown as RbacService;
    const guard = new PermissionsGuard(reflector, rbac);
    await expect(guard.canActivate(makeContext(staffPrincipal))).resolves.toBe(true);
    expect(rbac.hasPermission).not.toHaveBeenCalled();
  });

  it('allows a staff principal that holds the required permission', async () => {
    const reflector = { getAllAndOverride: () => 'students.read' } as unknown as Reflector;
    const rbac = { hasPermission: jest.fn().mockResolvedValue(true) } as unknown as RbacService;
    const guard = new PermissionsGuard(reflector, rbac);
    await expect(guard.canActivate(makeContext(staffPrincipal))).resolves.toBe(true);
    expect(rbac.hasPermission).toHaveBeenCalledWith('s1', 'u1', 'students.read');
  });

  it('rejects a staff principal that lacks the required permission', async () => {
    const reflector = { getAllAndOverride: () => 'students.delete' } as unknown as Reflector;
    const rbac = { hasPermission: jest.fn().mockResolvedValue(false) } as unknown as RbacService;
    const guard = new PermissionsGuard(reflector, rbac);
    await expect(guard.canActivate(makeContext(staffPrincipal))).rejects.toThrow(ForbiddenException);
  });

  it('rejects a PARENT principal outright — parents never hold RBAC permissions', async () => {
    const reflector = { getAllAndOverride: () => 'students.read' } as unknown as Reflector;
    const rbac = { hasPermission: jest.fn() } as unknown as RbacService;
    const guard = new PermissionsGuard(reflector, rbac);
    await expect(guard.canActivate(makeContext(parentPrincipal))).rejects.toThrow(ForbiddenException);
    expect(rbac.hasPermission).not.toHaveBeenCalled();
  });
});
