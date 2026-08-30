'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { RouteDto, RouteStopDto } from '@school-transport/shared-types';
import {
  archiveRoute,
  createStop,
  deleteStop,
  getRoute,
  listStops,
  reorderStops,
  updateRoute,
  updateStop,
} from '@/lib/api/routes';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const DIRECTION_LABELS: Record<string, string> = {
  HOME_TO_SCHOOL: 'Home → School',
  SCHOOL_TO_HOME: 'School → Home',
};

function errorMessage(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) return error.status === 404 ? notFoundMessage : error.message;
  return 'Something went wrong.';
}

async function loadRouteAndStops(id: string) {
  const [route, stops] = await Promise.all([getRoute(id), listStops(id)]);
  return { route, stops };
}

export default function RouteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync(() => loadRouteAndStops(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={errorMessage(error, 'Route not found.')} onRetry={reload} />;

  return <RouteEditView key={data.route.id} route={data.route} initialStops={data.stops} />;
}

function RouteEditView({ route, initialStops }: { route: RouteDto; initialStops: RouteStopDto[] }) {
  const router = useRouter();
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('routes.manage');

  const [current, setCurrent] = useState(route);
  const [code, setCode] = useState(route.code ?? '');
  const [name, setName] = useState(route.name);
  const [direction, setDirection] = useState(route.direction);
  const [shift, setShift] = useState(route.shift);
  const [description, setDescription] = useState(route.description ?? '');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(route.status === 'ARCHIVED' ? 'ACTIVE' : route.status);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const [stops, setStops] = useState(initialStops);
  const [stopError, setStopError] = useState<string | null>(null);
  const [busyStopId, setBusyStopId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingStopId, setEditingStopId] = useState<string | null>(null);

  const [showAddStop, setShowAddStop] = useState(false);
  const [newStopName, setNewStopName] = useState('');
  const [newStopAddress, setNewStopAddress] = useState('');
  const [newStopLat, setNewStopLat] = useState('');
  const [newStopLng, setNewStopLng] = useState('');
  const [newStopOffset, setNewStopOffset] = useState('0');
  const [newStopMode, setNewStopMode] = useState<'PICKUP' | 'DROPOFF' | 'BOTH'>('BOTH');
  const [addingStop, setAddingStop] = useState(false);

  async function onSaveRoute() {
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await updateRoute(current.id, { code: code || undefined, name, direction, shift, description: description || undefined, status });
      setCurrent(updated);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Unable to save changes.');
    } finally {
      setSaving(false);
    }
  }

  async function onArchiveRoute() {
    setArchiving(true);
    try {
      const updated = await archiveRoute(current.id);
      setCurrent(updated);
      setConfirmArchive(false);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Unable to archive route.');
    } finally {
      setArchiving(false);
    }
  }

  async function onAddStop(e: React.FormEvent) {
    e.preventDefault();
    setStopError(null);
    setAddingStop(true);
    try {
      const nextSequence = stops.length > 0 ? Math.max(...stops.map((s) => s.sequenceNo)) + 1 : 1;
      const stop = await createStop(current.id, {
        name: newStopName,
        address: newStopAddress || undefined,
        latitude: Number(newStopLat),
        longitude: Number(newStopLng),
        sequenceNo: nextSequence,
        expectedOffsetMinutes: Number(newStopOffset),
        mode: newStopMode,
      });
      setStops((prev) => [...prev, stop].sort((a, b) => a.sequenceNo - b.sequenceNo));
      setNewStopName('');
      setNewStopAddress('');
      setNewStopLat('');
      setNewStopLng('');
      setNewStopOffset('0');
      setShowAddStop(false);
    } catch (err) {
      setStopError(err instanceof ApiError ? err.message : 'Unable to add stop.');
    } finally {
      setAddingStop(false);
    }
  }

  async function move(stopId: string, direction: -1 | 1) {
    const index = stops.findIndex((s) => s.id === stopId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= stops.length) return;

    const reordered = [...stops];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];

    setStopError(null);
    setBusyStopId(stopId);
    try {
      const updated = await reorderStops(current.id, reordered.map((s) => s.id));
      setStops(updated);
    } catch (err) {
      setStopError(err instanceof ApiError ? err.message : 'Unable to reorder stops.');
    } finally {
      setBusyStopId(null);
    }
  }

  async function onToggleStopStatus(stop: RouteStopDto) {
    setStopError(null);
    setBusyStopId(stop.id);
    try {
      const updated = await updateStop(stop.id, { status: stop.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
      setStops((prev) => prev.map((s) => (s.id === stop.id ? updated : s)));
    } catch (err) {
      setStopError(err instanceof ApiError ? err.message : 'Unable to update stop.');
    } finally {
      setBusyStopId(null);
    }
  }

  async function onDeleteStop(stopId: string) {
    setStopError(null);
    setBusyStopId(stopId);
    try {
      await deleteStop(stopId);
      setStops((prev) => prev.filter((s) => s.id !== stopId));
      setConfirmDeleteId(null);
    } catch (err) {
      setStopError(err instanceof ApiError ? err.message : 'Unable to delete this stop.');
    } finally {
      setBusyStopId(null);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{current.name}</h1>
          <p className="text-sm text-zinc-500">
            {current.code ? `${current.code} · ` : ''}
            {DIRECTION_LABELS[current.direction] ?? current.direction}
          </p>
        </div>
        <StatusBadge status={current.status} />
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Route details</h2>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Code" htmlFor="code">
            <Input id="code" value={code} disabled={!canManage} onChange={(e) => setCode(e.target.value)} />
          </FormField>
          <FormField label="Name" htmlFor="name">
            <Input id="name" value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Direction" htmlFor="direction">
            <Select id="direction" value={direction} disabled={!canManage} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              <option value="HOME_TO_SCHOOL">Home → School</option>
              <option value="SCHOOL_TO_HOME">School → Home</option>
            </Select>
          </FormField>
          <FormField label="Shift" htmlFor="shift">
            <Select id="shift" value={shift} disabled={!canManage} onChange={(e) => setShift(e.target.value as typeof shift)}>
              <option value="MORNING_PICKUP">Morning pickup</option>
              <option value="AFTERNOON_DROP">Afternoon drop</option>
              <option value="CUSTOM">Custom</option>
            </Select>
          </FormField>
        </div>
        {current.status !== 'ARCHIVED' && (
          <FormField label="Status" htmlFor="status">
            <Select id="status" value={status} disabled={!canManage} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </FormField>
        )}
        <FormField label="Description" htmlFor="description">
          <Input id="description" value={description} disabled={!canManage} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
        <div className="flex justify-between">
          <div className="flex gap-2">
            {canManage && current.status !== 'ARCHIVED' && (
              <Button onClick={onSaveRoute} loading={saving}>
                Save changes
              </Button>
            )}
            <Button variant="secondary" onClick={() => router.back()}>
              Back
            </Button>
          </div>
          {canManage && current.status !== 'ARCHIVED' && (
            <Button variant="danger" onClick={() => setConfirmArchive(true)}>
              Archive route
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Map preview</h2>
        <p className="rounded-md border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700">
          No map provider is configured yet (see ADR 0007) — stops are shown below with their coordinates instead of a map.
        </p>
      </div>

      <div className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Stops ({stops.length})</h2>
          {canManage && (
            <Button variant="secondary" onClick={() => setShowAddStop((v) => !v)}>
              {showAddStop ? 'Cancel' : 'Add stop'}
            </Button>
          )}
        </div>

        {stops.length === 0 && <EmptyState title="No stops yet" description="Add the first stop on this route." />}

        {stops.map((stop, index) => (
          <StopRow
            key={stop.id}
            stop={stop}
            isFirst={index === 0}
            isLast={index === stops.length - 1}
            canManage={canManage}
            busy={busyStopId === stop.id}
            editing={editingStopId === stop.id}
            onEdit={() => setEditingStopId(editingStopId === stop.id ? null : stop.id)}
            onSaved={(updated) => {
              setStops((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
              setEditingStopId(null);
            }}
            onMoveUp={() => move(stop.id, -1)}
            onMoveDown={() => move(stop.id, 1)}
            onToggleStatus={() => onToggleStopStatus(stop)}
            onDeleteRequest={() => setConfirmDeleteId(stop.id)}
          />
        ))}

        {stopError && <p className="text-sm text-red-600 dark:text-red-400">{stopError}</p>}

        {showAddStop && (
          <form onSubmit={onAddStop} className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Name" htmlFor="newStopName">
                <Input id="newStopName" required value={newStopName} onChange={(e) => setNewStopName(e.target.value)} />
              </FormField>
              <FormField label="Address" htmlFor="newStopAddress">
                <Input id="newStopAddress" value={newStopAddress} onChange={(e) => setNewStopAddress(e.target.value)} />
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Latitude" htmlFor="newStopLat">
                <Input id="newStopLat" type="number" step="any" required value={newStopLat} onChange={(e) => setNewStopLat(e.target.value)} />
              </FormField>
              <FormField label="Longitude" htmlFor="newStopLng">
                <Input id="newStopLng" type="number" step="any" required value={newStopLng} onChange={(e) => setNewStopLng(e.target.value)} />
              </FormField>
              <FormField label="Offset (min)" htmlFor="newStopOffset">
                <Input id="newStopOffset" type="number" min={0} value={newStopOffset} onChange={(e) => setNewStopOffset(e.target.value)} />
              </FormField>
            </div>
            <FormField label="Mode" htmlFor="newStopMode">
              <Select id="newStopMode" value={newStopMode} onChange={(e) => setNewStopMode(e.target.value as typeof newStopMode)}>
                <option value="BOTH">Both</option>
                <option value="PICKUP">Pickup</option>
                <option value="DROPOFF">Dropoff</option>
              </Select>
            </FormField>
            <Button type="submit" loading={addingStop}>
              Add stop
            </Button>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title="Archive this route?"
        description="Archived routes are kept for historical trip records but can no longer be used for new trips."
        confirmLabel="Archive"
        danger
        loading={archiving}
        onConfirm={onArchiveRoute}
        onCancel={() => setConfirmArchive(false)}
      />

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete this stop?"
        description="This permanently removes the stop. If it has any historical trip records, deletion will be blocked and you should deactivate it instead."
        confirmLabel="Delete"
        danger
        loading={busyStopId === confirmDeleteId}
        onConfirm={() => confirmDeleteId && onDeleteStop(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

function StopRow({
  stop,
  isFirst,
  isLast,
  canManage,
  busy,
  editing,
  onEdit,
  onSaved,
  onMoveUp,
  onMoveDown,
  onToggleStatus,
  onDeleteRequest,
}: {
  stop: RouteStopDto;
  isFirst: boolean;
  isLast: boolean;
  canManage: boolean;
  busy: boolean;
  editing: boolean;
  onEdit: () => void;
  onSaved: (updated: RouteStopDto) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleStatus: () => void;
  onDeleteRequest: () => void;
}) {
  const [name, setName] = useState(stop.name);
  const [address, setAddress] = useState(stop.address ?? '');
  const [latitude, setLatitude] = useState(String(stop.latitude));
  const [longitude, setLongitude] = useState(String(stop.longitude));
  const [offset, setOffset] = useState(String(stop.expectedOffsetMinutes));
  const [mode, setMode] = useState(stop.mode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    setSaving(true);
    try {
      const updated = await updateStop(stop.id, {
        name,
        address: address || undefined,
        latitude: Number(latitude),
        longitude: Number(longitude),
        expectedOffsetMinutes: Number(offset),
        mode,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save stop.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {stop.sequenceNo}
          </span>
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{stop.name}</p>
            <p className="text-xs text-zinc-500">
              {stop.address ?? `${stop.latitude}, ${stop.longitude}`} · {stop.mode} · +{stop.expectedOffsetMinutes}min
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={stop.status} />
          {canManage && (
            <>
              <Button variant="secondary" onClick={onMoveUp} disabled={isFirst || busy}>
                ↑
              </Button>
              <Button variant="secondary" onClick={onMoveDown} disabled={isLast || busy}>
                ↓
              </Button>
              <Button variant="secondary" onClick={onEdit} disabled={busy}>
                {editing ? 'Close' : 'Edit'}
              </Button>
              <Button variant="secondary" onClick={onToggleStatus} disabled={busy}>
                {stop.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </Button>
              <Button variant="danger" onClick={onDeleteRequest} disabled={busy}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-3 space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Name" htmlFor={`name-${stop.id}`}>
              <Input id={`name-${stop.id}`} value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Address" htmlFor={`address-${stop.id}`}>
              <Input id={`address-${stop.id}`} value={address} onChange={(e) => setAddress(e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Latitude" htmlFor={`lat-${stop.id}`}>
              <Input id={`lat-${stop.id}`} type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} />
            </FormField>
            <FormField label="Longitude" htmlFor={`lng-${stop.id}`}>
              <Input id={`lng-${stop.id}`} type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} />
            </FormField>
            <FormField label="Offset (min)" htmlFor={`offset-${stop.id}`}>
              <Input id={`offset-${stop.id}`} type="number" min={0} value={offset} onChange={(e) => setOffset(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Mode" htmlFor={`mode-${stop.id}`}>
            <Select id={`mode-${stop.id}`} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="BOTH">Both</option>
              <option value="PICKUP">Pickup</option>
              <option value="DROPOFF">Dropoff</option>
            </Select>
          </FormField>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <Button onClick={onSave} loading={saving}>
            Save stop
          </Button>
        </div>
      )}
    </div>
  );
}
