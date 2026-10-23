import { createServerClient, type CookieOptions } from '@supabase/ssr';

import type { AuthContext } from '../auth/context';
import { AuthError } from '../auth/session';
import type { Database } from '../db/types';
import {
  hasSupabaseAuthCookie,
  requestCookies,
  supabasePublicConfiguration,
  verifiedOwnerSubjectFromCookie,
} from './supabase';

interface OwnerLookupRow {
  readonly id: string;
  readonly yard_id: string;
  readonly is_active: boolean;
}

interface SupabaseUserPayload {
  readonly id?: unknown;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Reads a bearer token only; browser-provided user ids are never accepted. */
export function ownerBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

async function mapVerifiedOwnerSubject(db: Database, subject: string): Promise<AuthContext> {
  const result = await db.query<OwnerLookupRow>(
    `SELECT id, yard_id, is_active FROM app.auth_lookup_owner($1::uuid)`,
    [subject],
  );
  const owner = result.rows[0];
  if (!owner || !owner.is_active) {
    throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');
  }
  return { yardId: owner.yard_id, actorId: owner.id, role: 'owner' };
}

/**
 * Verifies an actual bearer token with Supabase Auth, then maps the verified
 * subject through the database's fixed pre-context lookup. No service-role key,
 * custom JWT decoding, or locally invented owner session is involved.
 */
export async function authenticateOwnerBearer(
  db: Database,
  request: Request,
): Promise<AuthContext> {
  const token = ownerBearerToken(request);
  if (!token) throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');

  const { url, publishableKey } = supabasePublicConfiguration();
  let response: Response;
  try {
    response = await fetch(new URL('/auth/v1/user', url), {
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
  } catch {
    throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');
  }
  if (!response.ok) throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');

  let payload: SupabaseUserPayload;
  try {
    payload = await response.json() as SupabaseUserPayload;
  } catch {
    throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');
  }
  if (!isUuid(payload.id)) throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');
  return mapVerifiedOwnerSubject(db, payload.id);
}

/** Maps a Supabase SSR cookie session only after provider-side verification. */
export async function authenticateOwnerCookie(
  db: Database,
  request: Request,
): Promise<AuthContext | null> {
  const subject = await verifiedOwnerSubjectFromCookie(request);
  return subject ? mapVerifiedOwnerSubject(db, subject) : null;
}

export interface ProviderSessionCookie {
  readonly name: string;
  readonly value: string;
  readonly options: CookieOptions;
}

/**
 * Revokes the browser session with Supabase and returns only provider-directed
 * cookie updates. The caller applies those updates to its HTTP response.
 */
export async function signOutOwnerCookie(request: Request): Promise<ProviderSessionCookie[]> {
  const cookies = requestCookies(request);
  if (!hasSupabaseAuthCookie(cookies)) throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');
  const { url, publishableKey } = supabasePublicConfiguration();
  const changedCookies: ProviderSessionCookie[] = [];
  const client = createServerClient(url.toString(), publishableKey, {
    cookies: {
      getAll: () => cookies,
      setAll: (updates) => { changedCookies.push(...updates); },
    },
  });
  const { error } = await client.auth.signOut();
  if (error) throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');
  return changedCookies;
}

/** Revokes an actual Supabase owner bearer session; no local owner session exists to clear. */
export async function signOutOwnerBearer(request: Request): Promise<void> {
  const token = ownerBearerToken(request);
  if (!token) throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');
  const { url, publishableKey } = supabasePublicConfiguration();
  let response: Response;
  try {
    response = await fetch(new URL('/auth/v1/logout', url), {
      method: 'POST',
      headers: { apikey: publishableKey, authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');
  }
  if (!response.ok) throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');
}
