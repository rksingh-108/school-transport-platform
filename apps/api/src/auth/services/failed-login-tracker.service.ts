import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import type { Env } from '../../config/env.schema';

/**
 * Per-identifier failed-login protection, distinct from the per-IP rate
 * limiting on the route itself (docs/security.md#1-authentication). Keyed by
 * the RAW SUBMITTED IDENTIFIER (email/phone string), never by a resolved
 * account id — this is deliberate: incrementing only for accounts that
 * exist would let an attacker distinguish "locked out" (account exists) from
 * "never locks" (account doesn't exist), which is exactly the account-
 * enumeration channel docs/security.md prohibits. Hammering a nonexistent
 * identifier locks out identically to hammering a real one.
 */
@Injectable()
export class FailedLoginTrackerService {
  private readonly maxAttempts: number;
  private readonly windowSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.maxAttempts = config.get('FAILED_LOGIN_MAX_ATTEMPTS', { infer: true });
    this.windowSeconds = config.get('FAILED_LOGIN_WINDOW_MINUTES', { infer: true }) * 60;
  }

  private key(audience: 'STAFF' | 'PARENT', identifier: string): string {
    return `auth:failed-login:${audience}:${identifier.trim().toLowerCase()}`;
  }

  async isLocked(audience: 'STAFF' | 'PARENT', identifier: string): Promise<boolean> {
    const count = await this.redis.client.get(this.key(audience, identifier));
    return count !== null && Number(count) >= this.maxAttempts;
  }

  async recordFailure(audience: 'STAFF' | 'PARENT', identifier: string): Promise<void> {
    const key = this.key(audience, identifier);
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, this.windowSeconds);
    }
  }

  async reset(audience: 'STAFF' | 'PARENT', identifier: string): Promise<void> {
    await this.redis.client.del(this.key(audience, identifier));
  }
}
