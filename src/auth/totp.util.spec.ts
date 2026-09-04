import {
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpSecret,
  hashRecoveryCode,
  hashToken,
  verifyTotp,
} from './totp.util';

describe('TOTP and token security utilities', () => {
  it('generates a valid authenticator code for a fresh secret', () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);

    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, '00000A')).toBe(false);
  });

  it('generates unique recovery codes and normalizes them before hashing', () => {
    const codes = generateRecoveryCodes();

    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    expect(hashRecoveryCode(codes[0])).toBe(hashRecoveryCode(codes[0].replace(/-/g, '').toLowerCase()));
  });

  it('hashes refresh tokens without retaining their plaintext', () => {
    const token = 'sensitive-refresh-token';
    const digest = hashToken(token);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(token);
  });
});
