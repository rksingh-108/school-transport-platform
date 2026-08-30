/**
 * Represents "is a computer-vision inference provider configured for this
 * deployment at all" — a status/health abstraction, NOT something that runs
 * inference inside this monolith's request lifecycle (that would violate
 * the "no heavy synchronous frame processing in NestJS" principle — see
 * docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md). All actual
 * inference happens on an edge device outside this process; this monolith
 * only ever receives an already-normalized result. Deliberately mirrors
 * CameraStreamProvider's NotConfigured/Mock shape 1:1 — neither
 * implementation below can return a status implying real inference is
 * wired up.
 */
export interface AiProviderHealth {
  status: 'AI_NOT_CONFIGURED' | 'AI_READY';
  message: string;
}

export interface ComputerVisionProvider {
  getHealth(): AiProviderHealth;
}

/** The default in every environment unless AI_INFERENCE_PROVIDER=MOCK is explicitly set (never allowed in production — see env.schema.ts). */
export class NotConfiguredComputerVisionProvider implements ComputerVisionProvider {
  getHealth(): AiProviderHealth {
    return {
      status: 'AI_NOT_CONFIGURED',
      message: 'No centralized AI inference provider is configured. Authenticated edge devices may still submit pre-computed observations directly.',
    };
  }
}

/**
 * Dev/test only. Exists to exercise the health-status endpoint's plumbing
 * (permission checks, DTO shape, frontend rendering) without any real
 * model/vendor integration — never returns anything a frontend could
 * mistake for a real, running inference pipeline.
 */
export class MockComputerVisionProvider implements ComputerVisionProvider {
  getHealth(): AiProviderHealth {
    return {
      status: 'AI_READY',
      message: 'Mock inference provider active — development/test only, never a real model.',
    };
  }
}

export const COMPUTER_VISION_PROVIDER = Symbol('COMPUTER_VISION_PROVIDER');
