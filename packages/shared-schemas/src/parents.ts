import { z } from 'zod';

export const createParentSchema = z.object({
  phone: z.string().min(10).max(15),
  fullName: z.string().min(1).max(200),
  email: z.string().email().optional(),
});
export type CreateParentInput = z.infer<typeof createParentSchema>;

export const updateParentSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
});
export type UpdateParentInput = z.infer<typeof updateParentSchema>;

export const linkStudentSchema = z.object({
  studentId: z.string().uuid(),
  relationship: z.string().min(1).max(50).default('GUARDIAN'),
});
export type LinkStudentInput = z.infer<typeof linkStudentSchema>;

export const listParentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});
export type ListParentsQuery = z.infer<typeof listParentsQuerySchema>;
