'use client';

import { useRouter } from 'next/navigation';
import { getMyChildren } from '@/lib/api/parents';
import { RequireAuth } from '@/components/require-auth';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

function ParentHome() {
  const { principal, logout } = useAuth();
  const router = useRouter();
  const { data: children, error, loading, reload } = useAsync(() => getMyChildren(), []);

  if (!principal || principal.type !== 'PARENT') return null;

  async function onLogout() {
    await logout();
    router.replace('/login/parent');
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{principal.fullName}</h1>
          <p className="text-sm text-zinc-500">{principal.school.name}</p>
        </div>
        <Button variant="secondary" onClick={onLogout}>
          Sign out
        </Button>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Your children</h2>
      {loading && <LoadingState label="Loading your children…" />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load your children.'} onRetry={reload} />
      )}
      {!loading && !error && children && children.length === 0 && (
        <EmptyState title="No linked children yet" description="Contact your school if this doesn't look right." />
      )}
      {!loading && !error && children && children.length > 0 && (
        <div className="space-y-2">
          {children.map((child) => (
            <div key={child.id} className="rounded-md border border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{child.fullName}</p>
              <p className="text-xs text-zinc-500">
                {child.grade ? `Grade ${child.grade}` : 'Grade —'} {child.section ? `· Section ${child.section}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ParentPage() {
  return (
    <RequireAuth audience="PARENT">
      <ParentHome />
    </RequireAuth>
  );
}
