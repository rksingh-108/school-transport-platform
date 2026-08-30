import { z } from 'zod';

/**
 * Deliberately has no `schoolId` field — a student's tenant is fixed at
 * creation from the caller's own authenticated context and can never be
 * changed through this endpoint (docs/security.md's tenant-isolation
 * boundary; a transfer-between-schools workflow, if ever needed, is a
 * separate, explicitly-designed feature, not a side effect of a normal
 * update).
 */
export const createStudentSchema = z.object({
  admissionNumber: z.string().min(1).max(50),
  fullName: z.string().min(1).max(200),
  dateOfBirth: z.string().date().optional(),
  grade: z.string().max(20).optional(),
  section: z.string().max(20).optional(),
});
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = z.object({
  admissionNumber: z.string().min(1).max(50).optional(),
  fullName: z.string().min(1).max(200).optional(),
  dateOfBirth: z.string().date().optional(),
  grade: z.string().max(20).optional(),
  section: z.string().max(20).optional(),
});
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

export const STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'GRADUATED'] as const;

export const listStudentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  grade: z.string().max(20).optional(),
  section: z.string().max(20).optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
});
export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>;
