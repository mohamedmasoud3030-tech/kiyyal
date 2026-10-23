import { CSRF_COOKIE, OPERATOR_SESSION_COOKIE } from '../auth/cookies';
import type { AuthContext } from '../auth/context';
import { AuthError, validateSession } from '../auth/session';
import type { Database } from '../db/types';
import { authenticateOwnerBearer, authenticateOwnerCookie, ownerBearerToken } from './ownerSession';
import { hasSupabaseAuthCookie, requestCookies } from './supabase';

export { CSRF_COOKIE, OPERATOR_SESSION_COOKIE };

export function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** A failed owner session cannot silently inherit a shared-device operator session. */
export function operatorCookieFallbackAllowed(request: Request): boolean {
  return !hasSupabaseAuthCookie(requestCookies(request));
}

/** Session resolution is server-only and derives every authorization field. */
export async function authenticateRequest(db: Database, request: Request): Promise<AuthContext> {
  // An attempted owner bearer credential must succeed as owner; it is never
  // allowed to silently fall back to a shared-device operator cookie.
  if (request.headers.has('authorization')) {
    return authenticateOwnerBearer(db, request);
  }
  // A verified Supabase cookie takes precedence over a stale shared-device
  // operator cookie so an owner cannot accidentally act as the last operator.
  const owner = await authenticateOwnerCookie(db, request);
  if (owner) return owner;
  // A malformed, expired, or revoked owner cookie is an explicit owner session
  // attempt. It must not inherit the prior shared-device operator identity.
  if (!operatorCookieFallbackAllowed(request)) {
    throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');
  }
  const token = readCookie(request, OPERATOR_SESSION_COOKIE);
  if (!token) throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');
  return validateSession(db, token);
}

export function requestUsesOwnerBearer(request: Request): boolean {
  return ownerBearerToken(request) !== null;
}
