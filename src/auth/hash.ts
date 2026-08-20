/**
 * Argon2id hashing for operator PINs, and SHA-256 for session token storage.
 * Contract: docs/AUTH_SESSION_CONTRACT.md §2, §3 · ADR-0001
 *
 * The PIN itself is never stored, never logged, never returned.
 */
import { argon2id, argon2Verify } from 'hash-wasm';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** AUTH_SESSION_CONTRACT §2: m=19456 KiB, t=2, p=1 */
export const ARGON2_PARAMS = { memorySize: 19456, iterations: 2, parallelism: 1, hashLength: 32 } as const;

export async function hashPin(pin: string): Promise<string> {
  assertPinShape(pin);
  return argon2id({
    password: pin,
    salt: randomBytes(16),
    ...ARGON2_PARAMS,
    outputType: 'encoded',
  });
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (typeof pin !== 'string' || pin.length === 0) return false;
  try {
    return await argon2Verify({ password: pin, hash });
  } catch {
    return false;
  }
}

export function assertPinShape(pin: string): void {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('pin_must_be_4_to_6_digits');
}

/** 32 bytes of CSPRNG entropy, base64url. The plaintext lives only in the cookie. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only the hash is ever persisted (AUTH-2). */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for any token check done in application code. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
