# ADR 0005: HTTP Ingestion for MVP, MQTT-Ready Adapter Boundary for Phase 2+; Socket.IO + Redis for Realtime Fan-out

Status: Accepted
Date: 2026-08-30

## Context
Bus GPS/camera devices need a way to push telemetry that tolerates intermittent
connectivity and doesn't force the business monolith to speak a device protocol
directly. The dashboard and parent app need low-latency push updates
(location, status changes) to many concurrent clients, and the API must be
horizontally scalable.

## Decision
- **Ingestion**: a thin `apps/ingestion` adapter is the only thing that speaks the
  device-facing protocol. MVP implements plain authenticated HTTPS POST (simplest
  to build/debug/test, sufficient for pilot device volumes). The adapter's
  responsibility ends at validating the device credential and normalizing the
  payload into the same internal telemetry event shape the business `gps` module
  consumes — so swapping in an MQTT broker (Phase 2+, once device vendors/volume
  justify it) changes only the adapter, not the `gps` module or anything
  downstream.
- **Realtime fan-out**: NestJS WebSocket gateway (Socket.IO) with the Redis adapter
  from day one (even at MVP scale), so horizontal scaling of the API doesn't
  require a WebSocket-layer rewrite later — this is a small upfront cost (one
  Redis dependency, already present for caching) for a real future-scaling
  headache avoided.

## Consequences
- Device reconnection/offline handling (buffering, backfill on reconnect) is a
  device-firmware and adapter-level concern documented for future hardware
  integration, not solved generically in MVP with only HTTP POST devices in mind.
- The `gps` module's internal event contract (`TelemetryEvent`) is the real
  stability boundary — it must be designed once, carefully, since both the MVP HTTP
  adapter and the future MQTT adapter normalize into it. See
  [architecture.md](../architecture.md) module table.
- Redis is already justified by session/cache use, so this doesn't add a new
  infrastructure dependency, only a new consumer of an existing one.
