'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  BusLocationDto,
  BusLocationUpdatedEvent,
  GpsPointDto,
  TripStopDto,
} from '@school-transport/shared-types';
import {
  Wifi,
  WifiOff,
  Loader2,
  RefreshCw,
  Maximize2,
  Crosshair,
  Bus as BusIcon,
  Navigation,
  Gauge,
  Crosshair as AccuracyIcon,
  Clock,
  Route as RouteIcon,
  MapPin,
} from 'lucide-react';
import { getFleetLocations, getTripTelemetry, simulateGpsTick } from '@/lib/api/gps';
import { listTripStops } from '@/lib/api/trips';
import { useFleetSocket } from '@/lib/realtime/gps-socket';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button, IconButton } from '@/components/ui/button';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { LiveMap, type LiveMapMarker, type LiveMapStop, type LiveMapPolyline } from '@/components/ui/map/live-map';
import { cn } from '@/lib/cn';

const FRESHNESS_TONE: Record<BusLocationDto['freshness'], LiveMapMarker['tone']> = {
  LIVE: 'success',
  STALE: 'warning',
  UNKNOWN: 'neutral',
};

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
  const { principal } = useAuth();
  const canTrips = principal?.type === 'STAFF' && principal.permissions.includes('trips.read');

  const { data, error, loading, reload } = useAsync(() => getFleetLocations(), []);
  const [buses, setBuses] = useState<BusLocationDto[] | null>(null);
  const current = buses ?? data;

  const onLocationUpdate = useCallback(
    (event: BusLocationUpdatedEvent) => {
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
    },
    [data],
  );

  const { status } = useFleetSocket(onLocationUpdate);

  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [fitSignal, setFitSignal] = useState(0);

  // Select the first live bus by default — derived, not set from an effect, so a
  // new bus appearing in the feed never causes a cascading render.
  const defaultBusId = useMemo(() => {
    if (!current || current.length === 0) return null;
    return (current.find((b) => b.freshness === 'LIVE') ?? current[0]).busId;
  }, [current]);
  const activeBusId = selectedBusId ?? defaultBusId;
  const selectedBus = useMemo(() => current?.find((b) => b.busId === activeBusId) ?? null, [current, activeBusId]);

  // Route visualization for the selected bus's trip — real trip stops + driven telemetry.
  const [routeData, setRouteData] = useState<{ stops: TripStopDto[]; telemetry: GpsPointDto[] } | null>(null);
  useEffect(() => {
    const tripId = selectedBus?.tripId;
    let cancelled = false;
    (async () => {
      if (!tripId) {
        if (!cancelled) setRouteData(null);
        return;
      }
      try {
        const [stops, telemetry] = await Promise.all([
          canTrips ? listTripStops(tripId) : Promise.resolve([]),
          getTripTelemetry(tripId, { limit: 300 }),
        ]);
        if (!cancelled) setRouteData({ stops, telemetry });
      } catch {
        if (!cancelled) setRouteData({ stops: [], telemetry: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedBus?.tripId, canTrips]);

  const counts = useMemo(() => {
    const c = { LIVE: 0, STALE: 0, UNKNOWN: 0 };
    for (const b of current ?? []) c[b.freshness] = (c[b.freshness] ?? 0) + 1;
    return c;
  }, [current]);

  const mapMarkers: LiveMapMarker[] = useMemo(
    () =>
      (current ?? [])
        .filter((b): b is BusLocationDto & { latitude: number; longitude: number } => b.latitude !== null && b.longitude !== null)
        .map((b) => ({
          id: b.busId,
          latitude: b.latitude,
          longitude: b.longitude,
          heading: b.heading,
          tone: FRESHNESS_TONE[b.freshness],
          label: b.busRegistrationNumber,
          popup: (
            <div className="min-w-[160px] text-sm">
              <p className="font-semibold text-(--color-text)">
                {b.busRegistrationNumber}
                {b.busFleetNumber && <span className="ml-1 font-normal text-(--color-text-faint)">#{b.busFleetNumber}</span>}
              </p>
              <p className="mt-1 text-xs text-(--color-text-muted)">
                {b.speedKmh !== null ? `${b.speedKmh.toFixed(0)} km/h` : 'Speed unknown'} · {formatRelative(b.recordedAt)}
              </p>
              <Link href={`/dashboard/buses/${b.busId}`} className="mt-1.5 block text-xs font-medium text-(--color-brand-text) hover:underline">
                View bus →
              </Link>
            </div>
          ),
        })),
    [current],
  );

  // Driven path (solid) from real telemetry; planned path (dashed) through the trip's stops.
  const polylines: LiveMapPolyline[] = useMemo(() => {
    const lines: LiveMapPolyline[] = [];
    if (routeData && routeData.telemetry.length > 1) {
      lines.push({
        positions: routeData.telemetry.map((p) => [p.latitude, p.longitude] as [number, number]),
        color: '#155eef',
        weight: 3,
      });
    }
    const orderedStops = routeData?.stops ? [...routeData.stops].sort((a, b) => a.sequenceNo - b.sequenceNo) : [];
    if (orderedStops.length > 1) {
      lines.push({
        positions: orderedStops.map((s) => [s.latitude, s.longitude] as [number, number]),
        color: '#98a2b3',
        weight: 2,
        dash: '6 6',
      });
    }
    return lines;
  }, [routeData]);

  const stopMarkers: LiveMapStop[] = useMemo(() => {
    if (!routeData) return [];
    return [...routeData.stops]
      .sort((a, b) => a.sequenceNo - b.sequenceNo)
      .map((s) => ({
        id: s.id,
        latitude: s.latitude,
        longitude: s.longitude,
        label: `${s.sequenceNo}. ${s.name}`,
        sequenceNo: s.sequenceNo,
        tone: s.mode === 'PICKUP' ? 'success' : s.mode === 'DROPOFF' ? 'brand' : 'neutral',
      }));
  }, [routeData]);

  if (loading) return <LoadingState />;
  if (error || !current) {
    return <ErrorState message={error instanceof ApiError ? error.message : 'Unable to load fleet locations.'} onRetry={reload} />;
  }

  const columns: DataTableColumn<BusLocationDto>[] = [
    {
      key: 'bus',
      header: 'Bus',
      render: (bus) => (
        <Link href={`/dashboard/buses/${bus.busId}`} className="font-medium text-(--color-text) hover:text-(--color-brand-text)">
          {bus.busRegistrationNumber}
          {bus.busFleetNumber && <span className="ml-1 text-xs font-normal text-(--color-text-faint)">#{bus.busFleetNumber}</span>}
        </Link>
      ),
    },
    { key: 'status', header: 'Status', render: (bus) => <StatusBadge status={bus.freshness} dot /> },
    {
      key: 'location',
      header: 'Location',
      render: (bus) => (bus.latitude !== null && bus.longitude !== null ? `${bus.latitude.toFixed(5)}, ${bus.longitude.toFixed(5)}` : 'No location yet'),
      hideOnCard: true,
    },
    { key: 'speed', header: 'Speed', render: (bus) => (bus.speedKmh !== null ? `${bus.speedKmh.toFixed(0)} km/h` : '—') },
    { key: 'updated', header: 'Last update', render: (bus) => formatRelative(bus.recordedAt) },
    {
      key: 'trip',
      header: 'Trip',
      render: (bus) =>
        bus.tripId ? (
          <Link href={`/dashboard/trips/${bus.tripId}`} className="text-(--color-brand-text) hover:underline">
            On trip
          </Link>
        ) : (
          <span className="text-(--color-text-faint)">Not on a trip</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Tracking"
        description="Current bus positions, as reported by GPS devices."
        actions={
          <div className="flex items-center gap-2">
            <ConnectionBadge status={status} />
            <IconButton icon={RefreshCw} label="Refresh fleet" variant="secondary" onClick={reload} />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Live now" value={counts.LIVE} tone="success" />
        <StatCard label="Stale" value={counts.STALE} tone="warning" />
        <StatCard label="Unknown" value={counts.UNKNOWN} tone="neutral" />
      </div>

      {current.length === 0 ? (
        <EmptyState title="No buses to show" description="No buses are currently in your tracking scope." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0" id="live-map">
            <LiveMap
              markers={mapMarkers}
              polylines={polylines}
              stops={stopMarkers}
              selectedMarkerId={activeBusId}
              onMarkerClick={(id) => setSelectedBusId(id)}
              fitSignal={fitSignal}
              heightClassName="h-[380px] sm:h-[480px]"
              controls={
                <>
                  <MapLegend />
                  <div className="pointer-events-auto flex gap-1.5">
                    <IconButton
                      icon={Maximize2}
                      label="Zoom to entire fleet"
                      size="sm"
                      variant="secondary"
                      className="bg-(--color-surface)/90 shadow-(--shadow-sm) backdrop-blur"
                      onClick={() => setFitSignal((t) => t + 1)}
                    />
                    {selectedBus && (
                      <IconButton
                        icon={Crosshair}
                        label="Center on selected bus"
                        size="sm"
                        variant="secondary"
                        className="bg-(--color-surface)/90 shadow-(--shadow-sm) backdrop-blur"
                        onClick={() => setFitSignal((t) => t + 1)}
                      />
                    )}
                  </div>
                </>
              }
            />
          </div>

          <BusDetailPanel
            bus={selectedBus}
            stops={routeData?.stops ?? null}
            telemetryCount={routeData?.telemetry.length ?? 0}
            onCenter={() => setFitSignal((t) => t + 1)}
          />
        </div>
      )}

      {current.length > 0 && (
        <DataTable
          columns={columns}
          rows={current}
          getRowKey={(b) => b.busId}
          rowClassName={(b) => (b.busId === activeBusId ? 'bg-(--color-brand-bg)/50' : undefined)}
          renderActions={(b) => (
            <Button variant="ghost" size="sm" onClick={() => focusBus(b.busId)} className={cn(b.busId === activeBusId && 'text-(--color-brand-text)')}>
              <Crosshair className="h-3.5 w-3.5" /> Focus
            </Button>
          )}
        />
      )}

      {process.env.NODE_ENV !== 'production' && <DevGpsSimulator buses={current} onSent={reload} />}
    </div>
  );

  function focusBus(busId: string) {
    setSelectedBusId(busId);
    if (window.innerWidth < 1024) {
      document.getElementById('live-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

function MapLegend() {
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface)/90 px-3 py-1.5 shadow-(--shadow-sm) backdrop-blur">
      <span className="flex items-center gap-1.5 text-xs text-(--color-text-muted)">
        <span className="h-2 w-2 rounded-full bg-(--color-success-solid)" /> Live
      </span>
      <span className="flex items-center gap-1.5 text-xs text-(--color-text-muted)">
        <span className="h-2 w-2 rounded-full bg-(--color-warning-solid)" /> Stale
      </span>
      <span className="flex items-center gap-1.5 text-xs text-(--color-text-muted)">
        <span className="h-2 w-2 rounded-full bg-(--color-neutral-solid)" /> Unknown
      </span>
    </div>
  );
}

function ConnectionBadge({ status }: { status: string }) {
  const tone = status === 'connected' ? 'success' : status === 'reconnecting' ? 'warning' : 'danger';
  const Icon = status === 'connected' ? Wifi : status === 'reconnecting' ? Loader2 : WifiOff;
  return (
    <Badge tone={tone}>
      <Icon className={status === 'reconnecting' ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
      {CONNECTION_LABEL[status] ?? status}
    </Badge>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-(--radius-md) bg-(--color-surface-sunken) px-3 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-(--color-text-faint)" />
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-(--color-text-faint)">{label}</p>
        <p className="truncate text-sm font-medium text-(--color-text)">{value}</p>
      </div>
    </div>
  );
}

function BusDetailPanel({
  bus,
  stops,
  telemetryCount,
  onCenter,
}: {
  bus: BusLocationDto | null;
  stops: TripStopDto[] | null;
  telemetryCount: number;
  onCenter: () => void;
}) {
  return (
    <Card className="h-fit">
      {!bus ? (
        <CardBody className="py-10 text-center">
          <BusIcon className="mx-auto h-8 w-8 text-(--color-text-faint)" />
          <p className="mt-3 text-sm font-medium text-(--color-text-muted)">Select a bus to inspect</p>
          <p className="mt-1 text-xs text-(--color-text-faint)">Click a marker on the map or a row in the table.</p>
        </CardBody>
      ) : (
        <>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                {bus.busRegistrationNumber}
                {bus.busFleetNumber && <span className="text-xs font-normal text-(--color-text-faint)">#{bus.busFleetNumber}</span>}
              </span>
            }
            actions={
              <div className="flex items-center gap-1.5">
                <StatusBadge status={bus.freshness} dot />
                <IconButton icon={Crosshair} label="Center on bus" size="sm" onClick={onCenter} />
              </div>
            }
          />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Fact icon={Gauge} label="Speed" value={bus.speedKmh !== null ? `${bus.speedKmh.toFixed(0)} km/h` : '—'} />
              <Fact icon={Navigation} label="Heading" value={bus.heading !== null ? `${Math.round(bus.heading)}°` : '—'} />
              <Fact icon={AccuracyIcon} label="Accuracy" value={bus.accuracyM !== null ? `±${bus.accuracyM} m` : '—'} />
              <Fact icon={Clock} label="Last fix" value={formatRelative(bus.recordedAt)} />
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-(--color-text-faint)">Coordinates</dt>
                <dd className="font-mono text-xs text-(--color-text-muted)">
                  {bus.latitude !== null && bus.longitude !== null ? `${bus.latitude.toFixed(5)}, ${bus.longitude.toFixed(5)}` : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-(--color-text-faint)">Device last seen</dt>
                <dd className="text-(--color-text-muted)">{formatRelative(bus.deviceLastSeenAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-(--color-text-faint)">Trip</dt>
                <dd>
                  {bus.tripId ? (
                    <Link href={`/dashboard/trips/${bus.tripId}`} className="font-medium text-(--color-brand-text) hover:underline">
                      On trip →
                    </Link>
                  ) : (
                    <span className="text-(--color-text-faint)">Not on a trip</span>
                  )}
                </dd>
              </div>
            </dl>

            {stops && (
              <div className="border-t border-(--color-border) pt-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">
                  <RouteIcon className="h-3.5 w-3.5" /> Route stops
                  {telemetryCount > 0 && <span className="ml-auto font-normal normal-case text-(--color-text-faint)">{telemetryCount} GPS fixes</span>}
                </p>
                {stops.length === 0 ? (
                  <p className="text-xs text-(--color-text-faint)">No stops recorded for this trip.</p>
                ) : (
                  <ol className="max-h-44 space-y-0 overflow-y-auto">
                    {[...stops]
                      .sort((a, b) => a.sequenceNo - b.sequenceNo)
                      .map((s, i) => (
                        <li key={s.id} className="relative flex items-start gap-3 py-2">
                          {i < stops.length - 1 && <span className="absolute left-[7px] top-6 h-full w-px bg-(--color-border-strong)" />}
                          <span
                            className={cn(
                              'relative z-10 mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ring-2 ring-(--color-surface)',
                              s.mode === 'PICKUP' ? 'bg-(--color-success-solid)' : s.mode === 'DROPOFF' ? 'bg-(--color-brand)' : 'bg-(--color-neutral-solid)',
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-(--color-text)">
                              {s.sequenceNo}. {s.name}
                            </p>
                            {s.address && <p className="truncate text-xs text-(--color-text-faint)">{s.address}</p>}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <StatusBadge status={s.mode} />
                            {s.expectedOffsetMinutes > 0 && (
                              <span className="flex items-center gap-1 text-[11px] text-(--color-text-faint)">
                                <Clock className="h-3 w-3" /> +{s.expectedOffsetMinutes}m
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                  </ol>
                )}
              </div>
            )}

            {bus.tripId && (
              <p className="flex items-center gap-1.5 border-t border-(--color-border) pt-3 text-[11px] text-(--color-text-faint)">
                <MapPin className="h-3 w-3" /> Positions stream live from the bus GPS device.
              </p>
            )}
          </CardBody>
        </>
      )}
    </Card>
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
    <div className="space-y-2 rounded-(--radius-lg) border border-dashed border-(--color-border-strong) p-4">
      <p className="text-sm font-semibold text-(--color-text)">Dev GPS simulator</p>
      <p className="text-xs text-(--color-text-faint)">
        Sends one synthetic fix through the real ingestion path, near the bus&apos;s last known position. Not available in production.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={busId}
          onChange={(e) => setBusId(e.target.value)}
          className="rounded-(--radius-sm) border border-(--color-border-strong) bg-(--color-surface) px-2 py-1.5 text-sm text-(--color-text)"
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
        {message && <span className="text-xs text-(--color-text-faint)">{message}</span>}
      </div>
    </div>
  );
}