# ADR 0001: Modular Monolith over Microservices for the Core Platform

Status: Accepted
Date: 2026-08-30

## Context
The product brief lists 20+ domains (schools, students, buses, trips, attendance,
GPS, cameras, AI, incidents, notifications, reports, audit...). A naive reading
suggests "one microservice per domain." The brief itself explicitly warns against
this ("Do NOT over-engineer... start with a well-structured modular monolith").

## Decision
The core business application ships as a single NestJS process with strict internal
module boundaries (enforced by lint rules, not just convention — see
[architecture.md](../architecture.md#2-repository-structure-proposed)). Three
concerns are kept as separate processes from day one because they have genuinely
different scaling/language/failure profiles, not because of domain-count alone:
AI inference (Python, GPU-relevant, Phase 3), device telemetry ingestion (different
traffic shape and protocol lifecycle than user HTTP traffic), and object storage
(already naturally a separate system).

## Consequences
- Faster MVP delivery, simpler local dev (one Compose stack, one deploy unit for
  the app), simpler transactions (a trip-start + attendance-init can be one DB
  transaction instead of a distributed saga).
- Requires discipline: module boundary violations are cheap to introduce and easy
  to miss in review without tooling, so `eslint-plugin-boundaries` is a hard
  requirement, not a nice-to-have.
- Extraction path exists: because modules already don't share repositories across
  boundaries, promoting a module (e.g., `gps`, or `ai-events`) to its own service
  later is a network-boundary change, not a data-model untangling exercise.
