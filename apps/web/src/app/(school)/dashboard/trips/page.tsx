'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { listTrips } from '@/lib/api/trips';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
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
import type { TripDto } from '@school-transport/shared-types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function TripsPage() {
  const { principal } = useAuth();
  const canCreate = principal?.type === 'STAFF' && principal.permissions.includes('trips.manage');

  const [serviceDate, setServiceDate] = useState(todayIso());
  const [status, setStatus] = useState('');
  const pagination = useCursorPagination();

  const { data: page, error, loading, reload } = useAsync(
    () => listTrips({ limit: 20, cursor: pagination.cursor ?? undefined, serviceDate: serviceDate || undefined, status: status || undefined }),
    [serviceDate, status, pagination.cursor],
  );

  const items = page?.data ?? [];

  const columns: DataTableColumn<TripDto>[] = [
    { key: 'date', header: 'Date', render: (t) => t.serviceDate },
    { key: 'time', header: 'Time', render: (t) => `${t.scheduledStartTime}–${t.scheduledEndTime}` },
    {
      key: 'route',
      header: 'Route',
      render: (t) => (
        <Link href={`/dashboard/trips/${t.id}`} className="font-medium text-(--color-text) hover:text-(--color-brand-text)">
          {t.routeCode ? `${t.routeCode} · ` : ''}
          {t.routeName}
        </Link>
      ),
    },
    { key: 'bus', header: 'Bus', render: (t) => t.busFleetNumber ?? t.busRegistrationNumber },
    { key: 'driver', header: 'Driver', render: (t) => t.driverName },
    { key: 'attendant', header: 'Attendant', render: (t) => t.attendantName ?? '—' },
    { key: 'students', header: 'Students', render: (t) => t.studentCount },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Trips"
        description="Scheduled and in-progress transport runs."
        actions={
          canCreate && (
            <Link href="/dashboard/trips/new">
              <Button icon={Plus}>New trip</Button>
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          type="date"
          value={serviceDate}
          onChange={(e) => {
            setServiceDate(e.target.value);
            pagination.reset();
          }}
          className="sm:max-w-[180px]"
        />
        <Button
          variant="secondary"
          onClick={() => {
            setServiceDate('');
            pagination.reset();
          }}
        >
          All dates
        </Button>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            pagination.reset();
          }}
          className="sm:max-w-[180px]"
        >
          <option value="">All statuses</option>
          <option value="SCHEDULED">Scheduled</option>
          <option value="READY">Ready</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="NO_SHOW">No show</option>
        </Select>
      </div>

      {loading && <TableSkeleton columns={8} />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load trips.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No trips found" description="Try adjusting the date or status filter." />}
      {!loading && !error && items.length > 0 && <DataTable columns={columns} rows={items} getRowKey={(t) => t.id} />}
      {!loading && !error && items.length > 0 && (
        <CursorPagination hasPrev={pagination.hasPrev} hasNext={!!page?.nextCursor} onPrev={pagination.prev} onNext={() => pagination.next(page?.nextCursor)} />
      )}
    </div>
  );
}
