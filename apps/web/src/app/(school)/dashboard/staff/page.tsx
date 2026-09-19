'use client';

import Link from 'next/link';
import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { listStaff } from '@/lib/api/staff';
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
import type { StaffDto } from '@school-transport/shared-types';

export default function StaffPage() {
  const { principal } = useAuth();
  const canInvite = principal?.type === 'STAFF' && principal.permissions.includes('users.create');

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput);
  const [status, setStatus] = useState('');
  const pagination = useCursorPagination();

  const { data: page, error, loading, reload } = useAsync(
    () => listStaff({ limit: 20, cursor: pagination.cursor ?? undefined, search: search || undefined, status: status || undefined }),
    [search, status, pagination.cursor],
  );

  const items = page?.data ?? [];

  const columns: DataTableColumn<StaffDto>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (u) => (
        <Link href={`/dashboard/staff/${u.id}`} className="flex items-center gap-2.5 font-medium text-(--color-text) hover:text-(--color-brand-text)">
          <Avatar name={u.fullName} size="sm" />
          {u.fullName}
        </Link>
      ),
    },
    { key: 'email', header: 'Email', render: (u) => u.email },
    { key: 'roles', header: 'Roles', render: (u) => u.roles.join(', ').replaceAll('_', ' ') },
    { key: 'status', header: 'Status', render: (u) => <StatusBadge status={u.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Staff"
        description="School staff accounts and role assignments."
        actions={
          canInvite && (
            <Link href="/dashboard/staff/invite">
              <Button icon={UserPlus}>Invite staff</Button>
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
          <option value="INVITED">Invited</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DISABLED">Disabled</option>
        </Select>
      </div>

      {loading && <TableSkeleton columns={4} />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load staff.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No staff found" description="Try adjusting your search or filters." />}
      {!loading && !error && items.length > 0 && <DataTable columns={columns} rows={items} getRowKey={(u) => u.id} />}
      {!loading && !error && items.length > 0 && (
        <CursorPagination hasPrev={pagination.hasPrev} hasNext={!!page?.nextCursor} onPrev={pagination.prev} onNext={() => pagination.next(page?.nextCursor)} />
      )}
    </div>
  );
}
