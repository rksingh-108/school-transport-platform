'use client';

import Link from 'next/link';
import { useState } from 'react';
import { listCameras } from '@/lib/api/cameras';
import { useAsync } from '@/lib/use-async';
import { useDebounce } from '@/lib/use-debounce';
import { useCursorPagination } from '@/lib/use-cursor-pagination';
import { ApiError } from '@/lib/api-client';
import { Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { CursorPagination } from '@/components/ui/pagination';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import type { CameraDto } from '@school-transport/shared-types';

/**
 * School-wide, read-only camera inventory view. Creating/editing a camera
 * happens on the bus it belongs to (`/dashboard/buses/:id`) — the same
 * "manage on the bus, browse fleet-wide here" split already used for GPS
 * (Live Tracking is fleet-wide read; the GPS device itself is managed on the
 * bus detail page). See docs/adr/0018-camera-device-management-foundation.md.
 */
export default function CamerasPage() {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput);
  const [status, setStatus] = useState('');
  const pagination = useCursorPagination();

  const { data: page, error, loading, reload } = useAsync(
    () => listCameras({ limit: 20, cursor: pagination.cursor ?? undefined, search: search || undefined, status: status || undefined }),
    [search, status, pagination.cursor],
  );

  const items = page?.data ?? [];

  const columns: DataTableColumn<CameraDto>[] = [
    {
      key: 'camera',
      header: 'Camera',
      render: (c) => (
        <Link href={`/dashboard/buses/${c.busId}`} className="font-medium text-(--color-text) hover:text-(--color-brand-text)">
          {c.name}
          <span className="block text-xs font-normal text-(--color-text-faint)">{c.cameraCode}</span>
        </Link>
      ),
    },
    { key: 'position', header: 'Position', render: (c) => (c.position === 'CUSTOM' ? c.customPositionLabel : c.position) },
    {
      key: 'bus',
      header: 'Bus',
      render: (c) => (
        <Link href={`/dashboard/buses/${c.busId}`} className="text-(--color-brand-text) hover:underline">
          View bus
        </Link>
      ),
    },
    { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
    { key: 'connectivity', header: 'Connectivity', render: (c) => <StatusBadge status={c.connectivity} /> },
    {
      key: 'lastSeen',
      header: 'Last seen',
      render: (c) => <span className="text-(--color-text-muted)">{c.lastSeenAt ? new Date(c.lastSeenAt).toLocaleString() : 'Never'}</span>,
    },
  ];

  return (
    <div>
      <PageHeader title="Cameras" description="To add or edit a camera, open the bus it is mounted on." />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Search by name or camera code"
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
          <option value="FAULT">Fault</option>
          <option value="RETIRED">Retired</option>
        </Select>
      </div>

      {loading && <TableSkeleton columns={6} />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load cameras.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && (
        <EmptyState title="No cameras found" description="Try adjusting your search or filters." />
      )}
      {!loading && !error && items.length > 0 && <DataTable columns={columns} rows={items} getRowKey={(c) => c.id} />}
      {!loading && !error && items.length > 0 && (
        <CursorPagination hasPrev={pagination.hasPrev} hasNext={!!page?.nextCursor} onPrev={pagination.prev} onNext={() => pagination.next(page?.nextCursor)} />
      )}
    </div>
  );
}
