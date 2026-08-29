/**
 * The internal telemetry event contract described in
 * docs/adr/0005-realtime-and-telemetry-ingestion.md. Both the MVP HTTP ingestion
 * adapter and any future MQTT adapter normalize device payloads into this shape
 * before handing them to the gps module — this interface, not the wire protocol,
 * is the real stability boundary.
 */
export interface TelemetryEvent {
  busDeviceExternalId: string;
  latitude: number;
  longitude: number;
  speedKmh?: number;
  heading?: number;
  ignitionOn?: boolean;
  networkState?: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  deviceTime: string; // ISO 8601
}
