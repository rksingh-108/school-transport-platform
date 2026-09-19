'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus, Bus as BusIcon } from 'lucide-react';
import { listBuses } from '@/lib/api/buses';
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
import type { BusDto } from '@school-transport/shared-types';

export default function BusesPage() {
  const { principal } = useAuth();
  const canCreate = principal?.type === 'STAFF' && principal.permissions.includes('buses.manage');

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput);
  const [status, setStatus] = useState('');
  const pagination = useCursorPagination();

  const { data: page, error, loading, reload } = useAsync(
    () => listBuses({ limit: 20, cursor: pagination.cursor ?? undefined, search: search || undefined, status: status || undefined }),
    [search, status, pagination.cursor],
  );

  const items = page?.data ?? [];

  const columns: DataTableColumn<BusDto>[] = [
    {
      key: 'fleet',
      header: 'Fleet #',
      render: (b) => (
        <span className="flex items-center gap-2 text-(--color-text-muted)">
          <BusIcon className="h-4 w-4 text-(--color-text-faint)" /> {b.fleetNumber ?? '—'}
        </span>
      ),
    },
    {
      key: 'registration',
      header: 'Registration',
      render: (b) => (
        <Link href={`/dashboard/buses/${b.id}`} className="font-medium text-(--color-text) hover:text-(--color-brand-text)">
          {b.registrationNumber}
        </Link>
      ),
    },
    { key: 'model', header: 'Make / Model', render: (b) => [b.make, b.model].filter(Boolean).join(' ') || '—' },
    { key: 'capacity', header: 'Capacity', render: (b) => b.capacity },
    { key: 'status', header: 'Status', render: (b) => <StatusBadge status={b.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Buses"
        description="Fleet inventory, capacity, and operational status."
        actions={
          canCreate && (
            <Link href="/dashboard/buses/new">
              <Button icon={Plus}>New bus</Button>
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Search by registration, fleet #, make, model"
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
          <option value="MAINTENANCE">Maintenance</option>
          <option value="RETIRED">Retired</option>
        </Select>
      </div>

      {loading && <TableSkeleton columns={5} />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load buses.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No buses found" description="Try adjusting your search or filters." />}
      {!loading && !error && items.length > 0 && <DataTable columns={columns} rows={items} getRowKey={(b) => b.id} />}
      {!loading && !error && items.length > 0 && (
        <CursorPagination hasPrev={pagination.hasPrev} hasNext={!!page?.nextCursor} onPrev={pagination.prev} onNext={() => pagination.next(page?.nextCursor)} />
      )}
    </div>
  );
}
