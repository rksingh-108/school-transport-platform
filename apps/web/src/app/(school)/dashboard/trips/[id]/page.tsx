'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { TripDto, TripStopDto, TripStudentDto, StudentDto } from '@school-transport/shared-types';
import {
  addTripStudent,
  cancelTrip,
  completeTrip,
  getTrip,
  listManifest,
  listTripStops,
  noShowTrip,
  readyTrip,
  removeTripStudent,
  startTrip,
  updateTrip,
  updateTripStudent,
} from '@/lib/api/trips';
import { listBuses } from '@/lib/api/buses';
import { listDrivers } from '@/lib/api/drivers';
import { listAttendants } from '@/lib/api/attendants';
import { listStudents } from '@/lib/api/students';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const DIRECTION_LABELS: Record<string, string> = { HOME_TO_SCHOOL: 'Home → School', SCHOOL_TO_HOME: 'School → Home' };
const EDITABLE_STATUSES = new Set(['SCHEDULED', 'READY']);

function errorMessage(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) return error.status === 404 ? notFoundMessage : error.message;
  return 'Something went wrong.';
}

async function loadAll(id: string) {
  const [trip, stops, manifest] = await Promise.all([getTrip(id), listTripStops(id), listManifest(id)]);
  return { trip, stops, manifest };
}

