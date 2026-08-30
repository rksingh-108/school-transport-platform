import { z } from 'zod';

/**
 * Routine profile fields only — deliberately has no `status` field. Status/
 * lifecycle changes go through a separate endpoint gated by
 * `platform.schools.manage`, not this one — see
 * docs/adr/0011-school-status-platform-managed.md. A DTO that simply doesn't
 * accept the field is a stronger guarantee than a permission check alone.
 */
export const updateSchoolSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().min(6).max(20).optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  timezone: z.string().min(1).optional(),
});
export type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>;

export const SCHOOL_STATUSES = ['ACTIVE', 'TRIAL', 'SUSPENDED', 'INACTIVE'] as const;

export const updateSchoolStatusSchema = z.object({
  status: z.enum(SCHOOL_STATUSES),
  reason: z.string().max(500).optional(),
});
export type UpdateSchoolStatusInput = z.infer<typeof updateSchoolStatusSchema>;
