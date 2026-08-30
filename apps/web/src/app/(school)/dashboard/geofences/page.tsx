'use client';

import { useState } from 'react';
import { archiveGeofence, createGeofence, GEOFENCE_TYPES, listGeofences } from '@/lib/api/geofences';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * No map — coordinates/radius shown and entered as plain numbers, the same
 * convention used for routes/stops before any map provider exists (see
 * docs/adr/0007-map-and-storage-provider-abstraction.md). See
 * docs/adr/0020-geofencing-and-operational-safety-rules.md for why there is
 * no fourth "STOP" geofence type here — a stop's own zone already exists as
 * RouteStop.latitude/longitude/radiusMeters.
 */
export default function GeofencesPage() {
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
      reload();
    } catch {
      // surfaced via reload's own error state if it recurs
    } finally {
      setArchiving(false);
    }
  }

  const items = page?.data ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Geofences</h1>
          <p className="text-sm text-zinc-500">Standalone zones — attach a safety rule to monitor entry/exit.</p>
        </div>
        {canManage && <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : 'New geofence'}</Button>}
      </div>

      {showCreate && canManage && (
        <form onSubmit={onCreate} className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
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
          <div className="col-span-2 flex items-center gap-3">
            <Button type="submit" loading={creating}>Create</Button>
            {createError && <p className="text-sm text-red-600 dark:text-red-400">{createError}</p>}
          </div>
        </form>
      )}

      <div className="mb-4 flex gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[160px]">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="ARCHIVED">Archived</option>
        </Select>
      </div>

      {loading && <LoadingState label="Loading geofences…" />}
      {!loading && !!error && <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load geofences.'} onRetry={reload} />}
      {!loading && !error && items.length === 0 && <EmptyState title="No geofences found" />}
      {!loading && !error && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Coordinates</th>
                <th className="px-4 py-2">Radius</th>
                <th className="px-4 py-2">Status</th>
                {canManage && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {items.map((g) => (
                <tr key={g.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-100">{g.name}</td>
                  <td className="px-4 py-2">{g.type}</td>
                  <td className="px-4 py-2 text-zinc-500">{g.latitude.toFixed(5)}, {g.longitude.toFixed(5)}</td>
                  <td className="px-4 py-2 text-zinc-500">{g.radiusMeters}m</td>
                  <td className="px-4 py-2"><StatusBadge status={g.status} /></td>
                  {canManage && (
                    <td className="px-4 py-2">
                      {g.status !== 'ARCHIVED' && (
                        <Button variant="danger" onClick={() => setConfirmArchiveId(g.id)}>Archive</Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
