import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

import { isSupabaseAuthCookieName } from './src/auth/cookies';

function configuration(): { url: string; key: string } | null {
  const rawUrl = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const key = (
    process.env.SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.SUPABASE_ANON_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();
  if (!rawUrl || !key) return null;
  try {
    const url = new URL(rawUrl);
    const localDevelopment = process.env.NODE_ENV !== 'production'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (url.protocol !== 'https:' && !localDevelopment) return null;
    return { url: url.toString(), key };
  } catch {
    return null;
  }
}

/**
 * Supabase requires cookie refresh in middleware. This middleware deliberately
 * does not decide a yard role; every route still verifies and maps the provider
 * subject through app.users on the server.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const config = configuration();
  const hasSupabaseCookie = request.cookies.getAll().some((cookie) => isSupabaseAuthCookieName(cookie.name));
  if (!config || !hasSupabaseCookie) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const changedCookies = new Map<string, { name: string; value: string; options: Record<string, unknown> }>();
  const client = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          request.cookies.set(cookie.name, cookie.value);
          changedCookies.set(cookie.name, cookie);
        }
        response = NextResponse.next({ request });
        for (const cookie of changedCookies.values()) {
          response.cookies.set(cookie.name, cookie.value, cookie.options);
        }
      },
    },
  });
  // getUser performs provider-side verification and triggers a refresh when it
  // is valid and near expiry. A provider outage must not turn public routes into
  // a middleware 500; protected API boundaries still fail closed.
  try {
    await client.auth.getUser();
  } catch {
    // No authentication decision is made in middleware.
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
