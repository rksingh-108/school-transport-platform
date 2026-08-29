import { ConfigService } from '@nestjs/config';
import { FailedLoginTrackerService } from './failed-login-tracker.service';
import type { Env } from '../../config/env.schema';

function makeFakeRedis() {
  const store = new Map<string, { value: number; expiresAt: number | null }>();
  return {
    client: {
      get: jest.fn(async (key: string) => {
        const entry = store.get(key);
        return entry ? String(entry.value) : null;
      }),
      incr: jest.fn(async (key: string) => {
        const entry = store.get(key) ?? { value: 0, expiresAt: null };
        entry.value += 1;
        store.set(key, entry);
        return entry.value;
      }),
      expire: jest.fn(async () => 1),
      del: jest.fn(async (key: string) => {
        store.delete(key);
        return 1;
      }),
    },
  };
}

describe('FailedLoginTrackerService', () => {
  const config = new ConfigService<Env, true>({
    FAILED_LOGIN_MAX_ATTEMPTS: 3,
    FAILED_LOGIN_WINDOW_MINUTES: 15,
  } as Env);

  it('is not locked before the threshold, locked at/after it', async () => {
    const redis = makeFakeRedis();
    const tracker = new FailedLoginTrackerService(redis as never, config);

    await tracker.recordFailure('STAFF', 'someone@example.com');
    await tracker.recordFailure('STAFF', 'someone@example.com');
    expect(await tracker.isLocked('STAFF', 'someone@example.com')).toBe(false);

    await tracker.recordFailure('STAFF', 'someone@example.com');
    expect(await tracker.isLocked('STAFF', 'someone@example.com')).toBe(true);
  });

  it('treats a nonexistent identifier identically to a real one (no enumeration signal)', async () => {
    const redis = makeFakeRedis();
    const tracker = new FailedLoginTrackerService(redis as never, config);

    for (let i = 0; i < 3; i++) {
      await tracker.recordFailure('STAFF', 'never-existed@example.com');
    }
    expect(await tracker.isLocked('STAFF', 'never-existed@example.com')).toBe(true);
  });

  it('keys are case/whitespace-normalized so the same identifier always maps to one counter', async () => {
    const redis = makeFakeRedis();
    const tracker = new FailedLoginTrackerService(redis as never, config);

    await tracker.recordFailure('STAFF', '  Someone@Example.com  ');
    await tracker.recordFailure('STAFF', 'someone@example.com');
    await tracker.recordFailure('STAFF', 'SOMEONE@EXAMPLE.COM');
    expect(await tracker.isLocked('STAFF', 'someone@example.com')).toBe(true);
  });

  it('reset() clears the counter', async () => {
    const redis = makeFakeRedis();
    const tracker = new FailedLoginTrackerService(redis as never, config);

    await tracker.recordFailure('PARENT', '+91 90000 00001');
    await tracker.recordFailure('PARENT', '+91 90000 00001');
    await tracker.recordFailure('PARENT', '+91 90000 00001');
    expect(await tracker.isLocked('PARENT', '+91 90000 00001')).toBe(true);

    await tracker.reset('PARENT', '+91 90000 00001');
    expect(await tracker.isLocked('PARENT', '+91 90000 00001')).toBe(false);
  });

  it('STAFF and PARENT audiences are tracked independently for the same identifier string', async () => {
    const redis = makeFakeRedis();
    const tracker = new FailedLoginTrackerService(redis as never, config);

    await tracker.recordFailure('STAFF', 'shared@example.com');
    await tracker.recordFailure('STAFF', 'shared@example.com');
    await tracker.recordFailure('STAFF', 'shared@example.com');
    expect(await tracker.isLocked('STAFF', 'shared@example.com')).toBe(true);
    expect(await tracker.isLocked('PARENT', 'shared@example.com')).toBe(false);
  });
});
