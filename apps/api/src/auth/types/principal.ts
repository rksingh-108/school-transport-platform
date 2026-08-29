import type { AuthPrincipalType } from '@prisma/client';

/**
 * The authenticated identity attached to `request.principal` by
 * JwtAuthGuard, after verifying the access token AND re-fetching the
 * principal from the database (see jwt-auth.guard.ts for why this is a real
 * DB read, not just decoded JWT claims). Every guard/decorator/service in
 * this module reads from this shape, never from raw JWT claims directly.
 */
export interface AuthenticatedPrincipal {
  type: AuthPrincipalType;
  id: string;
  schoolId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

// Same ambient-namespace-augmentation pattern (and same justification) as
// request-id.middleware.ts's Express.Request extension.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: AuthenticatedPrincipal;
    }
  }
}
