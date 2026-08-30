import { validateEnv } from './env.schema';

/** A minimal, otherwise-valid config — each test overrides just the field(s) under test. */
function baseConfig(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'production',
    API_DATABASE_URL: 'postgresql://app_user:realpassword@db.internal:5432/school_transport',
    REDIS_URL: 'redis://:realpassword@redis.internal:6379',
    STORAGE_ENDPOINT: 's3.internal',
    STORAGE_PORT: '9000',
    STORAGE_ACCESS_KEY: 'a-real-production-access-key',
    STORAGE_SECRET_KEY: 'a-real-production-secret-key',
    STORAGE_BUCKET: 'school-transport-prod',
    JWT_STAFF_SECRET: 'a-real-staff-secret-at-least-32-characters-long',
    JWT_PARENT_SECRET: 'a-real-parent-secret-at-least-32-characters-long',
    CORS_ORIGIN: 'https://app.example.com',
    ...overrides,
  };
}

describe('validateEnv — production-safety hardening (Phase 1 Step 10)', () => {
  it('accepts a fully-configured production environment', () => {
    expect(() => validateEnv(baseConfig())).not.toThrow();
  });

  it('rejects a wildcard CORS_ORIGIN in production', () => {
    expect(() => validateEnv(baseConfig({ CORS_ORIGIN: '*' }))).toThrow(/CORS_ORIGIN/);
  });

  it('rejects the well-known development JWT_STAFF_SECRET placeholder in production', () => {
    expect(() =>
      validateEnv(baseConfig({ JWT_STAFF_SECRET: 'dev_only_staff_secret_change_me_to_something_random_and_long' })),
    ).toThrow(/JWT_STAFF_SECRET/);
  });

  it('rejects the well-known development JWT_PARENT_SECRET placeholder in production', () => {
    expect(() =>
      validateEnv(baseConfig({ JWT_PARENT_SECRET: 'dev_only_parent_secret_change_me_to_something_random_and_long' })),
    ).toThrow(/JWT_PARENT_SECRET/);
  });

  it('rejects identical staff/parent JWT secrets in production', () => {
    const shared = 'a-real-shared-secret-at-least-32-characters-long';
    expect(() => validateEnv(baseConfig({ JWT_STAFF_SECRET: shared, JWT_PARENT_SECRET: shared }))).toThrow(/must be different/);
  });

  it('rejects the well-known MinIO default storage credentials in production', () => {
    expect(() => validateEnv(baseConfig({ STORAGE_ACCESS_KEY: 'minioadmin' }))).toThrow(/STORAGE_ACCESS_KEY/);
    expect(() => validateEnv(baseConfig({ STORAGE_SECRET_KEY: 'minioadmin' }))).toThrow(/STORAGE_SECRET_KEY/);
  });

  it('does not apply any of these production-only checks in development', () => {
    expect(() =>
      validateEnv(
        baseConfig({
          NODE_ENV: 'development',
          CORS_ORIGIN: '*',
          JWT_STAFF_SECRET: 'dev_only_staff_secret_change_me_to_something_random_and_long',
          STORAGE_ACCESS_KEY: 'minioadmin',
        }),
      ),
    ).not.toThrow();
  });
});
