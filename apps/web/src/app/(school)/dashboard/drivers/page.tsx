'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { listDrivers } from '@/lib/api/drivers';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { useDebounce } from '@/lib/use-debounce';
import { useCursorPagination } from '@/lib/use-cursor-pagination';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { CursorPagination } from '@/components/ui/pagination';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import type { DriverDto } from '@school-transport/shared-types';

export default function DriversPage() {
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('drivers.manage');

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput);
  const [status, setStatus] = useState('');
  const pagination = useCursorPagination();

  const { data: page, error, loading, reload } = useAsync(
    () => listDrivers({ limit: 20, cursor: pagination.cursor ?? undefined, search: search || undefined, status: status || undefined }),
    [search, status, pagination.cursor],
  );

  const items = page?.data ?? [];

  const columns: DataTableColumn<DriverDto>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (d) => (
        <Link href={`/dashboard/drivers/${d.id}`} className="flex items-center gap-2.5 font-medium text-(--color-text) hover:text-(--color-brand-text)">
          <Avatar name={d.fullName} size="sm" />
          {d.fullName}
        </Link>
      ),
    },
    { key: 'email', header: 'Email', render: (d) => d.email },
    { key: 'license', header: 'License #', render: (d) => d.licenseNumber },
    { key: 'status', header: 'Status', render: (d) => <StatusBadge status={d.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Drivers"
        description="Staff assigned to drive routes, and their license status."
        actions={
          canManage && (
            <Link href="/dashboard/drivers/new">
              <Button icon={Plus}>Assign driver</Button>
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Search by name, email, or license"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            pagination.reset();
          }}
          className="sm:max-w-xs"
        />
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
        </Select>
      </div>

      {loading && <TableSkeleton columns={4} />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load drivers.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No drivers found" description="Try adjusting your search or filters." />}
      {!loading && !error && items.length > 0 && <DataTable columns={columns} rows={items} getRowKey={(d) => d.id} />}
      {!loading && !error && items.length > 0 && (
        <CursorPagination hasPrev={pagination.hasPrev} hasNext={!!page?.nextCursor} onPrev={pagination.prev} onNext={() => pagination.next(page?.nextCursor)} />
      )}
    </div>
  );
}
