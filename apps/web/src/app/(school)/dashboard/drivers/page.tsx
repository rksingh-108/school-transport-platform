'use client';

import Link from 'next/link';
import { useState } from 'react';
import { listDrivers } from '@/lib/api/drivers';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

export default function DriversPage() {
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('drivers.manage');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const { data: page, error, loading, reload } = useAsync(
    () => listDrivers({ limit: 20, cursor: pageCursor ?? undefined, search: search || undefined, status: status || undefined }),
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
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Drivers</h1>
        {canManage && (
          <Link href="/dashboard/drivers/new">
            <Button>Assign driver</Button>
          </Link>
        )}
      </div>

      <div className="mb-4 flex gap-3">
        <Input
          placeholder="Search by name, email, or license"
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
        </Select>
      </div>

      {loading && <LoadingState label="Loading drivers…" />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load drivers.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No drivers found" description="Try adjusting your search or filters." />}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">License #</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/drivers/${d.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                        {d.fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{d.email}</td>
                    <td className="px-4 py-2">{d.licenseNumber}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={d.status} />
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
