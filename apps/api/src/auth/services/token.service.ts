import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import type { AuthPrincipalType } from '@prisma/client';
import type { Env } from '../../config/env.schema';

export interface AccessTokenClaims {
  type: AuthPrincipalType;
  sub: string;
  schoolId: string;
}

/**
 * Issues and verifies access tokens (JWT) and generates/hashes opaque
 * refresh and password-reset tokens. See docs/security.md#3-token-architecture
 * and docs/adr/0004-auth-strategy.md.
 *
 * Access tokens carry only `sub` (principal id), `schoolId`, `aud`, `iss`,
 * `exp`, `iat`, `jti` — no roles/permissions (resolved fresh from the
 * database per request by PermissionsGuard, so a revoked role takes effect
 * immediately rather than after the access token expires) and no
 * student/child data of any kind.
 *
 * Refresh and password-reset tokens are opaque, high-entropy random strings.
 * Only their SHA-256 hash is ever persisted — a 256-bit random secret does
 * not need a slow, memory-hard hash the way a human-chosen password does
 * (that's what argon2/PasswordService is for); a fast cryptographic hash is
 * the correct, standard choice here and avoids the plaintext-in-DB risk.
 */
@Injectable()
export class TokenService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  signAccessToken(principal: {
    type: AuthPrincipalType;
    id: string;
    schoolId: string;
  }): { token: string; expiresAt: Date } {
    const ttlSeconds = this.config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
    const { secret, audience } = this.secretAndAudienceFor(principal.type);

    const token = jwt.sign({ schoolId: principal.schoolId, principalType: principal.type }, secret, {
      subject: principal.id,
      audience,
      issuer: this.config.get('JWT_ISSUER', { infer: true }),
      expiresIn: ttlSeconds,
      jwtid: randomBytes(16).toString('hex'),
    });

    return { token, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  /**
   * Verifies signature, audience, issuer, and expiry. The token's `aud`
   * claim is peeked (unverified) only to select which secret to attempt
   * verification with — it is never trusted for anything else, and the
   * subsequent `jwt.verify()` call re-validates it properly against that
   * secret. A forged `aud` claim without the matching secret's signature
   * fails verification exactly like any other tampering would.
   */
  verifyAccessToken(rawToken: string): AccessTokenClaims {
    const staffAudience = this.config.get('JWT_STAFF_AUDIENCE', { infer: true });
    const parentAudience = this.config.get('JWT_PARENT_AUDIENCE', { infer: true });

    const peeked = jwt.decode(rawToken) as { aud?: string } | null;
    let type: AuthPrincipalType;
    let secret: string;
    let audience: string;

    if (peeked?.aud === staffAudience) {
      type = 'STAFF';
      secret = this.config.get('JWT_STAFF_SECRET', { infer: true });
      audience = staffAudience;
    } else if (peeked?.aud === parentAudience) {
      type = 'PARENT';
      secret = this.config.get('JWT_PARENT_SECRET', { infer: true });
      audience = parentAudience;
    } else {
      throw new UnauthorizedException('Invalid access token.');
    }

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(rawToken, secret, {
        audience,
        issuer: this.config.get('JWT_ISSUER', { infer: true }),
      }) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }

    const schoolId = payload['schoolId'];
    if (!payload.sub || typeof schoolId !== 'string') {
      throw new UnauthorizedException('Malformed access token.');
    }

    return { type, sub: payload.sub, schoolId };
  }

  generateOpaqueToken(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: this.hashOpaqueToken(raw) };
  }

  hashOpaqueToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  refreshTokenExpiresAt(): Date {
    const days = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  passwordResetTokenExpiresAt(): Date {
    const minutes = this.config.get('PASSWORD_RESET_TOKEN_TTL_MINUTES', { infer: true });
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  audienceFor(type: AuthPrincipalType): string {
    return this.secretAndAudienceFor(type).audience;
  }

  private secretAndAudienceFor(type: AuthPrincipalType): { secret: string; audience: string } {
    if (type === 'STAFF') {
      return {
        secret: this.config.get('JWT_STAFF_SECRET', { infer: true }),
        audience: this.config.get('JWT_STAFF_AUDIENCE', { infer: true }),
      };
    }
    return {
      secret: this.config.get('JWT_PARENT_SECRET', { infer: true }),
      audience: this.config.get('JWT_PARENT_AUDIENCE', { infer: true }),
    };
  }
}
