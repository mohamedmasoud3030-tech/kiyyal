'use client';

import { useEffect, useState } from 'react';

export type WebRole = 'owner' | 'operator';
export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'authenticated'; readonly role: WebRole }
  | { readonly status: 'unavailable' };

/**
 * Validates the session through the server on every protected screen. The browser
 * never derives a role from a cookie or local state.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.replace('/login');
          return;
        }
        if (!response.ok) {
          setState({ status: 'unavailable' });
          return;
        }
        const payload = await response.json() as { data?: { role?: unknown } };
        const role = payload.data?.role;
        if (role === 'owner' || role === 'operator') {
          setState({ status: 'authenticated', role });
          return;
        }
        setState({ status: 'unavailable' });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'unavailable' });
      });
    return () => controller.abort();
  }, []);

  return state;
}
