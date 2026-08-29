import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@school-transport/shared-types';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * `@RequirePermission('students.read')` — the only sanctioned way to gate a
 * staff endpoint by permission. Never write `if (user.role === 'X')` in a
 * controller/service; see docs/security.md#22-enforcement--centralized-not-scattered.
 * `PermissionKey` is the same union used to seed the permissions table
 * (packages/shared-types/src/rbac.ts), so a typo here is a compile error,
 * not a silent always-false check.
 */
export const RequirePermission = (permission: PermissionKey) => SetMetadata(REQUIRE_PERMISSION_KEY, permission);
