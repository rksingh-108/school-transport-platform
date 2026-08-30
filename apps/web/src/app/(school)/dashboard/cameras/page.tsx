'use client';

import Link from 'next/link';
import { useState } from 'react';
import { listCameras } from '@/lib/api/cameras';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

/**
 * School-wide, read-only camera inventory view. Creating/editing a camera
 * happens on the bus it belongs to (`/dashboard/buses/:id`) — the same
 * "manage on the bus, browse fleet-wide here" split already used for GPS
 * (Live Tracking is fleet-wide read; the GPS device itself is managed on the
 * bus detail page). See docs/adr/0018-camera-device-management-foundation.md.
 */
export default function CamerasPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const { data: page, error, loading, reload } = useAsync(
    () => listCameras({ limit: 20, cursor: pageCursor ?? undefined, search: search || undefined, status: status || undefined }),
    [search, status, pageCursor],
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
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Cameras</h1>
        <p className="text-sm text-zinc-500">To add or edit a camera, open the bus it is mounted on.</p>
      </div>

      <div className="mb-4 flex gap-3">
        <Input
          placeholder="Search by name or camera code"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetToFirstPage();
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            resetToFirstPage();
          }}
          className="max-w-[160px]"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="FAULT">Fault</option>
          <option value="RETIRED">Retired</option>
        </Select>
      </div>

      {loading && <LoadingState label="Loading cameras…" />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load cameras.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && (
        <EmptyState title="No cameras found" description="Try adjusting your search or filters." />
      )}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2">Camera</th>
                  <th className="px-4 py-2">Position</th>
                  <th className="px-4 py-2">Bus</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Connectivity</th>
                  <th className="px-4 py-2">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/buses/${c.busId}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                        {c.name}
                      </Link>
                      <p className="text-xs text-zinc-500">{c.cameraCode}</p>
                    </td>
                    <td className="px-4 py-2">{c.position === 'CUSTOM' ? c.customPositionLabel : c.position}</td>
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/buses/${c.busId}`} className="hover:underline">
                        View bus
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={c.connectivity} />
                    </td>
                    <td className="px-4 py-2 text-zinc-500">{c.lastSeenAt ? new Date(c.lastSeenAt).toLocaleString() : 'Never'}</td>
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
