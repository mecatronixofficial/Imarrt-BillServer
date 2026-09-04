import { createHmac, randomBytes, timingSafeEqual, createHash } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function buildTotpUri(secret: string, email: string): string {
  const issuer = process.env.MFA_ISSUER?.trim() || 'iMart Billing';
  const label = encodeURIComponent(`${issuer}:${email}`);
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export function verifyTotp(secret: string, code: string, window = 1): boolean {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;

  const counter = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = createTotp(secret, counter + offset);
    if (timingSafeEqual(Buffer.from(normalized), Buffer.from(expected))) return true;
  }
  return false;
}

export function generateTotpCode(secret: string, timestamp = Date.now()): string {
  return createTotp(secret, Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS));
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const value = randomBytes(6).toString('hex').toUpperCase();
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256')
    .update(code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
    .digest('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createTotp(secret: string, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value =
    (((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)) %
    10 ** TOTP_DIGITS;
  return value.toString().padStart(TOTP_DIGITS, '0');
}

function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of input.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
