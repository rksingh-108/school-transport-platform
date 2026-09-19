'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { TripDto, TripStopDto, TripStudentDto, StudentDto, AttendanceEventDto } from '@school-transport/shared-types';
import { ArrowLeft, Check, MapPin, XCircle } from 'lucide-react';
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
import { boardStudent, correctAttendanceEvent, dropOffStudent, getAttendanceHistory, markStudentAbsent } from '@/lib/api/attendance';
import { listBuses } from '@/lib/api/buses';
import { listDrivers } from '@/lib/api/drivers';
import { listAttendants } from '@/lib/api/attendants';
import { listStudents } from '@/lib/api/students';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button, IconButton } from '@/components/ui/button';
import { FormField, Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/cn';

const DIRECTION_LABELS: Record<string, string> = { HOME_TO_SCHOOL: 'Home → School', SCHOOL_TO_HOME: 'School → Home' };
const EDITABLE_STATUSES = new Set(['SCHEDULED', 'READY']);
const TRIP_STEPS = ['SCHEDULED', 'READY', 'IN_PROGRESS', 'COMPLETED'] as const;

function errorMessage(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) return error.status === 404 ? notFoundMessage : error.message;
  return 'Something went wrong.';
}

async function loadAll(id: string) {
  const [trip, stops, manifest] = await Promise.all([getTrip(id), listTripStops(id), listManifest(id)]);
  return { trip, stops, manifest };
}

