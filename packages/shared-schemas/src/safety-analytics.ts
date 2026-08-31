import { z } from 'zod';
import { SEVERITIES } from './safety-events';
import { AI_DETECTION_TYPES } from './ai-observations';

// A wide-open date range would force an unbounded, expensive aggregation —
// see docs/adr/0022-ai-observation-review-and-safety-analytics.md's
// "performance" decision.
const MAX_RANGE_DAYS = 90;

export const safetyAnalyticsQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    busId: z.string().uuid().optional(),
    detectionType: z.enum(AI_DETECTION_TYPES).optional(),
    severity: z.enum(SEVERITIES).optional(),
  })
  .refine((v) => new Date(v.to).getTime() >= new Date(v.from).getTime(), {
    message: '`to` must not be before `from`.',
    path: ['to'],
  })
  .refine((v) => (new Date(v.to).getTime() - new Date(v.from).getTime()) / (1000 * 60 * 60 * 24) <= MAX_RANGE_DAYS, {
    message: `The date range must not exceed ${MAX_RANGE_DAYS} days.`,
    path: ['to'],
  });
export type SafetyAnalyticsQuery = z.infer<typeof safetyAnalyticsQuerySchema>;
