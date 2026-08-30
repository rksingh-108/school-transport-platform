'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import type { BusLocationDto, BusLocationUpdatedEvent } from '@school-transport/shared-types';
import { getFleetLocations, simulateGpsTick } from '@/lib/api/gps';
import { useFleetSocket } from '@/lib/realtime/gps-socket';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';

const CONNECTION_LABEL: Record<string, string> = {
  connecting: 'Connecting…',
  connected: 'Live connection',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
};

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export default function LiveTrackingPage() {
  const { data, error, loading, reload } = useAsync(() => getFleetLocations(), []);
  const [buses, setBuses] = useState<BusLocationDto[] | null>(null);
  const current = buses ?? data;

  const onLocationUpdate = useCallback((event: BusLocationUpdatedEvent) => {
    setBuses((prev) => {
      const base = prev ?? data;
      if (!base) return prev;
      return base.map((b) =>
        b.busId === event.busId
          ? {
              ...b,
              tripId: event.tripId,
              latitude: event.latitude,
              longitude: event.longitude,
              speedKmh: event.speedKmh,
              heading: event.heading,
              accuracyM: event.accuracyM,
              recordedAt: event.recordedAt,
              receivedAt: event.receivedAt,
              freshness: event.freshness,
            }
          : b,
      );
    });
  }, [data]);

  const { status } = useFleetSocket(onLocationUpdate);

  if (loading) return <LoadingState />;
  if (error || !current) {
    return (
      <ErrorState message={error instanceof ApiError ? error.message : 'Unable to load fleet locations.'} onRetry={reload} />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Live Tracking</h1>
          <p className="text-sm text-zinc-500">Current bus positions, as reported by GPS devices.</p>
        </div>
        <ConnectionBadge status={status} />
      </div>

      {current.length === 0 ? (
        <EmptyState title="No buses to show" description="No buses are currently in your tracking scope." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
              <tr>
                <th className="px-4 py-2">Bus</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Location</th>
                <th className="px-4 py-2">Speed</th>
                <th className="px-4 py-2">Last update</th>
                <th className="px-4 py-2">Trip</th>
              </tr>
            </thead>
            <tbody>
              {current.map((bus) => (
                <tr key={bus.busId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="px-4 py-2">
                    <Link href={`/dashboard/buses/${bus.busId}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                      {bus.busRegistrationNumber}
                    </Link>
                    {bus.busFleetNumber && <span className="ml-1 text-xs text-zinc-500">#{bus.busFleetNumber}</span>}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={bus.freshness} />
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                    {bus.latitude !== null && bus.longitude !== null
                      ? `${bus.latitude.toFixed(5)}, ${bus.longitude.toFixed(5)}`
                      : 'No location yet'}
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                    {bus.speedKmh !== null ? `${bus.speedKmh.toFixed(0)} km/h` : '—'}
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{formatRelative(bus.recordedAt)}</td>
                  <td className="px-4 py-2">
                    {bus.tripId ? (
                      <Link href={`/dashboard/trips/${bus.tripId}`} className="text-zinc-900 hover:underline dark:text-zinc-100">
                        On trip
                      </Link>
                    ) : (
                      <span className="text-zinc-400">Not on a trip</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {process.env.NODE_ENV !== 'production' && <DevGpsSimulator buses={current} onSent={reload} />}
    </div>
  );
}

function ConnectionBadge({ status }: { status: string }) {
  const tone = status === 'connected' ? 'success' : status === 'reconnecting' ? 'warning' : 'danger';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        tone === 'success'
          ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
          : tone === 'warning'
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
            : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {CONNECTION_LABEL[status] ?? status}
    </span>
  );
}

/** Dev/test-only tool — calls the backend GPS simulator, which itself refuses outside development/test regardless of this UI. Never shown in a production build. */
function DevGpsSimulator({ buses, onSent }: { buses: BusLocationDto[]; onSent: () => void }) {
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('buses.manage');
  const [busId, setBusId] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const options = useMemo(() => buses.map((b) => ({ id: b.busId, label: b.busRegistrationNumber })), [buses]);

  if (!canManage) return null;

  async function onSend() {
    if (!busId) return;
    setSending(true);
    setMessage(null);
    try {
      const base = buses.find((b) => b.busId === busId);
      const lat = base?.latitude ?? 12.9716;
      const lng = base?.longitude ?? 77.5946;
      await simulateGpsTick(busId, {
        latitude: lat + (Math.random() - 0.5) * 0.001,
        longitude: lng + (Math.random() - 0.5) * 0.001,
        speedKmh: Math.round(Math.random() * 40),
        heading: Math.round(Math.random() * 360),
        accuracyM: 8,
        recordedAt: new Date().toISOString(),
      });
      setMessage('Sent.');
      onSent();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to send test telemetry.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Dev GPS simulator</p>
      <p className="text-xs text-zinc-500">
        Sends one synthetic fix through the real ingestion path, near the bus&apos;s last known position. Not available in production.
      </p>
      <div className="flex items-center gap-2">
        <select
          value={busId}
          onChange={(e) => setBusId(e.target.value)}
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">Select a bus…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <Button onClick={onSend} loading={sending} disabled={!busId}>
          Send test ping
        </Button>
        {message && <span className="text-xs text-zinc-500">{message}</span>}
      </div>
    </div>
  );
}
