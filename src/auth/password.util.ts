import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';

const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    if (hash.startsWith('$argon2')) return await argon2.verify(hash, password);
    if (hash.startsWith('$2')) return await bcrypt.compare(password, hash);
    return false;
  } catch {
    return false;
  }
}

export function passwordHashNeedsUpgrade(hash: string): boolean {
  try {
    return !hash.startsWith('$argon2id$') || argon2.needsRehash(hash, ARGON2_OPTIONS);
  } catch {
    return true;
  }
}
