import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hash() never returns the plaintext password', async () => {
    const hash = await service.hash('Passw0rd!123');
    expect(hash).not.toBe('Passw0rd!123');
    expect(hash).not.toContain('Passw0rd!123');
  });

  it('produces an argon2id hash (docs/adr/0004-auth-strategy.md)', async () => {
    const hash = await service.hash('Passw0rd!123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verify() returns true for the correct password and false for a wrong one', async () => {
    const hash = await service.hash('correct-horse-battery-staple');
    await expect(service.verify(hash, 'correct-horse-battery-staple')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('verify() returns false (not a throw) for a malformed/foreign hash', async () => {
    await expect(service.verify('not-a-real-hash', 'anything')).resolves.toBe(false);
  });
});
