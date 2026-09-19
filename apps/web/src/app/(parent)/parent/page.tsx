'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import type { ParentChildTransportUpdatedEvent } from '@school-transport/shared-types';
import { ChevronRight, Wifi, WifiOff } from 'lucide-react';
import { getMyChildren } from '@/lib/api/parents';
import { useParentSocket } from '@/lib/realtime/parent-socket';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { StatusBadge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { BoardingStepper } from '@/components/parent-boarding-stepper';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

export default function ParentHome() {
  const { data: children, error, loading, reload } = useAsync(() => getMyChildren(), []);
  const [live, setLive] = useState<Record<string, ParentChildTransportUpdatedEvent>>({});

  const onChildUpdate = useCallback((event: ParentChildTransportUpdatedEvent) => {
    setLive((prev) => ({ ...prev, [event.childId]: event }));
  }, []);
  const { status: socketStatus } = useParentSocket(onChildUpdate);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-(--color-text)">My Children</h1>
        {children && children.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-(--color-text-faint)">
            {socketStatus === 'connected' ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-(--color-success-solid)" /> Live
              </>
            ) : socketStatus === 'reconnecting' ? (
              <>
                <WifiOff className="h-3.5 w-3.5 text-(--color-warning-solid)" /> Reconnecting…
              </>
            ) : null}
          </span>
        )}
      </div>

      {loading && <LoadingState label="Loading your children…" />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load your children.'} onRetry={reload} />
      )}
      {!loading && !error && children && children.length === 0 && (
        <EmptyState title="No children linked yet" description="Contact your school if this doesn't look right." />
      )}
      {!loading && !error && children && children.length > 0 && (
        <div className="space-y-3">
          {children.map((child) => {
            const liveUpdate = live[child.id];
            const transport = liveUpdate
              ? {
                  tripStatus: liveUpdate.tripStatus,
                  attendanceStatus: liveUpdate.attendanceStatus,
                  busDisplayName: liveUpdate.busDisplayName,
                  freshness: liveUpdate.location.freshness,
                }
              : child.transport;
            return (
              <Link
                key={child.id}
                href={`/parent/children/${child.id}`}
                className="group block rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-xs) transition-all duration-200 hover:-translate-y-0.5 hover:shadow-(--shadow-md)"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={child.fullName} size="md" />
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-(--color-text)">{child.fullName}</p>
                      <p className="text-xs text-(--color-text-faint)">
                        {child.grade ? `Grade ${child.grade}` : 'Grade —'} {child.section ? `· Section ${child.section}` : ''}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-(--color-text-faint) transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-(--color-brand-text)" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {transport.tripStatus && <StatusBadge status={transport.tripStatus} dot />}
                  {transport.attendanceStatus && transport.tripStatus === 'IN_PROGRESS' && <StatusBadge status={transport.attendanceStatus} />}
                  {transport.tripStatus === 'IN_PROGRESS' && transport.freshness && <StatusBadge status={transport.freshness} />}
                </div>
                {transport.busDisplayName && <p className="mt-2 text-xs text-(--color-text-faint)">{transport.busDisplayName}</p>}
                <div className="mt-2 border-t border-(--color-border) pt-3">
                  <BoardingStepper attendanceStatus={transport.attendanceStatus} tripStatus={transport.tripStatus} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
