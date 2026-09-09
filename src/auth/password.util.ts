import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import * as bcrypt from 'bcryptjs';

const ARGON2_OPTIONS = {
  memorySize: 19_456,
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
};

export function hashPassword(password: string): Promise<string> {
  return argon2id({
    ...ARGON2_OPTIONS,
    password,
    salt: randomBytes(16),
    outputType: 'encoded',
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    if (hash.startsWith('$argon2')) return await argon2Verify({ hash, password });
    if (hash.startsWith('$2')) return await bcrypt.compare(password, hash);
    return false;
  } catch {
    return false;
  }
}

export function passwordHashNeedsUpgrade(hash: string): boolean {
  const match = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.exec(hash);
  if (!match) return true;
  return Number(match[1]) !== 19
    || Number(match[2]) !== ARGON2_OPTIONS.memorySize
    || Number(match[3]) !== ARGON2_OPTIONS.iterations
    || Number(match[4]) !== ARGON2_OPTIONS.parallelism;
}
