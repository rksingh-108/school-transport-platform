import { z } from 'zod';

export const AI_MODEL_TYPES = ['OBJECT_DETECTION', 'POSE_ESTIMATION', 'ACTION_RECOGNITION', 'SMOKE_FIRE_DETECTION'] as const;
export const AI_MODEL_STATUSES = ['ACTIVE', 'INACTIVE', 'DEPRECATED'] as const;

/**
 * Registers a NEW model version — never an update to an existing one. There
 * is no `updateAiModelSchema` for name/version/provider/modelType: once
 * created, those fields are immutable (see
 * docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md's "model
 * version immutability" decision). `status` transitions happen only through
 * dedicated activate/deactivate/deprecate endpoints, not a generic PATCH.
 * Platform-wide — deliberately has no `schoolId` field.
 */
export const createAiModelSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().min(1).max(50),
  provider: z.string().min(1).max(100),
  modelType: z.enum(AI_MODEL_TYPES),
});
export type CreateAiModelInput = z.infer<typeof createAiModelSchema>;

export const listAiModelsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  status: z.enum(AI_MODEL_STATUSES).optional(),
  modelType: z.enum(AI_MODEL_TYPES).optional(),
});
export type ListAiModelsQuery = z.infer<typeof listAiModelsQuerySchema>;
