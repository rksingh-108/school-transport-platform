'use client';

import { useEffect, type ReactNode } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MAP_TILE_URL_LIGHT, MAP_TILE_URL_DARK, MAP_ATTRIBUTION, MAP_TILE_SUBDOMAINS } from '@/lib/map-config';
import { useTheme } from '@/lib/theme';

export interface LiveMapMarker {
  id: string;
  latitude: number;
  longitude: number;
  tone: 'success' | 'warning' | 'neutral' | 'brand';
  heading?: number | null;
  popup?: ReactNode;
  label: string;
}

export interface LiveMapPolyline {
  positions: [number, number][];
  color?: string;
  weight?: number;
  dash?: string;
}

export interface LiveMapStop {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  /** Render sequence number inside the stop dot when provided. */
  sequenceNo?: number;
  tone?: 'success' | 'neutral' | 'brand';
}

export interface LiveMapProps {
  markers: LiveMapMarker[];
  polylines?: LiveMapPolyline[];
  stops?: LiveMapStop[];
  selectedMarkerId?: string | null;
  onMarkerClick?: (id: string) => void;
  /** Increment to re-fit the viewport to all markers ("zoom to fleet"). */
  fitSignal?: number;
  heightClassName?: string;
}

const TONE_COLOR: Record<LiveMapMarker['tone'], string> = {
  success: '#12b76a',
  warning: '#f79009',
  neutral: '#667085',
  brand: '#155eef',
};

function busIcon(marker: LiveMapMarker, selected: boolean): L.DivIcon {
  const color = TONE_COLOR[marker.tone];
  const rotation = marker.heading ?? 0;
  const size = selected ? 42 : 34;
  const html = `
    <div style="
      width: ${size}px; height: ${size}px; border-radius: 9999px;
      background: ${color}; border: ${selected ? 3 : 2.5}px solid white;
      box-shadow: ${selected ? `0 0 0 4px ${color}55, 0 2px 8px rgba(0,0,0,0.4)` : '0 2px 6px rgba(0,0,0,0.35)'};
      display: flex; align-items: center; justify-content: center;
      transform: rotate(${rotation}deg);
      transition: all 150ms ease;
    ">
      <svg width="${size - 16}" height="${size - 16}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(${-rotation}deg)">
        <path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/>
        <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/>
        <circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>
      </svg>
    </div>
  `;
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4],
    html,
  });
}

function stopIcon(stop: LiveMapStop): L.DivIcon {
  const color = stop.tone === 'success' ? '#12b76a' : stop.tone === 'brand' ? '#155eef' : '#475467';
  return L.divIcon({
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    tooltipAnchor: [0, -12],
    html: `
      <div style="
        width: 22px; height: 22px; border-radius: 9999px;
        background: ${color}; border: 2px solid white;
        box-shadow: 0 1px 4px rgba(0,0,0,0.35);
        display: flex; align-items: center; justify-content: center;
        color: white; font-size: 10px; font-weight: 700;
      ">${stop.sequenceNo ?? ''}</div>
    `,
  });
}

/** Fits the viewport to all markers on mount/update — single marker gets a sensible fixed zoom instead of a degenerate zero-area bounds. */
function FitToMarkers({ markers, fitSignal }: { markers: LiveMapMarker[]; fitSignal?: number }) {
  const map = useMap();

  useEffect(() => {
    if (markers.length === 0) return;
    if (markers.length === 1) {
      map.setView([markers[0].latitude, markers[0].longitude], 15);
      return;
    }
    const bounds = L.latLngBounds(markers.map((m) => [m.latitude, m.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers.map((m) => `${m.id}:${m.latitude}:${m.longitude}`).join('|'), fitSignal]);

  return null;
}

/** Centers on the selected marker when it changes (but not on every marker re-render). */
function FocusMarker({ markerId, markers }: { markerId: string | null; markers: LiveMapMarker[] }) {
  const map = useMap();
  useEffect(() => {
    if (!markerId) return;
    const marker = markers.find((m) => m.id === markerId);
    if (!marker) return;
    map.setView([marker.latitude, marker.longitude], Math.max(map.getZoom(), 15));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerId]);
  return null;
}

export function LiveMapInner({
  markers,
  polylines = [],
  stops = [],
  selectedMarkerId,
  onMarkerClick,
  fitSignal,
  heightClassName,
}: LiveMapProps) {
  const { theme } = useTheme();
  // Follows the active theme at runtime (class-based), not just on mount.
  const tileUrl = theme === 'dark' ? MAP_TILE_URL_DARK : MAP_TILE_URL_LIGHT;
  const first = markers[0];
  const center: [number, number] = first ? [first.latitude, first.longitude] : [20, 0];

  return (
    <div className={heightClassName}>
      <MapContainer
        center={center}
        zoom={first ? 15 : 2}
        scrollWheelZoom
        className="h-full w-full"
        attributionControl={true}
      >
        <TileLayer url={tileUrl} attribution={MAP_ATTRIBUTION} subdomains={MAP_TILE_SUBDOMAINS} maxZoom={19} />
        {polylines.map((line, i) => (
          <Polyline
            key={i}
            positions={line.positions}
            pathOptions={{
              color: line.color ?? '#155eef',
              weight: line.weight ?? 3,
              opacity: 0.85,
              dashArray: line.dash,
            }}
          />
        ))}
        {stops.map((stop) => (
          <Marker key={stop.id} position={[stop.latitude, stop.longitude]} icon={stopIcon(stop)} alt={stop.label}>
            <Tooltip direction="top" offset={[0, -6]} opacity={1}>
              {stop.label}
            </Tooltip>
          </Marker>
        ))}
        <FitToMarkers markers={markers} fitSignal={fitSignal} />
        <FocusMarker markerId={selectedMarkerId ?? null} markers={markers} />
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={[marker.latitude, marker.longitude]}
            icon={busIcon(marker, marker.id === selectedMarkerId)}
            alt={marker.label}
            eventHandlers={onMarkerClick ? { click: () => onMarkerClick(marker.id) } : undefined}
          >
            {marker.popup && <Popup>{marker.popup}</Popup>}
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}