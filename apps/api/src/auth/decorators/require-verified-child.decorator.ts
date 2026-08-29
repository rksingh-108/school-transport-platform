import { SetMetadata } from '@nestjs/common';

export const REQUIRE_VERIFIED_CHILD_KEY = 'requireVerifiedChild';

/**
 * `@RequireVerifiedChild('studentId')` — for future parent-facing endpoints
 * that take a studentId route param. Combined with ParentChildAccessGuard,
 * which reads the named param, verifies the authenticated parent has a
 * VERIFIED ParentStudent relationship with that exact student (never trusts
 * the param on its own), and returns 404 (not 403) on failure so the
 * response never confirms whether the studentId even exists — see
 * docs/security.md#4-parent-data-access-boundary.
 *
 * No endpoint uses this yet (no student-facing routes exist until a later
 * Phase 1 step) — this decorator + its guard are the reusable mechanism
 * those endpoints will apply, built now per docs/security.md#9 (formerly
 * task item 9) so it doesn't need to be invented ad hoc later.
 */
export const RequireVerifiedChild = (studentIdParam: string) =>
  SetMetadata(REQUIRE_VERIFIED_CHILD_KEY, studentIdParam);
