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
