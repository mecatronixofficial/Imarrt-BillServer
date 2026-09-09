import * as bcrypt from 'bcryptjs';
import { hashPassword, passwordHashNeedsUpgrade, verifyPassword } from './password.util';

describe('password utilities', () => {
  // Independent fixture generated with Node's native crypto.argon2Sync.
  const existingHash = '$argon2id$v=19$m=19456,t=2,p=1$MDEyMzQ1Njc4OWFiY2RlZg$l5q7yAPYZ3ffH64KSnkpyNlSfFqjiDJxs4AsYBuxTuo';

  it('verifies an existing native Argon2 hash', async () => {
    await expect(verifyPassword(existingHash, 'Existing-password-123!')).resolves.toBe(true);
    await expect(verifyPassword(existingHash, 'wrong')).resolves.toBe(false);
    expect(passwordHashNeedsUpgrade(existingHash)).toBe(false);
  });

  it('uses a fresh salt for each password hash', async () => {
    expect(await hashPassword('same-password')).not.toBe(await hashPassword('same-password'));
  });

  it('rejects malformed hashes and upgrades outdated parameters', async () => {
    for (const hash of ['', '$argon2id$invalid', 'unknown']) {
      await expect(verifyPassword(hash, 'password')).resolves.toBe(false);
      expect(passwordHashNeedsUpgrade(hash)).toBe(true);
    }
    for (const [before, after] of [['v=19', 'v=16'], ['m=19456', 'm=4096'], ['t=2', 't=1'], ['p=1', 'p=2']]) {
      expect(passwordHashNeedsUpgrade(existingHash.replace(before, after))).toBe(true);
    }
  });

  it('creates and verifies Argon2id hashes', async () => {
    const hash = await hashPassword('Strong-password-123!');

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, 'Strong-password-123!')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
    expect(passwordHashNeedsUpgrade(hash)).toBe(false);
  });

  it('accepts legacy bcrypt hashes and marks them for upgrade', async () => {
    const hash = await bcrypt.hash('Legacy-password-123!', 4);

    await expect(verifyPassword(hash, 'Legacy-password-123!')).resolves.toBe(true);
    expect(passwordHashNeedsUpgrade(hash)).toBe(true);
  });
});
