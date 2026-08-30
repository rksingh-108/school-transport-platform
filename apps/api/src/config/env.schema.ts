import { z } from 'zod';

/**
 * `z.coerce.boolean()` uses JS's `Boolean(value)` coercion, so the *string*
 * "false" (as every env var is) becomes `true` — any non-empty string does.
 * This parses "true"/"false" (case-insensitively) explicitly instead.
 */
const booleanFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((val) => (val === undefined ? defaultValue : val.toLowerCase() === 'true'));

/**
 * Validates the process environment once at startup. NestJS's ConfigModule
 * calls this via its `validate` option — an invalid environment fails fast at
 * boot rather than surfacing as a confusing runtime error later. See
 * docs/architecture.md#3-cross-cutting-concerns.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Restricted, RLS-subject connection — see docs/database.md#5-row-level-security
  // and docs/adr/0002-multi-tenancy-strategy.md. The API never connects with the
  // privileged DATABASE_URL used by Prisma migrations/seed.
  API_DATABASE_URL: z.string().min(1, 'API_DATABASE_URL is required'),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  STORAGE_ENDPOINT: z.string().min(1),
  STORAGE_PORT: z.coerce.number().int().positive(),
  STORAGE_USE_SSL: booleanFromEnv(false),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),

  // Authentication — see docs/security.md#1-authentication and
  // docs/adr/0004-auth-strategy.md. Distinct signing secrets per audience so a
  // compromised staff secret cannot forge parent tokens (or vice versa) — a
  // structural boundary, not just an `aud` claim check.
  JWT_STAFF_SECRET: z.string().min(32, 'JWT_STAFF_SECRET must be at least 32 characters'),
  JWT_PARENT_SECRET: z.string().min(32, 'JWT_PARENT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('school-transport-platform'),
  JWT_STAFF_AUDIENCE: z.string().default('school-transport-staff'),
  JWT_PARENT_AUDIENCE: z.string().default('school-transport-parent'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  // Longer than a password reset — an invited staff member or parent may not
  // check their invite for a few days, unlike a deliberate reset request.
  INVITATION_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  // Failed-login protection (docs/security.md#1-authentication) — keyed by
  // the raw submitted identifier, not a resolved account, so the lockout
  // behavior itself never reveals whether an account exists.
  FAILED_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  FAILED_LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  return result.data;
}
