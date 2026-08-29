/**
 * Mirrors the Prisma AuthPrincipalType enum (see prisma/schema.prisma) — a
 * hand-written literal union so apps/web can use it without depending on
 * @prisma/client. Keep in sync with the Prisma schema if it ever changes.
 */
export const AUTH_PRINCIPAL_TYPES = ['STAFF', 'PARENT'] as const;
export type AuthPrincipalType = (typeof AUTH_PRINCIPAL_TYPES)[number];

/** Shape of GET /api/v1/auth/me's response for a staff principal. */
export interface StaffMeResponse {
  type: 'STAFF';
  id: string;
  email: string;
  fullName: string;
  school: { id: string; name: string };
  roles: string[];
  permissions: string[];
}

/** Shape of GET /api/v1/auth/me's response for a parent principal. */
export interface ParentMeResponse {
  type: 'PARENT';
  id: string;
  phone: string;
  email: string | null;
  fullName: string;
  school: { id: string; name: string };
  linkedChildrenCount: number;
}

export type MeResponse = StaffMeResponse | ParentMeResponse;

/** Shape of a successful login/refresh response body (access token only —
 * the refresh token is delivered exclusively via an httpOnly cookie, never
 * in the response body; see docs/adr/0004-auth-strategy.md). */
export interface AuthTokenResponse {
  accessToken: string;
  accessTokenExpiresAt: string; // ISO 8601
  principal: MeResponse;
}
