/** Browser-only helpers for the double-submit CSRF cookie. No token is persisted. */
export function csrfTokenFromBrowserCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = 'kayyal_csrf=';
  for (const segment of document.cookie.split(';')) {
    const value = segment.trim();
    if (value.startsWith(prefix)) {
      try {
        return decodeURIComponent(value.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Obtains a fresh same-origin CSRF cookie only when the current browser lacks one. */
export async function ensureCsrfToken(): Promise<string | null> {
  const existing = csrfTokenFromBrowserCookie();
  if (existing) return existing;
  try {
    const response = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return null;
    return csrfTokenFromBrowserCookie();
  } catch {
    return null;
  }
}

function apiError(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const error = (payload as { error?: unknown }).error;
  return error && typeof error === 'object' ? error as Record<string, unknown> : null;
}

export function apiErrorMessage(payload: unknown): string | null {
  const message = apiError(payload)?.message;
  return typeof message === 'string' ? message : null;
}

/** Stable error code for a deliberate client recovery state; never infer from text. */
export function apiErrorCode(payload: unknown): string | null {
  const code = apiError(payload)?.code;
  return typeof code === 'string' ? code : null;
}
