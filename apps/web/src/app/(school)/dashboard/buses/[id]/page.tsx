'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { BusDto, BusDeviceDto, BusLocationDto, CameraDto } from '@school-transport/shared-types';
import {
  archiveBus,
  deactivateDevice,
  getBus,
  listBusDevices,
  registerDevice,
  rotateDeviceCredential,
  updateBus,
  updateDevice,
} from '@/lib/api/buses';
import { getBusLocation } from '@/lib/api/gps';
import {
  CAMERA_POSITIONS,
  archiveCamera,
  createCamera,
  getCameraStream,
  listCamerasForBus,
  rotateCameraCredential,
  updateCamera,
} from '@/lib/api/cameras';
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
  // A driver/attendant viewing their own bus has `gps.read` but not
  // `buses.read`/`buses.manage`/`camera.read` — the bus and device lookups
  // above already 403 for them (this page is only linked from
  // buses.read-gated screens in practice), so location/cameras alone must
  // not fail the whole page load.
  const [bus, devices, location, cameras] = await Promise.all([
    getBus(id),
    listBusDevices(id),
    getBusLocation(id).catch(() => null),
    listCamerasForBus(id).catch(() => null),
  ]);
  return { bus, devices, location, cameras };
}

export default function BusDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync(() => loadBusAndDevices(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={errorMessage(error, 'Bus not found.')} onRetry={reload} />;

  return (
    <BusEditForm
      key={data.bus.id}
      bus={data.bus}
      initialDevices={data.devices}
      location={data.location}
      initialCameras={data.cameras}
    />
  );
}

function BusEditForm({
  bus,
  initialDevices,
  location,
  initialCameras,
}: {
  bus: BusDto;
  initialDevices: BusDeviceDto[];
  location: BusLocationDto | null;
  initialCameras: CameraDto[] | null;
}) {
  const router = useRouter();
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('buses.manage');
  const canManageCameras = principal?.type === 'STAFF' && principal.permissions.includes('camera.manage');
  const canReadCameras = canManageCameras || (principal?.type === 'STAFF' && principal.permissions.includes('camera.read'));

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
  const [issuedCredential, setIssuedCredential] = useState<{ deviceId: string; token: string } | null>(null);

  const [cameras, setCameras] = useState<CameraDto[]>(initialCameras ?? []);
  const [cameraCode, setCameraCode] = useState('');
  const [cameraName, setCameraName] = useState('');
  const [cameraPosition, setCameraPosition] = useState<(typeof CAMERA_POSITIONS)[number]>('FRONT');
  const [cameraSerialNumber, setCameraSerialNumber] = useState('');
  const [creatingCamera, setCreatingCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busyCameraId, setBusyCameraId] = useState<string | null>(null);
  const [issuedCameraCredential, setIssuedCameraCredential] = useState<{ cameraId: string; token: string } | null>(null);
  const [streamMessage, setStreamMessage] = useState<{ cameraId: string; message: string } | null>(null);
  const [confirmArchiveCamera, setConfirmArchiveCamera] = useState<CameraDto | null>(null);
  const [archivingCamera, setArchivingCamera] = useState(false);

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

  async function onRotateCredential(deviceId: string) {
    setDeviceError(null);
    setIssuedCredential(null);
    setBusyDeviceId(deviceId);
    try {
      const result = await rotateDeviceCredential(deviceId);
      setIssuedCredential({ deviceId, token: result.token });
      setDevices((prev) =>
        prev.map((d) => (d.id === deviceId ? { ...d, credentialSetAt: result.issuedAt } : d)),
      );
    } catch (err) {
      setDeviceError(err instanceof ApiError ? err.message : 'Unable to issue a credential.');
    } finally {
      setBusyDeviceId(null);
    }
  }

  async function onCreateCamera(e: React.FormEvent) {
    e.preventDefault();
    setCameraError(null);
    setCreatingCamera(true);
    try {
      const camera = await createCamera(current.id, {
        cameraCode,
        name: cameraName,
        position: cameraPosition,
        serialNumber: cameraSerialNumber,
      });
      setCameras((prev) => [camera, ...prev]);
      setCameraCode('');
      setCameraName('');
      setCameraSerialNumber('');
    } catch (err) {
      setCameraError(err instanceof ApiError ? err.message : 'Unable to create camera.');
    } finally {
      setCreatingCamera(false);
    }
  }

  async function onMarkCameraFault(cameraId: string) {
    setCameraError(null);
    setBusyCameraId(cameraId);
    try {
      const updated = await updateCamera(cameraId, { status: 'FAULT' });
      setCameras((prev) => prev.map((c) => (c.id === cameraId ? updated : c)));
    } catch (err) {
      setCameraError(err instanceof ApiError ? err.message : 'Unable to update camera.');
    } finally {
      setBusyCameraId(null);
    }
  }

  async function onArchiveCamera() {
    if (!confirmArchiveCamera) return;
    setArchivingCamera(true);
    try {
      const updated = await archiveCamera(confirmArchiveCamera.id);
      setCameras((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setConfirmArchiveCamera(null);
    } catch (err) {
      setCameraError(err instanceof ApiError ? err.message : 'Unable to archive camera.');
    } finally {
      setArchivingCamera(false);
    }
  }

  async function onRotateCameraCredential(cameraId: string) {
    setCameraError(null);
    setIssuedCameraCredential(null);
    setBusyCameraId(cameraId);
    try {
      const result = await rotateCameraCredential(cameraId);
      setIssuedCameraCredential({ cameraId, token: result.token });
      setCameras((prev) => prev.map((c) => (c.id === cameraId ? { ...c, credentialSetAt: result.issuedAt } : c)));
    } catch (err) {
      setCameraError(err instanceof ApiError ? err.message : 'Unable to issue a credential.');
    } finally {
      setBusyCameraId(null);
    }
  }

  async function onViewStream(cameraId: string) {
    setCameraError(null);
    setBusyCameraId(cameraId);
    try {
      const result = await getCameraStream(cameraId);
      setStreamMessage({ cameraId, message: result.message });
    } catch (err) {
      setCameraError(err instanceof ApiError ? err.message : 'Unable to check stream availability.');
    } finally {
      setBusyCameraId(null);
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
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Location</h2>
        {location && (location.latitude !== null || location.deviceLastSeenAt) ? (
          <div className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div>
              <p className="text-sm text-zinc-900 dark:text-zinc-100">
                {location.latitude !== null && location.longitude !== null
                  ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
                  : 'No fix received yet'}
                {location.speedKmh !== null ? ` · ${location.speedKmh.toFixed(0)} km/h` : ''}
              </p>
              <p className="text-xs text-zinc-500">
                Last fix: {location.recordedAt ? new Date(location.recordedAt).toLocaleString() : 'Never'}
                {' · '}Device last seen: {location.deviceLastSeenAt ? new Date(location.deviceLastSeenAt).toLocaleString() : 'Never'}
              </p>
            </div>
            <StatusBadge status={location.freshness} />
          </div>
        ) : (
          <EmptyState title="No telemetry yet" description="This bus has not reported a GPS position." />
        )}
      </div>

      <div className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Devices</h2>
        {devices.length === 0 && <EmptyState title="No devices registered" />}
        {devices.map((d) => (
          <div key={d.id} className="space-y-2 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {d.deviceType.replace('_', ' ')} · {d.externalDeviceId}
                </p>
                <p className="text-xs text-zinc-500">
                  Last seen: {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never'}
                  {d.firmwareVersion ? ` · Firmware ${d.firmwareVersion}` : ''}
                  {d.deviceType === 'GPS_TRACKER'
                    ? ` · Credential: ${d.credentialSetAt ? `issued ${new Date(d.credentialSetAt).toLocaleDateString()}` : 'not issued'}`
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={d.status} />
                {canManage && d.deviceType === 'GPS_TRACKER' && d.status !== 'INACTIVE' && (
                  <Button variant="secondary" onClick={() => onRotateCredential(d.id)} disabled={busyDeviceId === d.id}>
                    {d.credentialSetAt ? 'Rotate credential' : 'Issue credential'}
                  </Button>
                )}
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
            {issuedCredential?.deviceId === d.id && (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-medium">Copy this credential now — it will not be shown again:</p>
                <code className="mt-1 block break-all font-mono">{issuedCredential.token}</code>
              </div>
            )}
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

      {canReadCameras && (
        <div className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Cameras</h2>
          {cameras.length === 0 && <EmptyState title="No cameras on this bus" />}
          {cameras.map((c) => (
            <div key={c.id} className="space-y-2 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {c.name} · {c.position === 'CUSTOM' ? c.customPositionLabel : c.position}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {c.cameraCode} · Serial {c.serialNumber}
                    {c.firmwareVersion ? ` · Firmware ${c.firmwareVersion}` : ''}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Last seen: {c.lastSeenAt ? new Date(c.lastSeenAt).toLocaleString() : 'Never'}
                    {' · '}Credential: {c.credentialSetAt ? `issued ${new Date(c.credentialSetAt).toLocaleDateString()}` : 'not issued'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={c.connectivity} />
                  <StatusBadge status={c.status} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => onViewStream(c.id)} disabled={busyCameraId === c.id}>
                  View stream
                </Button>
                {canManageCameras && c.status !== 'RETIRED' && (
                  <Button variant="secondary" onClick={() => onRotateCameraCredential(c.id)} disabled={busyCameraId === c.id}>
                    {c.credentialSetAt ? 'Rotate credential' : 'Issue credential'}
                  </Button>
                )}
                {canManageCameras && c.status === 'ACTIVE' && (
                  <Button variant="secondary" onClick={() => onMarkCameraFault(c.id)} disabled={busyCameraId === c.id}>
                    Mark fault
                  </Button>
                )}
                {canManageCameras && c.status !== 'RETIRED' && (
                  <Button variant="danger" onClick={() => setConfirmArchiveCamera(c)} disabled={busyCameraId === c.id}>
                    Retire
                  </Button>
                )}
              </div>
              {streamMessage?.cameraId === c.id && (
                <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {streamMessage.message}
                </p>
              )}
              {issuedCameraCredential?.cameraId === c.id && (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <p className="font-medium">Copy this credential now — it will not be shown again:</p>
                  <code className="mt-1 block break-all font-mono">{issuedCameraCredential.token}</code>
                </div>
              )}
            </div>
          ))}

          {canManageCameras && (
            <form onSubmit={onCreateCamera} className="grid grid-cols-2 gap-2 pt-2">
              <FormField label="Camera code" htmlFor="cameraCode">
                <Input id="cameraCode" required value={cameraCode} onChange={(e) => setCameraCode(e.target.value)} />
              </FormField>
              <FormField label="Name" htmlFor="cameraName">
                <Input id="cameraName" required value={cameraName} onChange={(e) => setCameraName(e.target.value)} />
              </FormField>
              <FormField label="Position" htmlFor="cameraPosition">
                <Select id="cameraPosition" value={cameraPosition} onChange={(e) => setCameraPosition(e.target.value as typeof cameraPosition)}>
                  {/* CUSTOM is excluded here — it requires a customPositionLabel this quick-add form doesn't collect; edit via the API/a future dedicated form if needed. */}
                  {CAMERA_POSITIONS.filter((p) => p !== 'CUSTOM').map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Serial number" htmlFor="cameraSerialNumber">
                <Input id="cameraSerialNumber" required value={cameraSerialNumber} onChange={(e) => setCameraSerialNumber(e.target.value)} />
              </FormField>
              <Button type="submit" loading={creatingCamera} className="col-span-2">
                Add camera
              </Button>
            </form>
          )}
          {cameraError && <p className="text-sm text-red-600 dark:text-red-400">{cameraError}</p>}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmArchiveCamera}
        title="Retire this camera?"
        description="A retired camera is removed from service, its device credential stops working immediately, and this cannot be reversed."
        confirmLabel="Retire"
        danger
        loading={archivingCamera}
        onConfirm={onArchiveCamera}
        onCancel={() => setConfirmArchiveCamera(null)}
      />

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
