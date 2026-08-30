'use client';

import { useCallback, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { ParentChildTransportUpdatedEvent, ParentTransportDto } from '@school-transport/shared-types';
import { getChildTransport } from '@/lib/api/parents';
import { useParentSocket } from '@/lib/realtime/parent-socket';
import { RequireAuth } from '@/components/require-auth';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, ErrorState } from '@/components/ui/states';

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.status === 404 ? 'This child is not linked to your account.' : 'Something went wrong.';
  return 'Something went wrong.';
}

function ChildDetail() {
  const { studentId } = useParams<{ studentId: string }>();
  const router = useRouter();
  const { data, error, loading, reload } = useAsync(() => getChildTransport(studentId), [studentId]);
  const [live, setLive] = useState<ParentChildTransportUpdatedEvent | null>(null);

  const onChildUpdate = useCallback(
    (event: ParentChildTransportUpdatedEvent) => {
      if (event.childId === studentId) setLive(event);
    },
    [studentId],
  );
  const { status: socketStatus } = useParentSocket(onChildUpdate);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={errorMessage(error)} onRetry={reload} />;

  // A live push always wins over the initial REST snapshot — it's newer by definition.
  const view: ParentTransportDto = live
    ? {
        ...data,
        trip: data.trip ? { ...data.trip, status: live.tripStatus } : data.trip,
        attendance: data.attendance ? { ...data.attendance, status: live.attendanceStatus } : data.attendance,
        bus: { displayName: live.busDisplayName },
        location:
          live.tripStatus === 'IN_PROGRESS'
            ? {
                latitude: live.location.latitude,
                longitude: live.location.longitude,
                speedKmh: live.location.speedKmh,
                heading: live.location.heading,
                lastUpdatedAt: live.lastUpdatedAt,
                freshness: live.location.freshness,
              }
            : null,
      }
    : data;

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <Button variant="secondary" onClick={() => router.back()} className="mb-4">
        Back
      </Button>

      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{view.child.fullName}</h1>
      <p className="mb-6 text-sm text-zinc-500">
        {view.child.grade ? `Grade ${view.child.grade}` : 'Grade —'} {view.child.section ? `· Section ${view.child.section}` : ''}
      </p>

      {!view.trip && (
        <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center dark:border-zinc-700">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No active trip right now.</p>
        </div>
      )}

      {view.trip && (
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-200 px-4 py-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {view.trip.direction === 'HOME_TO_SCHOOL' ? 'Morning trip' : 'Afternoon trip'}
              </p>
              <StatusBadge status={view.trip.status} />
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Scheduled {view.trip.scheduledStartTime} – {view.trip.scheduledEndTime}
            </p>
            {view.bus && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{view.bus.displayName}</p>}
          </div>

          {view.attendance && (
            <div className="rounded-lg border border-zinc-200 px-4 py-4 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Boarding status</p>
                <StatusBadge status={view.attendance.status} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-500">
                <p>Boarded: {formatTime(view.attendance.boardedAt)}</p>
                <p>Dropped off: {formatTime(view.attendance.droppedOffAt)}</p>
              </div>
            </div>
          )}

          {view.trip.status === 'CANCELLED' && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
              Today&apos;s trip was cancelled.
            </div>
          )}

          {view.trip.status === 'IN_PROGRESS' && (
            <div className="rounded-lg border border-zinc-200 px-4 py-4 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Bus location</p>
                {view.location && <StatusBadge status={view.location.freshness} />}
              </div>
              {view.location && view.location.latitude !== null && view.location.longitude !== null ? (
                <>
                  <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {view.location.latitude.toFixed(5)}, {view.location.longitude.toFixed(5)}
                    {view.location.speedKmh !== null ? ` · ${view.location.speedKmh.toFixed(0)} km/h` : ''}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">Last updated {formatRelative(view.location.lastUpdatedAt)}</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-zinc-500">Bus location is currently unavailable.</p>
              )}
            </div>
          )}

          {view.trip.status !== 'IN_PROGRESS' && (view.trip.status === 'SCHEDULED' || view.trip.status === 'READY') && (
            <p className="text-center text-sm text-zinc-500">No live bus location yet — the trip hasn&apos;t started.</p>
          )}
        </div>
      )}

      {view.trip?.status === 'IN_PROGRESS' && (
        <p className="mt-6 text-center text-xs text-zinc-400">
          {socketStatus === 'connected' ? 'Live updates on' : socketStatus === 'reconnecting' ? 'Reconnecting…' : ''}
        </p>
      )}
    </div>
  );
}

export default function ChildDetailPage() {
  return (
    <RequireAuth audience="PARENT">
      <ChildDetail />
    </RequireAuth>
  );
}
