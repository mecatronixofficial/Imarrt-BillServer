import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const key = process.env.FIELD_ENCRYPTION_KEY;
  if (!key || key.length < 64) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY must be set in .env as a 32-byte hex string (64 hex chars). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(key, 'hex');
}

/**
 * Encrypts a plaintext string (e.g. GSTIN, bank account number) before storing in DB.
 * Returns a single string: iv:authTag:ciphertext (all hex-encoded).
 */
export function encryptField(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a value previously produced by encryptField.
 */
export function decryptField(payload: string): string {
  const [ivHex, authTagHex, dataHex] = payload.split(':');
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error('Invalid encrypted payload format');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function blindIndexField(namespace: string, plaintext: string): string {
  return crypto
    .createHmac('sha256', getKey())
    .update(`${namespace}:${plaintext.trim().toUpperCase()}`)
    .digest('hex');
}
