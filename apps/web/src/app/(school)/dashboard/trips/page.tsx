'use client';

import Link from 'next/link';
import { useState } from 'react';
import { listTrips } from '@/lib/api/trips';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function TripsPage() {
  const { principal } = useAuth();
  const canCreate = principal?.type === 'STAFF' && principal.permissions.includes('trips.manage');

  const [serviceDate, setServiceDate] = useState(todayIso());
  const [status, setStatus] = useState('');
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const { data: page, error, loading, reload } = useAsync(
    () => listTrips({ limit: 20, cursor: pageCursor ?? undefined, serviceDate: serviceDate || undefined, status: status || undefined }),
    [serviceDate, status, pageCursor],
  );

  function resetToFirstPage() {
    setPageCursor(null);
    setCursorStack([]);
  }

  function nextPage() {
    if (!page?.nextCursor) return;
    setCursorStack((s) => [...s, pageCursor ?? '']);
    setPageCursor(page.nextCursor);
  }

  function prevPage() {
    setCursorStack((s) => {
      const copy = [...s];
      const prev = copy.pop();
      setPageCursor(prev || null);
      return copy;
    });
  }

  const items = page?.data ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Trips</h1>
        {canCreate && (
          <Link href="/dashboard/trips/new">
            <Button>New trip</Button>
          </Link>
        )}
      </div>

      <div className="mb-4 flex gap-3">
        <Input
          type="date"
          value={serviceDate}
          onChange={(e) => {
            setServiceDate(e.target.value);
            resetToFirstPage();
          }}
          className="max-w-[180px]"
        />
        <Button variant="secondary" onClick={() => { setServiceDate(''); resetToFirstPage(); }}>
          All dates
        </Button>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            resetToFirstPage();
          }}
          className="max-w-[180px]"
        >
          <option value="">All statuses</option>
          <option value="SCHEDULED">Scheduled</option>
          <option value="READY">Ready</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="NO_SHOW">No show</option>
        </Select>
      </div>

      {loading && <LoadingState label="Loading trips…" />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load trips.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No trips found" description="Try adjusting the date or status filter." />}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Route</th>
                  <th className="px-4 py-2">Bus</th>
                  <th className="px-4 py-2">Driver</th>
                  <th className="px-4 py-2">Attendant</th>
                  <th className="px-4 py-2">Students</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2">{t.serviceDate}</td>
                    <td className="px-4 py-2">{t.scheduledStartTime}–{t.scheduledEndTime}</td>
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/trips/${t.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                        {t.routeCode ? `${t.routeCode} · ` : ''}
                        {t.routeName}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{t.busFleetNumber ?? t.busRegistrationNumber}</td>
                    <td className="px-4 py-2">{t.driverName}</td>
                    <td className="px-4 py-2">{t.attendantName ?? '—'}</td>
                    <td className="px-4 py-2">{t.studentCount}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" disabled={cursorStack.length === 0} onClick={prevPage}>
              Previous
            </Button>
            <Button variant="secondary" disabled={!page?.nextCursor} onClick={nextPage}>
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
