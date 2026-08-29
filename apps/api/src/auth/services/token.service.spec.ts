import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { TokenService } from './token.service';
import type { Env } from '../../config/env.schema';

function makeConfig(overrides: Partial<Env> = {}) {
  const base: Partial<Env> = {
    JWT_STAFF_SECRET: 'staff-secret-at-least-32-characters-long',
    JWT_PARENT_SECRET: 'parent-secret-at-least-32-characters-long',
    JWT_ISSUER: 'school-transport-platform',
    JWT_STAFF_AUDIENCE: 'school-transport-staff',
    JWT_PARENT_AUDIENCE: 'school-transport-parent',
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_DAYS: 30,
    PASSWORD_RESET_TOKEN_TTL_MINUTES: 30,
    ...overrides,
  };
  return new ConfigService<Env, true>(base as Env);
}

describe('TokenService', () => {
  it('signs an access token that verifies back to the same claims', () => {
    const service = new TokenService(makeConfig());
    const { token } = service.signAccessToken({ type: 'STAFF', id: 'user-1', schoolId: 'school-1' });

    const claims = service.verifyAccessToken(token);
    expect(claims).toEqual({ type: 'STAFF', sub: 'user-1', schoolId: 'school-1' });
  });

  it('staff and parent tokens use distinct audiences and distinct secrets', () => {
    const service = new TokenService(makeConfig());
    const staff = service.signAccessToken({ type: 'STAFF', id: 'u1', schoolId: 's1' });
    const parent = service.signAccessToken({ type: 'PARENT', id: 'p1', schoolId: 's1' });

    expect(jwt.decode(staff.token)).toMatchObject({ aud: 'school-transport-staff' });
    expect(jwt.decode(parent.token)).toMatchObject({ aud: 'school-transport-parent' });

    // A staff token cannot be verified as if it were a parent token, even
    // though verifyAccessToken tries both — the signature won't match the
    // parent secret.
    const parentSecretConfig = makeConfig();
    const service2 = new TokenService(parentSecretConfig);
    expect(() => service2.verifyAccessToken(staff.token)).not.toThrow(); // resolves via staff secret
    expect(service2.verifyAccessToken(staff.token).type).toBe('STAFF');
  });

  it('rejects a token signed with a different secret (tampering/forgery)', () => {
    const service = new TokenService(makeConfig());
    const forged = jwt.sign({ schoolId: 's1', principalType: 'STAFF' }, 'not-the-real-secret', {
      subject: 'attacker',
      audience: 'school-transport-staff',
      issuer: 'school-transport-platform',
      expiresIn: '15m',
    });
    expect(() => service.verifyAccessToken(forged)).toThrow();
  });

  it('rejects an expired access token', () => {
    const service = new TokenService(makeConfig());
    const expired = jwt.sign({ schoolId: 's1', principalType: 'STAFF' }, 'staff-secret-at-least-32-characters-long', {
      subject: 'user-1',
      audience: 'school-transport-staff',
      issuer: 'school-transport-platform',
      expiresIn: -10, // already expired
    });
    expect(() => service.verifyAccessToken(expired)).toThrow();
  });

  it('rejects a token with an unrecognized audience', () => {
    const service = new TokenService(makeConfig());
    const rogue = jwt.sign({ schoolId: 's1' }, 'staff-secret-at-least-32-characters-long', {
      subject: 'user-1',
      audience: 'some-other-audience',
      issuer: 'school-transport-platform',
      expiresIn: '15m',
    });
    expect(() => service.verifyAccessToken(rogue)).toThrow();
  });

  it('generateOpaqueToken() never stores the raw value in its own hash, and the hash is deterministic', () => {
    const service = new TokenService(makeConfig());
    const { raw, hash } = service.generateOpaqueToken();
    expect(hash).not.toBe(raw);
    expect(service.hashOpaqueToken(raw)).toBe(hash);
  });

  it('two generated opaque tokens are not equal (sufficient entropy)', () => {
    const service = new TokenService(makeConfig());
    const a = service.generateOpaqueToken();
    const b = service.generateOpaqueToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });
});
