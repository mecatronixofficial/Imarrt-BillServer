import * as bcrypt from 'bcryptjs';
import { hashPassword, passwordHashNeedsUpgrade, verifyPassword } from './password.util';

describe('password utilities', () => {
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
