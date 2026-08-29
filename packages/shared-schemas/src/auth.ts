import { z } from 'zod';

/**
 * Staff/driver/attendant login. Consumed by apps/api's auth DTO validation pipe
 * and apps/web's login form resolver — see docs/api.md#auth.
 */
export const staffLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;

/**
 * Parent login is a structurally separate flow/audience from staff login
 * (docs/security.md#1-authentication) even though the request shape is
 * currently identical.
 */
export const parentLoginSchema = z.object({
  phone: z.string().min(10).max(15),
  password: z.string().min(1, 'Password is required'),
});
export type ParentLoginInput = z.infer<typeof parentLoginSchema>;

/**
 * Applies to any NEW password (change-password, password-reset-confirm, and
 * future account-creation flows) — not to login, where the stored hash's own
 * length/complexity was whatever policy was in force when it was set.
 * See docs/security.md#6-password-security.
 */
export const newPasswordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((val) => /[A-Za-z]/.test(val), 'Password must contain at least one letter')
  .refine((val) => /[0-9]/.test(val), 'Password must contain at least one number');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: newPasswordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const passwordResetRequestSchema = z.object({
  audience: z.enum(['STAFF', 'PARENT']),
  identifier: z.string().min(1, 'Email or phone is required'),
});
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: newPasswordSchema,
});
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
