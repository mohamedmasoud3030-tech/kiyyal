'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { isSupabaseAuthCookieName } from '../auth/cookies';

export interface OwnerProviderConfiguration {
  readonly url: string;
  readonly key: string;
}

export function ownerProviderConfiguration(): OwnerProviderConfiguration | null {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!rawUrl || !key) return null;
  try {
    const url = new URL(rawUrl);
    const localDevelopment = url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (url.protocol !== 'https:' && !localDevelopment) return null;
    return { url: url.toString(), key };
  } catch {
    return null;
  }
}

export function ownerProviderBrowserClient(): SupabaseClient | null {
  const configuration = ownerProviderConfiguration();
  return configuration ? createBrowserClient(configuration.url, configuration.key) : null;
}

function browserHasSupabaseAuthCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((segment) => {
    const [name] = segment.trim().split('=', 1);
    return Boolean(name && isSupabaseAuthCookieName(name));
  });
}

/**
 * An explicit operator sign-in is a user switch on a shared device. Remove a
 * possible owner cookie first so a rejected owner cookie cannot shadow it.
 */
export async function clearOwnerBrowserSessionForOperator(): Promise<boolean> {
  const client = ownerProviderBrowserClient();
  if (!client) return !browserHasSupabaseAuthCookie();
  try {
    const { error } = await client.auth.signOut({ scope: 'local' });
    return !error;
  } catch {
    return false;
  }
}
