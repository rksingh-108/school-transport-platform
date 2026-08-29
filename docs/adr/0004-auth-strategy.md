# ADR 0004: Dual-Audience JWT Auth (Staff/Device/API vs Parent), Cookie for Web

Status: Accepted
Date: 2026-08-30

## Context
The platform has structurally distinct principal types with different risk
profiles: staff/school users (high-privilege, web-based), drivers/attendants
(mobile, moderate privilege, in-motion use), parents (lowest privilege, highest
volume, must never reach staff-only endpoints even in a bug scenario), and devices
(not human principals at all).

## Decision
- Short-lived JWT access tokens (15 min) + rotating, server-tracked refresh tokens
  for all human principals.
- Web app: refresh token in an `httpOnly`/`Secure`/`SameSite=Lax` cookie; access
  token held in memory client-side.
- Mobile/API clients (driver/attendant/parent apps): both tokens returned in the
  response body, stored in platform secure storage — no cookie/CSRF surface to
  manage for these clients.
- **Parents authenticate through a separate endpoint and a separate token audience
  claim** from staff, so a parent token is structurally rejected by staff-only
  guards independent of the permission check also failing (belt-and-braces, given
  child-privacy stakes — see [security.md](../security.md#1-authentication)).
- Devices (GPS units, cameras) use provisioned per-device API credentials, never a
  user-style token, scoped to exactly one `bus_device_id`.
- Password hashing: argon2id.
- MFA scaffolding (TOTP secret column, `MFA_REQUIRED` login state) built into the
  auth flow from the start, not enabled for any role by default in MVP.

## Consequences
- Two token-delivery code paths (cookie vs body) to maintain, but this is standard
  and avoids forcing a mobile app into browser-cookie semantics it doesn't need.
- The separate parent token audience means the auth module has two guards
  (`StaffAuthGuard`, `ParentAuthGuard`) instead of one generic guard with a role
  check — a deliberate small duplication in exchange for a structural (not just
  logical) separation of the highest-privacy-risk principal type.
- Revocation (logout-everywhere, compromised device) is possible because refresh
  tokens are persisted (hashed) server-side rather than purely stateless.
