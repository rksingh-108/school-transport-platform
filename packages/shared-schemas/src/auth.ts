import { z } from 'zod';

/**
 * Staff/driver/attendant login. Consumed by apps/api's auth DTO validation pipe
 * and apps/web's login form resolver — see docs/api.md#auth.
 */
export const staffLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;

/**
 * Parent login is a structurally separate flow/audience from staff login
 * (docs/security.md#1-authentication) even though the request shape is
 * currently identical.
 */
export const parentLoginSchema = z.object({
  phone: z.string().min(10).max(15),
  password: z.string().min(8),
});
export type ParentLoginInput = z.infer<typeof parentLoginSchema>;
