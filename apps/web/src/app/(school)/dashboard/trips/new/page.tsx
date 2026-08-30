'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createTrip } from '@/lib/api/trips';
import { listRoutes } from '@/lib/api/routes';
import { listBuses } from '@/lib/api/buses';
import { listDrivers } from '@/lib/api/drivers';
import { listAttendants } from '@/lib/api/attendants';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input, Select } from '@/components/ui/field';
import { LoadingState } from '@/components/ui/states';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewTripPage() {
  const router = useRouter();

  const [options, setOptions] = useState<{
    routes: { id: string; name: string; code: string | null }[];
    buses: { id: string; registrationNumber: string; fleetNumber: string | null }[];
    drivers: { id: string; fullName: string }[];
    attendants: { id: string; fullName: string }[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [routeId, setRouteId] = useState('');
  const [busId, setBusId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [attendantId, setAttendantId] = useState('');
  const [serviceDate, setServiceDate] = useState(todayIso());
  const [scheduledStartTime, setScheduledStartTime] = useState('07:00');
  const [scheduledEndTime, setScheduledEndTime] = useState('08:00');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      listRoutes({ status: 'ACTIVE', limit: 100 }),
      listBuses({ status: 'ACTIVE', limit: 100 }),
      listDrivers({ status: 'ACTIVE', limit: 100 }),
      listAttendants({ status: 'ACTIVE', limit: 100 }),
    ]).then(
      ([routes, buses, drivers, attendants]) => {
        setOptions({ routes: routes.data, buses: buses.data, drivers: drivers.data, attendants: attendants.data });
        if (routes.data[0]) setRouteId(routes.data[0].id);
        if (buses.data[0]) setBusId(buses.data[0].id);
        if (drivers.data[0]) setDriverId(drivers.data[0].id);
      },
      () => setLoadError('Failed to load routes, buses, drivers, or attendants.'),
    );
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const trip = await createTrip({
        routeId,
        busId,
        driverId,
        attendantId: attendantId || undefined,
        serviceDate,
        scheduledStartTime,
        scheduledEndTime,
        notes: notes || undefined,
      });
      router.replace(`/dashboard/trips/${trip.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create trip.');
    } finally {
      setLoading(false);
    }
  }

  if (loadError) return <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  if (!options) return <LoadingState />;

  return (
    <div className="max-w-lg">
      <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">New trip</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Schedules one execution of a route with a bus, driver, and (optionally) an attendant. You can add students to the manifest after creating it.
      </p>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField label="Route" htmlFor="routeId">
          <Select id="routeId" required value={routeId} onChange={(e) => setRouteId(e.target.value)}>
            <option value="" disabled>
              Select a route
            </option>
            {options.routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code ? `${r.code} — ` : ''}
                {r.name}
              </option>
            ))}
          </Select>
        </FormField>

        <div className="grid grid-cols-3 gap-4">
          <FormField label="Service date" htmlFor="serviceDate">
            <Input id="serviceDate" type="date" required value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
          </FormField>
          <FormField label="Start time" htmlFor="scheduledStartTime">
            <Input id="scheduledStartTime" type="time" required value={scheduledStartTime} onChange={(e) => setScheduledStartTime(e.target.value)} />
          </FormField>
          <FormField label="End time" htmlFor="scheduledEndTime">
            <Input id="scheduledEndTime" type="time" required value={scheduledEndTime} onChange={(e) => setScheduledEndTime(e.target.value)} />
          </FormField>
        </div>

        <FormField label="Bus" htmlFor="busId">
          <Select id="busId" required value={busId} onChange={(e) => setBusId(e.target.value)}>
            <option value="" disabled>
              Select a bus
            </option>
            {options.buses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.fleetNumber ?? b.registrationNumber}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Driver" htmlFor="driverId">
          <Select id="driverId" required value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="" disabled>
              Select a driver
            </option>
            {options.drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Attendant (optional)" htmlFor="attendantId">
          <Select id="attendantId" value={attendantId} onChange={(e) => setAttendantId(e.target.value)}>
            <option value="">No attendant</option>
            {options.attendants.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Notes" htmlFor="notes">
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" loading={loading}>
            Create trip
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
