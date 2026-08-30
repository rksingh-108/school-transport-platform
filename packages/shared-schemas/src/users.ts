import { z } from 'zod';
import { ROLE_KEYS } from '@school-transport/shared-types';
import { newPasswordSchema } from './auth';

/** Staff-assignable roles exclude PARENT — that audience is never a `User` row. */
export const STAFF_ROLE_KEYS = ROLE_KEYS.filter((key) => key !== 'PARENT');
const staffRoleKeySchema = z.enum(STAFF_ROLE_KEYS as [string, ...string[]]);

export const inviteStaffSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(200),
  roleKeys: z.array(staffRoleKeySchema).min(1, 'At least one role is required'),
});
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

export const updateStaffSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
});
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

export const assignStaffRolesSchema = z.object({
  roleKeys: z.array(staffRoleKeySchema).min(1, 'At least one role is required'),
});
export type AssignStaffRolesInput = z.infer<typeof assignStaffRolesSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, 'Invitation token is required'),
  password: newPasswordSchema,
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const listStaffQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  status: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED']).optional(),
});
export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>;
