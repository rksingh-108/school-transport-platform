'use client';

import { useCallback, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { ParentChildTransportUpdatedEvent, ParentTransportDto } from '@school-transport/shared-types';
import { ArrowLeft, MapPin, Wifi, WifiOff } from 'lucide-react';
import { getChildTransport } from '@/lib/api/parents';
import { useParentSocket } from '@/lib/realtime/parent-socket';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { IconButton } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { BoardingStepper } from '@/components/parent-boarding-stepper';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { LiveMap, type LiveMapMarker } from '@/components/ui/map/live-map';

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

export default function ChildDetailPage() {
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
    <div>
      <div className="mb-4 flex items-center gap-2">
        <IconButton icon={ArrowLeft} label="Back" onClick={() => router.back()} />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-(--color-text)">{view.child.fullName}</h1>
          <p className="text-xs text-(--color-text-faint)">
            {view.child.grade ? `Grade ${view.child.grade}` : 'Grade —'} {view.child.section ? `· Section ${view.child.section}` : ''}
          </p>
        </div>
      </div>

      {!view.trip && (
        <Card className="border-dashed">
          <CardBody className="text-center">
            <p className="text-sm font-medium text-(--color-text-muted)">No active trip right now.</p>
          </CardBody>
        </Card>
      )}

      {view.trip && (
        <div className="space-y-3">
          <Card>
            <CardBody>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-(--color-text)">
                  {view.trip.direction === 'HOME_TO_SCHOOL' ? 'Morning trip' : 'Afternoon trip'}
                </p>
                <StatusBadge status={view.trip.status} />
              </div>
              <p className="mt-1 text-xs text-(--color-text-faint)">
                Scheduled {view.trip.scheduledStartTime} – {view.trip.scheduledEndTime}
              </p>
              {view.bus && <p className="mt-1.5 text-sm text-(--color-text-muted)">{view.bus.displayName}</p>}
            </CardBody>
          </Card>

          {view.attendance && (
            <Card>
              <CardBody>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-(--color-text)">Boarding status</p>
                  <StatusBadge status={view.attendance.status} />
                </div>
                <div className="mt-3">
                  <BoardingStepper attendanceStatus={view.attendance.status} tripStatus={view.trip.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-(--color-text-faint)">
                  <p>Boarded: {formatTime(view.attendance.boardedAt)}</p>
                  <p>Dropped off: {formatTime(view.attendance.droppedOffAt)}</p>
                </div>
              </CardBody>
            </Card>
          )}

          {view.trip.status === 'CANCELLED' && (
            <div className="rounded-(--radius-lg) border border-(--color-danger-border) bg-(--color-danger-bg) p-4 text-sm text-(--color-danger-text)">
              Today&apos;s trip was cancelled.
            </div>
          )}

          {view.trip.status === 'IN_PROGRESS' && (
            <Card>
              <CardBody>
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-(--color-text)">
                    <MapPin className="h-4 w-4 text-(--color-text-faint)" /> Bus location
                  </p>
                  {view.location && <StatusBadge status={view.location.freshness} />}
                </div>
                {view.location && view.location.latitude !== null && view.location.longitude !== null ? (
                  <>
                    <div className="mt-3">
                      <LiveMap
                        heightClassName="h-64"
                        markers={[
                          {
                            id: 'child-bus',
                            latitude: view.location.latitude,
                            longitude: view.location.longitude,
                            heading: view.location.heading,
                            tone: view.location.freshness === 'LIVE' ? 'success' : view.location.freshness === 'STALE' ? 'warning' : 'neutral',
                            label: view.bus?.displayName ?? 'Bus',
                          } satisfies LiveMapMarker,
                        ]}
                      />
                    </div>
                    <p className="mt-2 text-sm text-(--color-text)">
                      {view.location.latitude.toFixed(5)}, {view.location.longitude.toFixed(5)}
                      {view.location.speedKmh !== null ? ` · ${view.location.speedKmh.toFixed(0)} km/h` : ''}
                    </p>
                    <p className="mt-1 text-xs text-(--color-text-faint)">Last updated {formatRelative(view.location.lastUpdatedAt)}</p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-(--color-text-muted)">Bus location is currently unavailable.</p>
                )}
              </CardBody>
            </Card>
          )}

          {view.trip.status !== 'IN_PROGRESS' && (view.trip.status === 'SCHEDULED' || view.trip.status === 'READY') && (
            <p className="text-center text-sm text-(--color-text-faint)">No live bus location yet — the trip hasn&apos;t started.</p>
          )}
        </div>
      )}

      {view.trip?.status === 'IN_PROGRESS' && (
        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-(--color-text-faint)">
          {socketStatus === 'connected' ? (
            <>
              <Wifi className="h-3.5 w-3.5 text-(--color-success-solid)" /> Live updates on
            </>
          ) : socketStatus === 'reconnecting' ? (
            <>
              <WifiOff className="h-3.5 w-3.5 text-(--color-warning-solid)" /> Reconnecting…
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}
