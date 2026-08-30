'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Spinner } from './ui/spinner';

/**
 * Protected-route foundation (docs/security.md's audience separation applied
 * client-side — this is UX only, never the real authorization boundary; the
 * API enforces the actual guard regardless of what this component does).
 * Redirects to the matching login page if unauthenticated, or if
 * authenticated as the WRONG audience (a parent hitting a staff-only route,
 * or vice versa) — never silently renders the wrong shell for the wrong
 * audience.
 */
export function RequireAuth({
  audience,
  children,
}: {
  audience: 'STAFF' | 'PARENT';
  children: React.ReactNode;
}) {
  const { status, principal } = useAuth();
  const router = useRouter();
  const loginPath = audience === 'STAFF' ? '/login/staff' : '/login/parent';

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(loginPath);
    } else if (status === 'authenticated' && principal && principal.type !== audience) {
      router.replace(loginPath);
    }
  }, [status, principal, audience, loginPath, router]);

  if (status === 'loading' || status === 'unauthenticated' || (principal && principal.type !== audience)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return <>{children}</>;
}
