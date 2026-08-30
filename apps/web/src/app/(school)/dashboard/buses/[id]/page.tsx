'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { BusDto, BusDeviceDto } from '@school-transport/shared-types';
import { archiveBus, deactivateDevice, getBus, listBusDevices, registerDevice, updateBus, updateDevice } from '@/lib/api/buses';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const DEVICE_TYPES = ['GPS_TRACKER', 'EDGE_COMPUTER', 'NETWORK_GATEWAY'] as const;

function errorMessage(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) return error.status === 404 ? notFoundMessage : error.message;
  return 'Something went wrong.';
}

async function loadBusAndDevices(id: string) {
  const [bus, devices] = await Promise.all([getBus(id), listBusDevices(id)]);
  return { bus, devices };
}

export default function BusDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync(() => loadBusAndDevices(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={errorMessage(error, 'Bus not found.')} onRetry={reload} />;

  return <BusEditForm key={data.bus.id} bus={data.bus} initialDevices={data.devices} />;
}

function BusEditForm({ bus, initialDevices }: { bus: BusDto; initialDevices: BusDeviceDto[] }) {
  const router = useRouter();
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('buses.manage');

  const [current, setCurrent] = useState(bus);
  const [fleetNumber, setFleetNumber] = useState(bus.fleetNumber ?? '');
  const [registrationNumber, setRegistrationNumber] = useState(bus.registrationNumber);
  const [capacity, setCapacity] = useState(String(bus.capacity));
  const [make, setMake] = useState(bus.make ?? '');
  const [model, setModel] = useState(bus.model ?? '');
  const [notes, setNotes] = useState(bus.notes ?? '');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | 'MAINTENANCE'>(
    bus.status === 'RETIRED' ? 'ACTIVE' : bus.status,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const [devices, setDevices] = useState(initialDevices);
  const [deviceType, setDeviceType] = useState<(typeof DEVICE_TYPES)[number]>('GPS_TRACKER');
  const [externalDeviceId, setExternalDeviceId] = useState('');
  const [registering, setRegistering] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);

  async function onSave() {
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await updateBus(current.id, {
        fleetNumber: fleetNumber || undefined,
        registrationNumber,
        capacity: Number(capacity),
        make: make || undefined,
        model: model || undefined,
        notes: notes || undefined,
        status,
      });
      setCurrent(updated);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Unable to save changes.');
    } finally {
      setSaving(false);
    }
  }

  async function onArchive() {
    setArchiving(true);
    try {
      const updated = await archiveBus(current.id);
      setCurrent(updated);
      setConfirmArchive(false);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Unable to archive bus.');
    } finally {
      setArchiving(false);
    }
  }

  async function onRegisterDevice(e: React.FormEvent) {
    e.preventDefault();
    setDeviceError(null);
    setRegistering(true);
    try {
      const device = await registerDevice(current.id, { deviceType, externalDeviceId });
      setDevices((prev) => [device, ...prev]);
      setExternalDeviceId('');
    } catch (err) {
      setDeviceError(err instanceof ApiError ? err.message : 'Unable to register device.');
    } finally {
      setRegistering(false);
    }
  }

  async function onDeactivateDevice(deviceId: string) {
    setDeviceError(null);
    setBusyDeviceId(deviceId);
    try {
      const updated = await deactivateDevice(deviceId);
      setDevices((prev) => prev.map((d) => (d.id === deviceId ? updated : d)));
    } catch (err) {
      setDeviceError(err instanceof ApiError ? err.message : 'Unable to deactivate device.');
    } finally {
      setBusyDeviceId(null);
    }
  }

  async function onMarkFaulty(deviceId: string) {
    setDeviceError(null);
    setBusyDeviceId(deviceId);
    try {
      const updated = await updateDevice(deviceId, { status: 'FAULTY' });
      setDevices((prev) => prev.map((d) => (d.id === deviceId ? updated : d)));
    } catch (err) {
      setDeviceError(err instanceof ApiError ? err.message : 'Unable to update device.');
    } finally {
      setBusyDeviceId(null);
    }
  }

  return (
    <div className="max-w-lg space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{current.registrationNumber}</h1>
          <p className="text-sm text-zinc-500">{current.fleetNumber ? `Fleet #${current.fleetNumber}` : 'No fleet number'}</p>
        </div>
        <StatusBadge status={current.status} />
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Bus details</h2>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Fleet number" htmlFor="fleetNumber">
            <Input id="fleetNumber" value={fleetNumber} disabled={!canManage} onChange={(e) => setFleetNumber(e.target.value)} />
          </FormField>
          <FormField label="Registration number" htmlFor="registrationNumber">
            <Input
              id="registrationNumber"
              value={registrationNumber}
              disabled={!canManage}
              onChange={(e) => setRegistrationNumber(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Capacity" htmlFor="capacity">
          <Input id="capacity" type="number" value={capacity} disabled={!canManage} onChange={(e) => setCapacity(e.target.value)} />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Make" htmlFor="make">
            <Input id="make" value={make} disabled={!canManage} onChange={(e) => setMake(e.target.value)} />
          </FormField>
          <FormField label="Model" htmlFor="model">
            <Input id="model" value={model} disabled={!canManage} onChange={(e) => setModel(e.target.value)} />
          </FormField>
        </div>
        {current.status !== 'RETIRED' && (
          <FormField label="Status" htmlFor="status">
            <Select
              id="status"
              value={status}
              disabled={!canManage}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="MAINTENANCE">Maintenance</option>
            </Select>
          </FormField>
        )}
        <FormField label="Notes" htmlFor="notes">
          <Input id="notes" value={notes} disabled={!canManage} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
        <div className="flex justify-between">
          <div className="flex gap-2">
            {canManage && current.status !== 'RETIRED' && (
              <Button onClick={onSave} loading={saving}>
                Save changes
              </Button>
            )}
            <Button variant="secondary" onClick={() => router.back()}>
              Back
            </Button>
          </div>
          {canManage && current.status !== 'RETIRED' && (
            <Button variant="danger" onClick={() => setConfirmArchive(true)}>
              Retire bus
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Devices</h2>
        {devices.length === 0 && <EmptyState title="No devices registered" />}
        {devices.map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {d.deviceType.replace('_', ' ')} · {d.externalDeviceId}
              </p>
              <p className="text-xs text-zinc-500">
                Last seen: {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never'}
                {d.firmwareVersion ? ` · Firmware ${d.firmwareVersion}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={d.status} />
              {canManage && d.status === 'ACTIVE' && (
                <Button variant="secondary" onClick={() => onMarkFaulty(d.id)} disabled={busyDeviceId === d.id}>
                  Mark faulty
                </Button>
              )}
              {canManage && d.status !== 'INACTIVE' && (
                <Button variant="danger" onClick={() => onDeactivateDevice(d.id)} disabled={busyDeviceId === d.id}>
                  Deactivate
                </Button>
              )}
            </div>
          </div>
        ))}

        {canManage && (
          <form onSubmit={onRegisterDevice} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 pt-2">
            <FormField label="Device type" htmlFor="deviceType">
              <Select id="deviceType" value={deviceType} onChange={(e) => setDeviceType(e.target.value as typeof deviceType)}>
                {DEVICE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Device identifier" htmlFor="externalDeviceId">
              <Input id="externalDeviceId" required value={externalDeviceId} onChange={(e) => setExternalDeviceId(e.target.value)} />
            </FormField>
            <Button type="submit" loading={registering}>
              Add
            </Button>
          </form>
        )}
        {deviceError && <p className="text-sm text-red-600 dark:text-red-400">{deviceError}</p>}
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title="Retire this bus?"
        description="A retired bus is removed from active service and cannot be reversed through this screen."
        confirmLabel="Retire"
        danger
        loading={archiving}
        onConfirm={onArchive}
        onCancel={() => setConfirmArchive(false)}
      />
    </div>
  );
}
