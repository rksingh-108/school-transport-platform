'use client';

import { useState } from 'react';
import { archiveGeofence, createGeofence, GEOFENCE_TYPES, listGeofences } from '@/lib/api/geofences';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { FormField, Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { GeofenceDto } from '@school-transport/shared-types';

/**
 * No map — coordinates/radius shown and entered as plain numbers, the same
 * convention used for routes/stops before any map provider exists (see
 * docs/adr/0007-map-and-storage-provider-abstraction.md). See
 * docs/adr/0020-geofencing-and-operational-safety-rules.md for why there is
 * no fourth "STOP" geofence type here — a stop's own zone already exists as
 * RouteStop.latitude/longitude/radiusMeters.
 */
export default function GeofencesPage() {
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('geofences.manage');

  const [status, setStatus] = useState('');
  const { data: page, error, loading, reload } = useAsync(() => listGeofences({ limit: 50, status: status || undefined }), [status]);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof GEOFENCE_TYPES)[number]>('CUSTOM');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radiusMeters, setRadiusMeters] = useState('150');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await createGeofence({ name, type, latitude: Number(latitude), longitude: Number(longitude), radiusMeters: Number(radiusMeters) });
      setName('');
      setLatitude('');
      setLongitude('');
      setRadiusMeters('150');
      setShowCreate(false);
      toast.success('Geofence created');
      reload();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Unable to create geofence.');
    } finally {
      setCreating(false);
    }
  }

  async function onArchive() {
    if (!confirmArchiveId) return;
    setArchiving(true);
    try {
      await archiveGeofence(confirmArchiveId);
      setConfirmArchiveId(null);
      toast.success('Geofence archived');
      reload();
    } catch (err) {
      toast.error('Unable to archive geofence', err instanceof ApiError ? err.message : undefined);
    } finally {
      setArchiving(false);
    }
  }

  const items = page?.data ?? [];

  const columns: DataTableColumn<GeofenceDto>[] = [
    { key: 'name', header: 'Name', render: (g) => <span className="font-medium text-(--color-text)">{g.name}</span> },
    { key: 'type', header: 'Type', render: (g) => g.type },
    { key: 'coords', header: 'Coordinates', render: (g) => `${g.latitude.toFixed(5)}, ${g.longitude.toFixed(5)}` },
    { key: 'radius', header: 'Radius', render: (g) => `${g.radiusMeters}m` },
    { key: 'status', header: 'Status', render: (g) => <StatusBadge status={g.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Geofences"
        description="Standalone zones — attach a safety rule to monitor entry/exit."
        actions={canManage && <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : 'New geofence'}</Button>}
      />

      {showCreate && canManage && (
        <Card className="mb-6">
          <CardBody>
            <form onSubmit={onCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Name" htmlFor="name">
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
              </FormField>
              <FormField label="Type" htmlFor="type">
                <Select id="type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                  {GEOFENCE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Latitude" htmlFor="latitude">
                <Input id="latitude" type="number" step="any" required value={latitude} onChange={(e) => setLatitude(e.target.value)} />
              </FormField>
              <FormField label="Longitude" htmlFor="longitude">
                <Input id="longitude" type="number" step="any" required value={longitude} onChange={(e) => setLongitude(e.target.value)} />
              </FormField>
              <FormField label="Radius (meters)" htmlFor="radiusMeters">
                <Input id="radiusMeters" type="number" min={10} max={5000} required value={radiusMeters} onChange={(e) => setRadiusMeters(e.target.value)} />
              </FormField>
              <div className="sm:col-span-2 flex items-center gap-3">
                <Button type="submit" loading={creating}>Create</Button>
                {createError && <p className="text-sm text-(--color-danger-text)">{createError}</p>}
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <div className="mb-4 flex gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[180px]">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="ARCHIVED">Archived</option>
        </Select>
      </div>

      {loading && <TableSkeleton columns={5} />}
      {!loading && !!error && <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load geofences.'} onRetry={reload} />}
      {!loading && !error && items.length === 0 && <EmptyState title="No geofences found" />}
      {!loading && !error && items.length > 0 && (
        <DataTable
          columns={columns}
          rows={items}
          getRowKey={(g) => g.id}
          renderActions={
            canManage
              ? (g) =>
                  g.status !== 'ARCHIVED' && (
                    <Button variant="danger" size="sm" onClick={() => setConfirmArchiveId(g.id)}>
                      Archive
                    </Button>
                  )
              : undefined
          }
        />
      )}

      <ConfirmDialog
        open={!!confirmArchiveId}
        title="Archive this geofence?"
        description="Removes it from active use and disables any safety rule watching it. This cannot be reversed."
        confirmLabel="Archive"
        danger
        loading={archiving}
        onConfirm={onArchive}
        onCancel={() => setConfirmArchiveId(null)}
      />
    </div>
  );
}