/** SCHEDULED → READY → IN_PROGRESS → COMPLETED as a stepper; CANCELLED/NO_SHOW get a distinct terminal banner instead of forcing a stepper position. */
function TripStepper({ status }: { status: TripDto['status'] }) {
  if (status === 'CANCELLED' || status === 'NO_SHOW') {
    return (
      <div className="flex items-center gap-2 rounded-(--radius-md) border border-(--color-danger-border) bg-(--color-danger-bg) px-4 py-3 text-sm text-(--color-danger-text)">
        <XCircle className="h-4 w-4 shrink-0" />
        {status === 'CANCELLED' ? 'This trip was cancelled.' : 'This trip was marked as no-show.'}
      </div>
    );
  }

  const currentIndex = TRIP_STEPS.indexOf(status as (typeof TRIP_STEPS)[number]);

  return (
    <div className="flex items-center">
      {TRIP_STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <div key={step} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  done && 'bg-(--color-success-solid) text-white',
                  active && 'bg-(--color-brand) text-white',
                  !done && !active && 'bg-(--color-neutral-bg) text-(--color-text-faint)',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn('text-xs font-medium whitespace-nowrap', active ? 'text-(--color-text)' : 'text-(--color-text-faint)')}>
                {step.replaceAll('_', ' ')}
              </span>
            </div>
            {i < TRIP_STEPS.length - 1 && (
              <div className={cn('mx-3 h-0.5 flex-1', done ? 'bg-(--color-success-solid)' : 'bg-(--color-neutral-bg)')} />
            )}
          </div>
        );
      })}
    </div>
  );
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
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('trips.manage');
  const canOperate = canManage || (principal?.type === 'STAFF' && principal.roles.includes('DRIVER'));
  const canRecordAttendance = principal?.type === 'STAFF' && principal.permissions.includes('attendance.manage');

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
      toast.success('Trip saved');
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

  const overviewTab = (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Assignment" />
        <CardBody className="space-y-4">
          {!editable || !canManage || !assignOptions ? (
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-(--color-text-faint)">Bus</dt>
                <dd className="text-(--color-text)">{current.busFleetNumber ?? current.busRegistrationNumber}</dd>
              </div>
              <div>
                <dt className="text-(--color-text-faint)">Driver</dt>
                <dd className="text-(--color-text)">{current.driverName}</dd>
              </div>
              <div>
                <dt className="text-(--color-text-faint)">Attendant</dt>
                <dd className="text-(--color-text)">{current.attendantName ?? '—'}</dd>
              </div>
              {current.notes && (
                <div>
                  <dt className="text-(--color-text-faint)">Notes</dt>
                  <dd className="text-(--color-text)">{current.notes}</dd>
                </div>
              )}
              {current.cancellationReason && (
                <div className="sm:col-span-2">
                  <dt className="text-(--color-text-faint)">Reason</dt>
                  <dd className="text-(--color-text)">{current.cancellationReason}</dd>
                </div>
              )}
            </dl>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                <p className="text-xs text-(--color-warning-text)">Saving a change here will move this trip back to Scheduled.</p>
              )}
              <Button onClick={onSave} loading={saving}>
                Save changes
              </Button>
            </>
          )}

          {actionError && <p className="text-sm text-(--color-danger-text)">{actionError}</p>}

          <div className="flex flex-wrap gap-2 border-t border-(--color-border) pt-4">
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
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Stops (${stops.length})`} description="A fixed snapshot taken when this trip was created — editing the route afterward never changes it." />
        <CardBody className="space-y-2">
          {stops.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-(--radius-sm) border border-(--color-border) px-3 py-2 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--color-brand-bg) text-xs font-semibold text-(--color-brand-text)">
                {s.sequenceNo}
              </span>
              <div>
                <p className="font-medium text-(--color-text)">{s.name}</p>
                <p className="flex items-center gap-1 text-xs text-(--color-text-faint)">
                  <MapPin className="h-3 w-3" />
                  {s.address ?? `${s.latitude}, ${s.longitude}`} · {s.mode} · +{s.expectedOffsetMinutes}min
                </p>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );

  const manifestTab = (
    <ManifestSection
      tripId={current.id}
      stops={stops}
      manifest={manifest}
      onManifestChange={setManifest}
      canManage={canManage}
      canRecordAttendance={canRecordAttendance}
    />
  );

  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview', content: overviewTab },
    { id: 'manifest', label: `Manifest & Attendance (${manifest.length})`, content: manifestTab },
  ];

  return (
    <div className="max-w-2xl">
      <PageHeader
        breadcrumbs={[{ label: 'Trips', href: '/dashboard/trips' }, { label: current.routeName }]}
        title={`${current.routeCode ? `${current.routeCode} — ` : ''}${current.routeName}`}
        description={`${DIRECTION_LABELS[current.direction] ?? current.direction} · ${current.serviceDate} · ${current.scheduledStartTime}–${current.scheduledEndTime}`}
        actions={<IconButton icon={ArrowLeft} label="Back" variant="secondary" onClick={() => router.back()} />}
      />

      <div className="mb-6">
        <TripStepper status={current.status} />
      </div>

      <Tabs items={tabs} />

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
  canRecordAttendance,
}: {
  tripId: string;
  stops: TripStopDto[];
  manifest: TripStudentDto[];
  onManifestChange: (m: TripStudentDto[]) => void;
  canManage: boolean;
  canRecordAttendance: boolean;
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
    <div className="space-y-3">
      {manifest.length === 0 && <EmptyState title="No students on this manifest yet" />}

      {manifest.map((entry) => (
        <Card key={entry.id}>
          <CardBody className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-(--color-text)">{entry.studentFullName}</p>
                <p className="text-xs text-(--color-text-faint)">Admission #{entry.studentAdmissionNumber}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-(--color-text-faint)">{entry.membershipStatus}</span>
                {canManage && (
                  <Button variant="danger" size="sm" onClick={() => setConfirmRemoveId(entry.id)} disabled={busyEntryId === entry.id}>
                    Remove
                  </Button>
                )}
              </div>
            </div>

            <AttendanceControls
              tripId={tripId}
              entry={entry}
              canRecordAttendance={canRecordAttendance}
              onUpdated={(updated) => onManifestChange(manifest.map((m) => (m.id === updated.id ? updated : m)))}
            />

            {canManage && (
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          </CardBody>
        </Card>
      ))}

      {manifestError && <p className="text-sm text-(--color-danger-text)">{manifestError}</p>}

      {canManage && (
        <Card>
          <CardBody>
            <form onSubmit={onAdd} className="space-y-3">
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
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-raised) shadow-(--shadow-md)">
                    {studentResults.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSelectedStudent(s);
                          setStudentResults([]);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-(--color-surface-sunken)"
                      >
                        {s.fullName} · #{s.admissionNumber}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          </CardBody>
        </Card>
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

const CORRECTABLE_TYPES: { value: 'BOARDING_CONFIRMED' | 'DROPPED_OFF' | 'MARKED_ABSENT'; label: string }[] = [
  { value: 'BOARDING_CONFIRMED', label: 'Boarded' },
  { value: 'DROPPED_OFF', label: 'Dropped off' },
  { value: 'MARKED_ABSENT', label: 'Absent' },
];

/**
 * Boarding/drop-off/absent actions and the correction/history trail for one
 * manifest entry. Actions are hidden entirely without `attendance.manage`
 * (UX only — the backend is the real authority, including the "own trip
 * only" scoping for BUS_ATTENDANT that this component has no way to
 * predict client-side).
 */
function AttendanceControls({
  tripId,
  entry,
  canRecordAttendance,
  onUpdated,
}: {
  tripId: string;
  entry: TripStudentDto;
  canRecordAttendance: boolean;
  onUpdated: (updated: TripStudentDto) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AttendanceEventDto[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [correctingEventId, setCorrectingEventId] = useState<string | null>(null);
  const [correctType, setCorrectType] = useState<'BOARDING_CONFIRMED' | 'DROPPED_OFF' | 'MARKED_ABSENT'>('BOARDING_CONFIRMED');
  const [correctNotes, setCorrectNotes] = useState('');
  const [correcting, setCorrecting] = useState(false);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      setHistory(await getAttendanceHistory(tripId, entry.id));
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next) await loadHistory();
  }

  async function run(fn: () => Promise<TripStudentDto>) {
    setError(null);
    setBusy(true);
    try {
      const updated = await fn();
      onUpdated(updated);
      if (showHistory) await loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to record attendance.');
    } finally {
      setBusy(false);
    }
  }

  async function onCorrect(eventId: string) {
    setError(null);
    setCorrecting(true);
    try {
      const updated = await correctAttendanceEvent(tripId, entry.id, eventId, { eventType: correctType, notes: correctNotes || undefined });
      onUpdated(updated);
      setCorrectingEventId(null);
      setCorrectNotes('');
      await loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to correct this event.');
    } finally {
      setCorrecting(false);
    }
  }

  return (
    <div className="mt-2 border-t border-(--color-border) pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={entry.currentStatus} />
        {entry.boardedAt && <span className="text-xs text-(--color-text-faint)">Boarded {new Date(entry.boardedAt).toLocaleTimeString()}</span>}
        {entry.droppedOffAt && <span className="text-xs text-(--color-text-faint)">Dropped off {new Date(entry.droppedOffAt).toLocaleTimeString()}</span>}
        {canRecordAttendance && entry.currentStatus === 'EXPECTED' && (
          <>
            <Button variant="secondary" size="sm" onClick={() => run(() => boardStudent(tripId, entry.id))} disabled={busy}>
              Board
            </Button>
            <Button variant="secondary" size="sm" onClick={() => run(() => markStudentAbsent(tripId, entry.id))} disabled={busy}>
              Mark absent
            </Button>
          </>
        )}
        {canRecordAttendance && entry.currentStatus === 'BOARDED' && (
          <Button variant="secondary" size="sm" onClick={() => run(() => dropOffStudent(tripId, entry.id))} disabled={busy}>
            Drop off
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={toggleHistory}>
          {showHistory ? 'Hide history' : 'History'}
        </Button>
      </div>

      {error && <p className="mt-1 text-sm text-(--color-danger-text)">{error}</p>}

      {showHistory && (
        <div className="mt-2 space-y-2 rounded-(--radius-sm) bg-(--color-surface-sunken) p-2 text-xs">
          {historyLoading && <p className="text-(--color-text-faint)">Loading…</p>}
          {!historyLoading && history?.length === 0 && <p className="text-(--color-text-faint)">No attendance events yet.</p>}
          {history?.map((ev) => (
            <div key={ev.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-(--color-text-muted)">
                  {new Date(ev.occurredAt).toLocaleString()} — {ev.eventType}
                  {ev.tripStopName ? ` — ${ev.tripStopName}` : ''}
                  {ev.recordedByName ? ` — ${ev.recordedByName}` : ''}
                  {ev.correctsEventId ? ' (correction)' : ''}
                </span>
                {canRecordAttendance && (
                  <Button variant="secondary" size="sm" onClick={() => setCorrectingEventId(correctingEventId === ev.id ? null : ev.id)}>
                    Correct
                  </Button>
                )}
              </div>
              {correctingEventId === ev.id && (
                <div className="mt-1 flex flex-wrap items-end gap-2 rounded-(--radius-sm) border border-(--color-border) p-2">
                  <FormField label="Corrected to" htmlFor={`correct-type-${ev.id}`}>
                    <Select id={`correct-type-${ev.id}`} value={correctType} onChange={(e) => setCorrectType(e.target.value as typeof correctType)}>
                      {CORRECTABLE_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Notes" htmlFor={`correct-notes-${ev.id}`}>
                    <Input id={`correct-notes-${ev.id}`} value={correctNotes} onChange={(e) => setCorrectNotes(e.target.value)} />
                  </FormField>
                  <Button onClick={() => onCorrect(ev.id)} loading={correcting}>
                    Save correction
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
