/**
 * Authorization test foundation. The enforcing PermissionsGuard/policy layer
 * (docs/security.md#22-enforcement--centralized-not-scattered) is built in
 * Phase 1 alongside the RBAC module — these tests instead pin down invariants
 * of the permission *model* itself (docs/security.md#23), so that model can't
 * silently drift (e.g. a role gaining a permission key that doesn't exist, or
 * PARENT gaining a staff permission) before the enforcing code even exists.
 */
import {
  PERMISSION_KEYS,
  ROLE_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  type PermissionKey,
} from '@school-transport/shared-types';

describe('RBAC permission matrix (docs/security.md)', () => {
  it('every role in DEFAULT_ROLE_PERMISSIONS is a known role key', () => {
    expect(Object.keys(DEFAULT_ROLE_PERMISSIONS).sort()).toEqual([...ROLE_KEYS].sort());
  });

  it('every granted permission is a known permission key', () => {
    const known = new Set<PermissionKey>(PERMISSION_KEYS);
    for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(known.has(permission)).toBe(true);
        if (!known.has(permission)) {
          throw new Error(`Role ${role} grants unknown permission "${permission}"`);
        }
      }
    }
  });

  it('PARENT has no staff RBAC permissions — parent access is relationship-scoped, not permission-scoped (docs/security.md#4)', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.PARENT).toEqual([]);
  });

  it('only SUPER_ADMIN holds platform.* permissions', () => {
    for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const hasPlatformPermission = permissions.some((p) => p.startsWith('platform.'));
      if (role === 'SUPER_ADMIN') {
        expect(hasPlatformPermission).toBe(true);
      } else {
        expect(hasPlatformPermission).toBe(false);
      }
    }
  });

  it('DRIVER and BUS_ATTENDANT never receive camera, ai_events, incidents, geofence, or safety-rule permissions', () => {
    for (const role of ['DRIVER', 'BUS_ATTENDANT'] as const) {
      const permissions = DEFAULT_ROLE_PERMISSIONS[role];
      const forbiddenPrefixes = ['camera.', 'ai_events.', 'incidents.', 'audit_logs.', 'geofences.', 'safety_rules.'];
      for (const permission of permissions) {
        expect(forbiddenPrefixes.some((prefix) => permission.startsWith(prefix))).toBe(false);
      }
    }
  });
});
