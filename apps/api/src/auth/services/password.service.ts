import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Password hashing/verification. argon2id per
 * docs/adr/0004-auth-strategy.md — memory-hard, OWASP-recommended for new
 * systems. Verification is constant-time by construction (argon2's own
 * verify implementation), so no separate timing-safe comparison is needed
 * here — never compare hashes with `===`.
 */
@Injectable()
export class PasswordService {
  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, { type: argon2.argon2id });
  }

  async verify(hash: string, plainPassword: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainPassword);
    } catch {
      // argon2.verify throws on a malformed/foreign hash rather than
      // returning false — treat that the same as "does not match" rather
      // than letting it surface as an unhandled 500.
      return false;
    }
  }
}
