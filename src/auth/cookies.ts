/** Cookie names are shared by server routes and server page-entry guards only. */
export const OPERATOR_SESSION_COOKIE = 'kayyal_operator_session';
export const CSRF_COOKIE = 'kayyal_csrf';

// @supabase/ssr stores large sessions in numbered auth-token chunks.
const SUPABASE_AUTH_COOKIE = /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/i;

export function isSupabaseAuthCookieName(name: string): boolean {
  return SUPABASE_AUTH_COOKIE.test(name);
}

/** A server page may render its data-free loading boundary for either session type. */
export function hasPotentialWebSessionCookie(cookies: readonly { name: string }[]): boolean {
  return cookies.some((cookie) => cookie.name === OPERATOR_SESSION_COOKIE || isSupabaseAuthCookieName(cookie.name));
}
