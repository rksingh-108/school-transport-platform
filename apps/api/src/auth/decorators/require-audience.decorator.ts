import { SetMetadata } from '@nestjs/common';
import type { AuthPrincipalType } from '@prisma/client';

export const REQUIRE_AUDIENCE_KEY = 'requireAudience';

/**
 * Restricts a route to one authentication audience. Combined with
 * JwtAuthGuard (which accepts either audience's token and sets
 * request.principal) + AudienceGuard (which reads this metadata and checks
 * request.principal.type against it) — see
 * docs/security.md#4-parent-data-access-boundary and
 * docs/adr/0004-auth-strategy.md.
 */
export const RequireAudience = (audience: AuthPrincipalType) => SetMetadata(REQUIRE_AUDIENCE_KEY, audience);
