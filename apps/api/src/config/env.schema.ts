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
  // No default (Phase 1 Step 10 hardening): a silently-applied
  // 'http://localhost:3000' fallback would be wrong in production and
  // wouldn't be caught by the wildcard-only check below — every
  // environment (including CI) must set this explicitly.
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN is required'),

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

  // GPS telemetry / realtime tracking (Phase 1 Step 7) — see
  // docs/adr/0014-gps-telemetry-and-realtime-tracking.md. Centralized here
  // rather than hard-coded so freshness/validation behavior can be tuned per
  // deployment without a code change.
  GPS_LIVE_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(90),
  GPS_STALE_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(300),
  // A fix further in the future than this (server clock vs. device clock)
  // is rejected outright rather than silently accepted or clamped — a
  // future timestamp usually means a misconfigured device clock, not a
  // real position.
  GPS_MAX_FUTURE_SKEW_SECONDS: z.coerce.number().int().positive().default(120),
  // A fix older than this is rejected as "obviously impossible" telemetry
  // (garbage clock, not a late-arriving buffered point) rather than stored.
  GPS_MAX_PAST_AGE_DAYS: z.coerce.number().int().positive().default(7),
  // Not an active purge job — see docs/database.md and docs/privacy.md.
  // Exact retention is an operational/legal decision, deliberately not
  // invented here; this is the placeholder a future purge job will read.
  GPS_TELEMETRY_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

  // Notifications (Phase 1 Step 9) — see
  // docs/adr/0016-notifications-and-alerts.md. Retry is a bounded,
  // synchronous loop within one delivery attempt (no background job
  // scheduler exists this phase), so these two values are its entire
  // policy.
  NOTIFICATION_MAX_DELIVERY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  NOTIFICATION_RETRY_BACKOFF_MS: z.coerce.number().int().nonnegative().default(200),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Values that are only ever safe in development/CI, never production —
 * lifted straight from `.env.example`/`.github/workflows/ci.yml` so this
 * list can never silently drift from what those files actually contain.
 * Phase 1 Step 10 hardening: `NODE_ENV=production` starting with any of
 * these must fail fast at boot, not silently run insecurely. This is a
 * deliberately narrow, exact-match blocklist (not a broad heuristic like
 * "contains localhost") — a false positive here would block a legitimate
 * production deploy, which is worse than the narrow gap it might miss.
 */
const KNOWN_DEV_ONLY_SECRETS = new Set([
  'dev_only_staff_secret_change_me_to_something_random_and_long',
  'dev_only_parent_secret_change_me_to_something_random_and_long',
  'ci_only_staff_secret_at_least_32_characters_long',
  'ci_only_parent_secret_at_least_32_characters_long',
]);
const KNOWN_DEV_ONLY_STORAGE_CREDENTIALS = new Set(['minioadmin']);

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }

  const env = result.data;
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (env.CORS_ORIGIN === '*') {
      problems.push('CORS_ORIGIN must not be "*" in production (also invalid together with credentialed CORS).');
    }
    if (KNOWN_DEV_ONLY_SECRETS.has(env.JWT_STAFF_SECRET)) {
      problems.push('JWT_STAFF_SECRET is the well-known development/CI placeholder value — set a real secret.');
    }
    if (KNOWN_DEV_ONLY_SECRETS.has(env.JWT_PARENT_SECRET)) {
      problems.push('JWT_PARENT_SECRET is the well-known development/CI placeholder value — set a real secret.');
    }
    if (env.JWT_STAFF_SECRET === env.JWT_PARENT_SECRET) {
      problems.push('JWT_STAFF_SECRET and JWT_PARENT_SECRET must be different (docs/security.md §1).');
    }
    if (KNOWN_DEV_ONLY_STORAGE_CREDENTIALS.has(env.STORAGE_ACCESS_KEY)) {
      problems.push('STORAGE_ACCESS_KEY is the well-known MinIO development default — set a real credential.');
    }
    if (KNOWN_DEV_ONLY_STORAGE_CREDENTIALS.has(env.STORAGE_SECRET_KEY)) {
      problems.push('STORAGE_SECRET_KEY is the well-known MinIO development default — set a real credential.');
    }
    if (problems.length > 0) {
      throw new Error(`Refusing to start with NODE_ENV=production using unsafe configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    }
  }

  return env;
}
