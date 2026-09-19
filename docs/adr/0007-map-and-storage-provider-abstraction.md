# ADR 0007: Map Provider and Object Storage Provider Abstractions

Status: Accepted
Date: 2026-08-30

## Context
Map/geocoding/ETA providers and object storage providers are both classic vendor-
lock-in risks, and the brief explicitly calls out map-provider flexibility
(cost/availability/Indian coverage undecided) and requires private, signed-URL-only
file access regardless of backing provider.

## Decision
- **Map abstraction**: a `MapProvider` interface (`getRouteGeometry`,
  `getEta(origin, destination, mode)`, `reverseGeocode`, `staticMapTile`-equivalent
  for the frontend map component) is defined in `packages/shared-types`; the
  frontend map component consumes it through a thin client wrapper, not a
  provider SDK imported ad hoc in multiple components. No specific provider
  (Google Maps, Mapbox, MapmyIndia) is selected in this document — that is a
  commercial/coverage decision for later, not an architectural one, and switching
  providers means implementing one adapter, not touching feature code.
- **Storage abstraction**: a `StorageProvider` interface
  (`putObject`, `getSignedReadUrl(key, ttl)`, `deleteObject`) backs the `files`
  module. Local dev implementation targets MinIO (S3-compatible); production
  targets any S3-compatible provider. No module calls an SDK directly — everything
  goes through `files` module's service, which is the only thing that knows the
  concrete provider.

## Consequences
- Provider selection for maps and storage can be deferred/changed without a
  feature-code rewrite — this was an explicit product requirement, not just good
  practice.
- Slightly more indirection than calling an SDK directly, accepted as the cost of
  the flexibility required.

## Update (2026-08-31): frontend map visualization added

A tile-based interactive map was added to the Staff Live Tracking page, the
Parent child-detail page, and the Bus Detail GPS tab, rendering the exact same
`BusLocationDto`/transport-location coordinates those pages already fetched
and were authorized to see — no new endpoints, no new data exposure, no RBAC
or tenant-isolation change. This is deliberately a **narrower** capability
than the `MapProvider` interface envisioned above:

- It renders raster tiles + markers for coordinates the page already has. It
  does **not** implement `getRouteGeometry`, `getEta`, or `reverseGeocode` —
  those remain undelivered/deferred, as this ADR originally anticipated.
  Routes and Geofences still show coordinates only (no map), unchanged.
- Provider is still abstracted, just at the tile-URL level rather than a
  backend `MapProvider` interface: `apps/web/src/lib/map-config.ts` reads
  `NEXT_PUBLIC_MAP_TILE_URL_LIGHT` / `_DARK` / `NEXT_PUBLIC_MAP_ATTRIBUTION`
  env vars, defaulting to standard OpenStreetMap tiles (no API key, no
  account — appropriate for this app's realistic traffic; see
  https://operations.osmfoundation.org/policies/tiles/). Pointing at a paid
  provider (Mapbox, MapTiler, Google Maps) for real production scale/SLA is a
  config change, not a code change.
- Implementation: `leaflet` + `react-leaflet`, client-only (`next/dynamic`,
  `ssr: false`) since Leaflet has no SSR support. Dark mode reuses the same
  light OSM tiles with a CSS `invert()`/`hue-rotate()` filter rather than a
  second tile source, since a real dark tile set requires its own paid
  provider too.