export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync(() => loadAll(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={errorMessage(error, 'Trip not found.')} onRetry={reload} />;

  return <TripDetailView key={data.trip.id} trip={data.trip} initialStops={data.stops} initialManifest={data.manifest} />;
}

function TripDetailView({
  trip,
  initialStops,
  initialManifest,
}: {
  trip: TripDto;
  initialStops: TripStopDto[];
  initialManifest: TripStudentDto[];
}) {
  const router = useRouter();
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('trips.manage');
  const canOperate = canManage || (principal?.type === 'STAFF' && principal.roles.includes('DRIVER'));

  const [current, setCurrent] = useState(trip);
  const [stops] = useState(initialStops);
  const [manifest, setManifest] = useState(initialManifest);

  const [busId, setBusId] = useState(trip.busId);
  const [driverId, setDriverId] = useState(trip.driverId);
  const [attendantId, setAttendantId] = useState(trip.attendantId ?? '');
  const [serviceDate, setServiceDate] = useState(trip.serviceDate);
  const [scheduledStartTime, setScheduledStartTime] = useState(trip.scheduledStartTime);
  const [scheduledEndTime, setScheduledEndTime] = useState(trip.scheduledEndTime);
  const [notes, setNotes] = useState(trip.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmNoShow, setConfirmNoShow] = useState(false);
  const [reason, setReason] = useState('');

  const [assignOptions, setAssignOptions] = useState<{
    buses: { id: string; registrationNumber: string; fleetNumber: string | null }[];
    drivers: { id: string; fullName: string }[];
    attendants: { id: string; fullName: string }[];
  } | null>(null);

  const editable = EDITABLE_STATUSES.has(current.status);

  useEffect(() => {
    if (!canManage || !editable) return;
    Promise.all([listBuses({ status: 'ACTIVE', limit: 100 }), listDrivers({ status: 'ACTIVE', limit: 100 }), listAttendants({ status: 'ACTIVE', limit: 100 })]).then(
      ([buses, drivers, attendants]) => setAssignOptions({ buses: buses.data, drivers: drivers.data, attendants: attendants.data }),
      () => {},
    );
  }, [canManage, editable]);

  async function onSave() {
    setActionError(null);
    setSaving(true);
    try {
      const updated = await updateTrip(current.id, {
        busId,
        driverId,
        attendantId: attendantId || null,
        serviceDate,
        scheduledStartTime,
        scheduledEndTime,
        notes: notes || undefined,
      });
      setCurrent(updated);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to save changes.');
    } finally {
      setSaving(false);
    }
  }

  async function runAction(fn: () => Promise<TripDto>) {
    setActionError(null);
    setActionBusy(true);
    try {
      const updated = await fn();
      setCurrent(updated);
      // start() bulk-promotes every PLANNED manifest entry to ACTIVE server-side — refetch so the list reflects it immediately rather than on next reload.
      setManifest(await listManifest(updated.id));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to complete this action.');
    } finally {
      setActionBusy(false);
    }
  }

  async function onCancel() {
    setActionBusy(true);
    try {
      const updated = await cancelTrip(current.id, reason);
      setCurrent(updated);
      setConfirmCancel(false);
      setReason('');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to cancel this trip.');
    } finally {
      setActionBusy(false);
    }
  }

  async function onNoShow() {
    setActionBusy(true);
    try {
      const updated = await noShowTrip(current.id, reason);
      setCurrent(updated);
      setConfirmNoShow(false);
      setReason('');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to mark this trip as no-show.');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {current.routeCode ? `${current.routeCode} — ` : ''}
            {current.routeName}
          </h1>
          <p className="text-sm text-zinc-500">
            {DIRECTION_LABELS[current.direction] ?? current.direction} · {current.serviceDate} · {current.scheduledStartTime}–{current.scheduledEndTime}
          </p>
        </div>
        <StatusBadge status={current.status} />
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Assignment</h2>
        {!editable || !canManage || !assignOptions ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-zinc-500">Bus</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">{current.busFleetNumber ?? current.busRegistrationNumber}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Driver</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">{current.driverName}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Attendant</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">{current.attendantName ?? '—'}</dd>
            </div>
            {current.notes && (
              <div>
                <dt className="text-zinc-500">Notes</dt>
                <dd className="text-zinc-900 dark:text-zinc-100">{current.notes}</dd>
              </div>
            )}
            {current.cancellationReason && (
              <div className="col-span-2">
                <dt className="text-zinc-500">Reason</dt>
                <dd className="text-zinc-900 dark:text-zinc-100">{current.cancellationReason}</dd>
              </div>
            )}
          </dl>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Service date" htmlFor="serviceDate">
                <Input id="serviceDate" type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
              </FormField>
              <FormField label="Start time" htmlFor="startTime">
                <Input id="startTime" type="time" value={scheduledStartTime} onChange={(e) => setScheduledStartTime(e.target.value)} />
              </FormField>
              <FormField label="End time" htmlFor="endTime">
                <Input id="endTime" type="time" value={scheduledEndTime} onChange={(e) => setScheduledEndTime(e.target.value)} />
              </FormField>
            </div>
            <FormField label="Bus" htmlFor="busId">
              <Select id="busId" value={busId} onChange={(e) => setBusId(e.target.value)}>
                {assignOptions.buses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.fleetNumber ?? b.registrationNumber}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Driver" htmlFor="driverId">
              <Select id="driverId" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                {assignOptions.drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Attendant" htmlFor="attendantId">
              <Select id="attendantId" value={attendantId} onChange={(e) => setAttendantId(e.target.value)}>
                <option value="">No attendant</option>
                {assignOptions.attendants.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.fullName}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Notes" htmlFor="notes">
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
            {current.status === 'READY' && (
              <p className="text-xs text-amber-600 dark:text-amber-400">Saving a change here will move this trip back to Scheduled.</p>
            )}
            <Button onClick={onSave} loading={saving}>
              Save changes
            </Button>
          </>
        )}

        {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}

        <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <Button variant="secondary" onClick={() => router.back()}>
            Back
          </Button>
          {canManage && current.status === 'SCHEDULED' && (
            <Button onClick={() => runAction(() => readyTrip(current.id))} loading={actionBusy}>
              Mark ready
            </Button>
          )}
          {canOperate && current.status === 'READY' && (
            <Button onClick={() => runAction(() => startTrip(current.id))} loading={actionBusy}>
              Start trip
            </Button>
          )}
          {canOperate && current.status === 'IN_PROGRESS' && (
            <Button onClick={() => runAction(() => completeTrip(current.id))} loading={actionBusy}>
              Complete trip
            </Button>
          )}
          {canManage && (current.status === 'SCHEDULED' || current.status === 'READY') && (
            <Button variant="secondary" onClick={() => setConfirmNoShow(true)}>
              Mark no-show
            </Button>
          )}
          {canManage && (current.status === 'SCHEDULED' || current.status === 'READY' || current.status === 'IN_PROGRESS') && (
            <Button variant="danger" onClick={() => setConfirmCancel(true)}>
              Cancel trip
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Stops ({stops.length})</h2>
        <p className="text-xs text-zinc-500">A fixed snapshot taken when this trip was created — editing the route afterward never changes it.</p>
        {stops.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {s.sequenceNo}
            </span>
            <div>
              <p className="font-medium text-zinc-900 dark:text-zinc-100">{s.name}</p>
              <p className="text-xs text-zinc-500">
                {s.address ?? `${s.latitude}, ${s.longitude}`} · {s.mode} · +{s.expectedOffsetMinutes}min
              </p>
            </div>
          </div>
        ))}
      </div>

      <ManifestSection tripId={current.id} stops={stops} manifest={manifest} onManifestChange={setManifest} canManage={canManage} />

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this trip?"
        description="Provide a reason. This cannot be undone."
        confirmLabel="Cancel trip"
        danger
        loading={actionBusy}
        onConfirm={onCancel}
        onCancel={() => setConfirmCancel(false)}
      >
        <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmNoShow}
        title="Mark this trip as no-show?"
        description="Provide a reason. This cannot be undone."
        confirmLabel="Mark no-show"
        danger
        loading={actionBusy}
        onConfirm={onNoShow}
        onCancel={() => setConfirmNoShow(false)}
      >
        <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}

function ManifestSection({
  tripId,
  stops,
  manifest,
  onManifestChange,
  canManage,
}: {
  tripId: string;
  stops: TripStopDto[];
  manifest: TripStudentDto[];
  onManifestChange: (m: TripStudentDto[]) => void;
  canManage: boolean;
}) {
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState<StudentDto[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentDto | null>(null);
  const [pickupStopId, setPickupStopId] = useState('');
  const [dropoffStopId, setDropoffStopId] = useState('');
  const [adding, setAdding] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  useEffect(() => {
    if (!studentQuery.trim()) return;
    let ignore = false;
    const handle = setTimeout(() => {
      listStudents({ search: studentQuery, limit: 5 }).then(
        (page) => {
          if (!ignore) setStudentResults(page.data);
        },
        () => {
          if (!ignore) setStudentResults([]);
        },
      );
    }, 300);
    return () => {
      ignore = true;
      clearTimeout(handle);
    };
  }, [studentQuery]);

  function onQueryChange(value: string) {
    setStudentQuery(value);
    setSelectedStudent(null);
    if (!value.trim()) setStudentResults([]);
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setManifestError(null);
    if (!selectedStudent) {
      setManifestError('Select a student.');
      return;
    }
    if (!pickupStopId && !dropoffStopId) {
      setManifestError('Select a pickup and/or dropoff stop.');
      return;
    }
    setAdding(true);
    try {
      const entry = await addTripStudent(tripId, {
        studentId: selectedStudent.id,
        pickupTripStopId: pickupStopId || undefined,
        dropoffTripStopId: dropoffStopId || undefined,
      });
      onManifestChange([...manifest, entry]);
      setSelectedStudent(null);
      setStudentQuery('');
      setPickupStopId('');
      setDropoffStopId('');
    } catch (err) {
      setManifestError(err instanceof ApiError ? err.message : 'Unable to add student.');
    } finally {
      setAdding(false);
    }
  }

  async function onChangeStop(entry: TripStudentDto, field: 'pickupTripStopId' | 'dropoffTripStopId', value: string) {
    setManifestError(null);
    setBusyEntryId(entry.id);
    try {
      const updated = await updateTripStudent(tripId, entry.id, { [field]: value || null });
      onManifestChange(manifest.map((m) => (m.id === entry.id ? updated : m)));
    } catch (err) {
      setManifestError(err instanceof ApiError ? err.message : 'Unable to update this entry.');
    } finally {
      setBusyEntryId(null);
    }
  }

  async function onRemove(entryId: string) {
    setBusyEntryId(entryId);
    try {
      await removeTripStudent(tripId, entryId);
      onManifestChange(manifest.filter((m) => m.id !== entryId));
      setConfirmRemoveId(null);
    } catch (err) {
      setManifestError(err instanceof ApiError ? err.message : 'Unable to remove this student.');
    } finally {
      setBusyEntryId(null);
    }
  }

  return (
    <div className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Student manifest ({manifest.length})</h2>

      {manifest.length === 0 && <EmptyState title="No students on this manifest yet" />}

      {manifest.map((entry) => (
        <div key={entry.id} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{entry.studentFullName}</p>
              <p className="text-xs text-zinc-500">Admission #{entry.studentAdmissionNumber}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">{entry.membershipStatus}</span>
              {canManage && (
                <Button variant="danger" onClick={() => setConfirmRemoveId(entry.id)} disabled={busyEntryId === entry.id}>
                  Remove
                </Button>
              )}
            </div>
          </div>
          {canManage && (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <FormField label="Pickup" htmlFor={`pickup-${entry.id}`}>
                <Select
                  id={`pickup-${entry.id}`}
                  value={entry.pickupTripStopId ?? ''}
                  disabled={busyEntryId === entry.id}
                  onChange={(e) => onChangeStop(entry, 'pickupTripStopId', e.target.value)}
                >
                  <option value="">The school</option>
                  {stops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Dropoff" htmlFor={`dropoff-${entry.id}`}>
                <Select
                  id={`dropoff-${entry.id}`}
                  value={entry.dropoffTripStopId ?? ''}
                  disabled={busyEntryId === entry.id}
                  onChange={(e) => onChangeStop(entry, 'dropoffTripStopId', e.target.value)}
                >
                  <option value="">The school</option>
                  {stops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          )}
        </div>
      ))}

      {manifestError && <p className="text-sm text-red-600 dark:text-red-400">{manifestError}</p>}

      {canManage && (
        <form onSubmit={onAdd} className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="relative">
            <FormField label="Student" htmlFor="studentSearch">
              <Input
                id="studentSearch"
                placeholder="Search by name or admission number"
                value={selectedStudent ? selectedStudent.fullName : studentQuery}
                onChange={(e) => onQueryChange(e.target.value)}
              />
            </FormField>
            {!selectedStudent && studentResults.length > 0 && (
              <div className="mt-1 rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                {studentResults.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSelectedStudent(s);
                      setStudentResults([]);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    {s.fullName} · #{s.admissionNumber}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Pickup" htmlFor="newPickup">
              <Select id="newPickup" value={pickupStopId} onChange={(e) => setPickupStopId(e.target.value)}>
                <option value="">The school</option>
                {stops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Dropoff" htmlFor="newDropoff">
              <Select id="newDropoff" value={dropoffStopId} onChange={(e) => setDropoffStopId(e.target.value)}>
                <option value="">The school</option>
                {stops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <Button type="submit" loading={adding}>
            Add student
          </Button>
        </form>
      )}

      <ConfirmDialog
        open={confirmRemoveId !== null}
        title="Remove this student from the manifest?"
        description="This student will no longer be planned for this trip. The record is kept for history."
        confirmLabel="Remove"
        danger
        loading={busyEntryId === confirmRemoveId}
        onConfirm={() => confirmRemoveId && onRemove(confirmRemoveId)}
        onCancel={() => setConfirmRemoveId(null)}
      />
    </div>
  );
}
