'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { listAttendants } from '@/lib/api/attendants';
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
import type { AttendantDto } from '@school-transport/shared-types';

export default function AttendantsPage() {
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('attendants.manage');

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput);
  const [status, setStatus] = useState('');
  const pagination = useCursorPagination();

  const { data: page, error, loading, reload } = useAsync(
    () => listAttendants({ limit: 20, cursor: pagination.cursor ?? undefined, search: search || undefined, status: status || undefined }),
    [search, status, pagination.cursor],
  );

  const items = page?.data ?? [];

  const columns: DataTableColumn<AttendantDto>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (a) => (
        <Link href={`/dashboard/attendants/${a.id}`} className="flex items-center gap-2.5 font-medium text-(--color-text) hover:text-(--color-brand-text)">
          <Avatar name={a.fullName} size="sm" />
          {a.fullName}
        </Link>
      ),
    },
    { key: 'email', header: 'Email', render: (a) => a.email },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Attendants"
        description="Staff assigned to ride along and manage boarding."
        actions={
          canManage && (
            <Link href="/dashboard/attendants/new">
              <Button icon={Plus}>Assign attendant</Button>
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Search by name or email"
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

      {loading && <TableSkeleton columns={3} />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load attendants.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && (
        <EmptyState title="No attendants found" description="Try adjusting your search or filters." />
      )}
      {!loading && !error && items.length > 0 && <DataTable columns={columns} rows={items} getRowKey={(a) => a.id} />}
      {!loading && !error && items.length > 0 && (
        <CursorPagination hasPrev={pagination.hasPrev} hasNext={!!page?.nextCursor} onPrev={pagination.prev} onNext={() => pagination.next(page?.nextCursor)} />
      )}
    </div>
  );
}
