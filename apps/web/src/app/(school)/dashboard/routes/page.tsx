'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { listRoutes } from '@/lib/api/routes';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { useDebounce } from '@/lib/use-debounce';
import { useCursorPagination } from '@/lib/use-cursor-pagination';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { CursorPagination } from '@/components/ui/pagination';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import type { RouteDto } from '@school-transport/shared-types';

const DIRECTION_LABELS: Record<string, string> = {
  HOME_TO_SCHOOL: 'Home → School',
  SCHOOL_TO_HOME: 'School → Home',
};

export default function RoutesPage() {
  const { principal } = useAuth();
  const canCreate = principal?.type === 'STAFF' && principal.permissions.includes('routes.manage');

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput);
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');
  const pagination = useCursorPagination();

  const { data: page, error, loading, reload } = useAsync(
    () =>
      listRoutes({
        limit: 20,
        cursor: pagination.cursor ?? undefined,
        search: search || undefined,
        status: status || undefined,
        direction: direction || undefined,
      }),
    [search, status, direction, pagination.cursor],
  );

  const items = page?.data ?? [];

  const columns: DataTableColumn<RouteDto>[] = [
    { key: 'code', header: 'Code', render: (r) => r.code ?? '—' },
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <Link href={`/dashboard/routes/${r.id}`} className="font-medium text-(--color-text) hover:text-(--color-brand-text)">
          {r.name}
        </Link>
      ),
    },
    { key: 'direction', header: 'Direction', render: (r) => DIRECTION_LABELS[r.direction] ?? r.direction },
    { key: 'stops', header: 'Stops', render: (r) => r.stopCount },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Routes"
        description="Route planning, direction, and stop sequencing."
        actions={
          canCreate && (
            <Link href="/dashboard/routes/new">
              <Button icon={Plus}>New route</Button>
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Search by name or code"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            pagination.reset();
          }}
          className="sm:max-w-xs"
        />
        <Select
          value={direction}
          onChange={(e) => {
            setDirection(e.target.value);
            pagination.reset();
          }}
          className="sm:max-w-[200px]"
        >
          <option value="">All directions</option>
          <option value="HOME_TO_SCHOOL">Home → School</option>
          <option value="SCHOOL_TO_HOME">School → Home</option>
        </Select>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            pagination.reset();
          }}
          className="sm:max-w-[180px]"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="ARCHIVED">Archived</option>
        </Select>
      </div>

      {loading && <TableSkeleton columns={5} />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load routes.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No routes found" description="Try adjusting your search or filters." />}
      {!loading && !error && items.length > 0 && <DataTable columns={columns} rows={items} getRowKey={(r) => r.id} />}
      {!loading && !error && items.length > 0 && (
        <CursorPagination hasPrev={pagination.hasPrev} hasNext={!!page?.nextCursor} onPrev={pagination.prev} onNext={() => pagination.next(page?.nextCursor)} />
      )}
    </div>
  );
}
