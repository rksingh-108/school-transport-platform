'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { listParents } from '@/lib/api/parents';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { useDebounce } from '@/lib/use-debounce';
import { useCursorPagination } from '@/lib/use-cursor-pagination';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { CursorPagination } from '@/components/ui/pagination';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import type { ParentDto } from '@school-transport/shared-types';

export default function ParentsPage() {
  const { principal } = useAuth();
  const canCreate = principal?.type === 'STAFF' && principal.permissions.includes('parents.create');

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput);
  const pagination = useCursorPagination();

  const { data: page, error, loading, reload } = useAsync(
    () => listParents({ limit: 20, cursor: pagination.cursor ?? undefined, search: search || undefined }),
    [search, pagination.cursor],
  );

  const items = page?.data ?? [];

  const columns: DataTableColumn<ParentDto>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (p) => (
        <Link href={`/dashboard/parents/${p.id}`} className="flex items-center gap-2.5 font-medium text-(--color-text) hover:text-(--color-brand-text)">
          <Avatar name={p.fullName} size="sm" />
          {p.fullName}
        </Link>
      ),
    },
    { key: 'phone', header: 'Phone', render: (p) => p.phone },
    { key: 'email', header: 'Email', render: (p) => p.email ?? '—' },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Parents"
        description="Guardian accounts and linked children."
        actions={
          canCreate && (
            <Link href="/dashboard/parents/new">
              <Button icon={Plus}>New parent</Button>
            </Link>
          )
        }
      />

      <div className="mb-4">
        <Input
          placeholder="Search by name or phone"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            pagination.reset();
          }}
          className="max-w-xs"
        />
      </div>

      {loading && <TableSkeleton columns={4} />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load parents.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No parents found" description="Try adjusting your search." />}
      {!loading && !error && items.length > 0 && <DataTable columns={columns} rows={items} getRowKey={(p) => p.id} />}
      {!loading && !error && items.length > 0 && (
        <CursorPagination hasPrev={pagination.hasPrev} hasNext={!!page?.nextCursor} onPrev={pagination.prev} onNext={() => pagination.next(page?.nextCursor)} />
      )}
    </div>
  );
}
