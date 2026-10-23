import { createServerClient } from '@supabase/ssr';

import { isSupabaseAuthCookieName } from '../auth/cookies';
import { RuntimeConfigurationError } from './runtimeDb';

export interface SupabasePublicConfiguration {
  readonly url: URL;
  readonly publishableKey: string;
}

export function supabasePublicConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): SupabasePublicConfiguration {
  const rawUrl = (environment.SUPABASE_URL ?? environment.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const publishableKey = (
    environment.SUPABASE_PUBLISHABLE_KEY
    ?? environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? environment.SUPABASE_ANON_KEY
    ?? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();
  if (!rawUrl || !publishableKey) {
    throw new RuntimeConfigurationError('Supabase owner-session configuration is unavailable');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RuntimeConfigurationError('SUPABASE_URL is invalid');
  }
  const localDevelopment = environment.NODE_ENV !== 'production'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new RuntimeConfigurationError('SUPABASE_URL must use HTTPS');
  }
  return { url, publishableKey };
}

export function requestCookies(request: Request): { name: string; value: string }[] {
  const header = request.headers.get('cookie');
  if (!header) return [];
  const cookies: { name: string; value: string }[] = [];
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    try {
      cookies.push({ name, value: decodeURIComponent(part.slice(separator + 1).trim()) });
    } catch {
      // An invalid unrelated browser cookie must not crash authentication.
    }
  }
  return cookies;
}

export function hasSupabaseAuthCookie(cookies: readonly { name: string }[]): boolean {
  return cookies.some((cookie) => isSupabaseAuthCookieName(cookie.name));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Asks the provider for the current cookie session's verified user. Middleware
 * owns cookie refresh; this route-time check never decodes or trusts a JWT itself.
 */
export async function verifiedOwnerSubjectFromCookie(request: Request): Promise<string | null> {
  const cookies = requestCookies(request);
  if (!hasSupabaseAuthCookie(cookies)) return null;
  const configuration = supabasePublicConfiguration();
  const client = createServerClient(configuration.url.toString(), configuration.publishableKey, {
    cookies: { getAll: () => cookies },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !isUuid(data.user?.id)) return null;
  return data.user.id;
}
