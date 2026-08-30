'use client';

import Link from 'next/link';
import { useState } from 'react';
import { listBuses } from '@/lib/api/buses';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

export default function BusesPage() {
  const { principal } = useAuth();
  const canCreate = principal?.type === 'STAFF' && principal.permissions.includes('buses.manage');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const { data: page, error, loading, reload } = useAsync(
    () => listBuses({ limit: 20, cursor: pageCursor ?? undefined, search: search || undefined, status: status || undefined }),
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
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Buses</h1>
        {canCreate && (
          <Link href="/dashboard/buses/new">
            <Button>New bus</Button>
          </Link>
        )}
      </div>

      <div className="mb-4 flex gap-3">
        <Input
          placeholder="Search by registration, fleet #, make, model"
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
          <option value="MAINTENANCE">Maintenance</option>
          <option value="RETIRED">Retired</option>
        </Select>
      </div>

      {loading && <LoadingState label="Loading buses…" />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load buses.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No buses found" description="Try adjusting your search or filters." />}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2">Fleet #</th>
                  <th className="px-4 py-2">Registration</th>
                  <th className="px-4 py-2">Make / Model</th>
                  <th className="px-4 py-2">Capacity</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2">{b.fleetNumber ?? '—'}</td>
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/buses/${b.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                        {b.registrationNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{[b.make, b.model].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-4 py-2">{b.capacity}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={b.status} />
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
