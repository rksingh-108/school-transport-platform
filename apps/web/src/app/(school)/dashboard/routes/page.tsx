'use client';

import Link from 'next/link';
import { useState } from 'react';
import { listRoutes } from '@/lib/api/routes';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

const DIRECTION_LABELS: Record<string, string> = {
  HOME_TO_SCHOOL: 'Home → School',
  SCHOOL_TO_HOME: 'School → Home',
};

export default function RoutesPage() {
  const { principal } = useAuth();
  const canCreate = principal?.type === 'STAFF' && principal.permissions.includes('routes.manage');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const { data: page, error, loading, reload } = useAsync(
    () =>
      listRoutes({
        limit: 20,
        cursor: pageCursor ?? undefined,
        search: search || undefined,
        status: status || undefined,
        direction: direction || undefined,
      }),
    [search, status, direction, pageCursor],
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
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Routes</h1>
        {canCreate && (
          <Link href="/dashboard/routes/new">
            <Button>New route</Button>
          </Link>
        )}
      </div>

      <div className="mb-4 flex gap-3">
        <Input
          placeholder="Search by name or code"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetToFirstPage();
          }}
          className="max-w-xs"
        />
        <Select
          value={direction}
          onChange={(e) => {
            setDirection(e.target.value);
            resetToFirstPage();
          }}
          className="max-w-[180px]"
        >
          <option value="">All directions</option>
          <option value="HOME_TO_SCHOOL">Home → School</option>
          <option value="SCHOOL_TO_HOME">School → Home</option>
        </Select>
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
          <option value="ARCHIVED">Archived</option>
        </Select>
      </div>

      {loading && <LoadingState label="Loading routes…" />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load routes.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No routes found" description="Try adjusting your search or filters." />}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2">Code</th>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Direction</th>
                  <th className="px-4 py-2">Stops</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2">{r.code ?? '—'}</td>
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/routes/${r.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{DIRECTION_LABELS[r.direction] ?? r.direction}</td>
                    <td className="px-4 py-2">{r.stopCount}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={r.status} />
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
