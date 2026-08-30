'use client';

import Link from 'next/link';
import { useState } from 'react';
import { listParents } from '@/lib/api/parents';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

export default function ParentsPage() {
  const { principal } = useAuth();
  const canCreate = principal?.type === 'STAFF' && principal.permissions.includes('parents.create');

  const [search, setSearch] = useState('');
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const { data: page, error, loading, reload } = useAsync(
    () => listParents({ limit: 20, cursor: pageCursor ?? undefined, search: search || undefined }),
    [search, pageCursor],
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
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Parents</h1>
        {canCreate && (
          <Link href="/dashboard/parents/new">
            <Button>New parent</Button>
          </Link>
        )}
      </div>

      <div className="mb-4">
        <Input
          placeholder="Search by name or phone"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetToFirstPage();
          }}
          className="max-w-xs"
        />
      </div>

      {loading && <LoadingState label="Loading parents…" />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load parents.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No parents found" description="Try adjusting your search." />}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Phone</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/parents/${p.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                        {p.fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{p.phone}</td>
                    <td className="px-4 py-2">{p.email ?? '—'}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={p.status} />
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
