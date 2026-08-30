'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ParentChildTransportUpdatedEvent, ParentChildWithTransportDto } from '@school-transport/shared-types';
import { getMyChildren } from '@/lib/api/parents';
import { useParentSocket } from '@/lib/realtime/parent-socket';
import { RequireAuth } from '@/components/require-auth';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

/** Plain-language status text — no "TripStudent"/"deviceId"/technical terms ever surface here. */
function transportHeadline(transport: ParentChildWithTransportDto['transport']): string {
  if (!transport.tripStatus) return 'No trip today';
  if (transport.tripStatus === 'CANCELLED') return "Today's trip was cancelled";
  if (transport.tripStatus === 'NO_SHOW') return 'Marked as no-show';
  if (transport.tripStatus === 'SCHEDULED' || transport.tripStatus === 'READY') return 'Trip scheduled';
  if (transport.tripStatus === 'COMPLETED') return 'Trip completed';
  switch (transport.attendanceStatus) {
    case 'BOARDED':
      return 'Boarded';
    case 'DROPPED_OFF':
      return 'Dropped off';
    case 'ABSENT':
      return 'Marked absent';
    default:
      return 'Not yet boarded';
  }
}

function ParentHome() {
  const { principal, logout } = useAuth();
  const router = useRouter();
  const { data: children, error, loading, reload } = useAsync(() => getMyChildren(), []);
  const [live, setLive] = useState<Record<string, ParentChildTransportUpdatedEvent>>({});

  const onChildUpdate = useCallback((event: ParentChildTransportUpdatedEvent) => {
    setLive((prev) => ({ ...prev, [event.childId]: event }));
  }, []);
  const { status: socketStatus } = useParentSocket(onChildUpdate);

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

      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">My Children</h2>
      {loading && <LoadingState label="Loading your children…" />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load your children.'} onRetry={reload} />
      )}
      {!loading && !error && children && children.length === 0 && (
        <EmptyState title="No children are currently linked to your account." description="Contact your school if this doesn't look right." />
      )}
      {!loading && !error && children && children.length > 0 && (
        <div className="space-y-3">
          {children.map((child) => {
            const liveUpdate = live[child.id];
            const transport = liveUpdate
              ? { tripStatus: liveUpdate.tripStatus, attendanceStatus: liveUpdate.attendanceStatus, busDisplayName: liveUpdate.busDisplayName, freshness: liveUpdate.location.freshness }
              : child.transport;
            return (
              <Link
                key={child.id}
                href={`/parent/children/${child.id}`}
                className="block rounded-lg border border-zinc-200 px-4 py-4 dark:border-zinc-800"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{child.fullName}</p>
                    <p className="text-xs text-zinc-500">
                      {child.grade ? `Grade ${child.grade}` : 'Grade —'} {child.section ? `· Section ${child.section}` : ''}
                    </p>
                  </div>
                  {transport.tripStatus === 'IN_PROGRESS' && transport.attendanceStatus && (
                    <StatusBadge status={transport.attendanceStatus} />
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{transportHeadline(transport)}</p>
                  {transport.busDisplayName && <p className="text-xs text-zinc-500">{transport.busDisplayName}</p>}
                </div>
                {transport.tripStatus === 'IN_PROGRESS' && transport.freshness && (
                  <div className="mt-2">
                    <StatusBadge status={transport.freshness} />
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
      {!loading && !error && children && children.length > 0 && (
        <p className="mt-6 text-center text-xs text-zinc-400">
          {socketStatus === 'connected' ? 'Live updates on' : socketStatus === 'reconnecting' ? 'Reconnecting…' : ''}
        </p>
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
