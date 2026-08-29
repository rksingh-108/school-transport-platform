# ADR 0006: Separate Python AI Service Behind a Provider Interface, Edge-Capable

Status: Accepted
Date: 2026-08-30

## Context
AI safety inference (Phase 3) needs a different runtime (Python ML ecosystem,
potentially GPU/edge hardware) and a different deployment lifecycle (model
versioning, retraining) than the TypeScript monolith. The product requirement
explicitly says AI must be assistive, replaceable, and preferably edge-deployed to
avoid shipping raw video to the cloud.

## Decision
`apps/ai-service` is a separate Python service from day one of Phase 3 planning
(even though it is not built until Phase 3), implementing the
`AIInferenceProvider`/`SafetyEventDetector`/`ModelRegistry` interfaces defined in
[ai-safety.md](../ai-safety.md#4-architecture). The monolith's `ai-events` module
talks to it (or to an on-bus edge instance of it) only through a narrow REST
contract (`POST /internal/ai-events`) — the monolith never embeds a model or
vendor SDK directly.

## Consequences
- No vendor/model lock-in: a school-specific or improved model is a `ModelRegistry`
  entry, not a code change in the monolith.
- Deployment flexibility: the same service code can run centrally (early pilots,
  before edge hardware is finalized) or packaged for an on-bus edge box, without an
  interface change — only the network path differs.
- This is a decision to build the *interface and boundary* now, not the service
  itself — no Python code ships until Phase 3, avoiding speculative implementation
  against hardware that isn't selected yet.
