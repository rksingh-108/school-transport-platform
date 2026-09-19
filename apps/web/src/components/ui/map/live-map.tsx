'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { MapPinned } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { LiveMapMarker, LiveMapPolyline, LiveMapStop } from './live-map-inner';

export type { LiveMapMarker, LiveMapPolyline, LiveMapStop };

// Leaflet touches `window`/DOM at import time and has no SSR support, so the
// actual map is loaded client-only. This wrapper is safe to import from any
// page (server or client component tree).
const LiveMapInner = dynamic(() => import('./live-map-inner').then((m) => m.LiveMapInner), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

export interface LiveMapProps {
  markers: LiveMapMarker[];
  polylines?: LiveMapPolyline[];
  stops?: LiveMapStop[];
  selectedMarkerId?: string | null;
  onMarkerClick?: (id: string) => void;
  /** Increment to re-fit the viewport to all markers ("zoom to fleet"). */
  fitSignal?: number;
  heightClassName?: string;
  /** Overlay UI rendered above the map (legend, refresh, zoom controls). */
  controls?: ReactNode;
}

export function LiveMap({
  markers,
  polylines,
  stops,
  selectedMarkerId,
  onMarkerClick,
  fitSignal,
  heightClassName = 'h-80',
  controls,
}: LiveMapProps) {
  if (markers.length === 0) {
    return (
      <div
        className={`relative flex flex-col items-center justify-center gap-2 rounded-(--radius-lg) border border-dashed border-(--color-border-strong) bg-(--color-surface-sunken) text-center ${heightClassName}`}
      >
        <MapPinned className="h-6 w-6 text-(--color-text-faint)" />
        <p className="text-sm text-(--color-text-muted)">No live position to show on the map yet.</p>
        {controls && <div className="absolute inset-x-0 top-0 p-3">{controls}</div>}
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-(--radius-lg) border border-(--color-border) ${heightClassName}`}>
      <LiveMapInner
        markers={markers}
        polylines={polylines}
        stops={stops}
        selectedMarkerId={selectedMarkerId}
        onMarkerClick={onMarkerClick}
        fitSignal={fitSignal}
        heightClassName="h-full w-full"
      />
      {controls && <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">{controls}</div>}
    </div>
  );
}