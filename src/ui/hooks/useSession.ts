'use client';

import { useEffect, useState } from 'react';

import {
  isLocalLogoutLocked,
  retryPendingServerRevocation,
  subscribeLocalLogoutLock,
} from '../localLogoutLock';

export type WebRole = 'owner' | 'operator';
export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'authenticated'; readonly role: WebRole; readonly scope: string }
  | { readonly status: 'unavailable' };

/**
 * Validates the session through the server on every protected screen. The browser
 * never derives a role from a cookie or local state. A cross-tab local logout
 * lock (set after the user chose to sign out) withholds all local data and moves
 * to /login — while honestly noting that server revocation may still be pending.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    // Locked device: never render yard data until an explicit new login. Owed
    // revocation is retried best-effort whenever we land here with a network.
    if (isLocalLogoutLocked()) {
      void retryPendingServerRevocation();
      window.location.replace('/login');
      return;
    }
    const unsubscribe = subscribeLocalLogoutLock((locked) => {
      if (locked) {
        void retryPendingServerRevocation();
        window.location.replace('/login');
      }
    });
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
        const payload = await response.json() as { data?: { role?: unknown; scope?: unknown } };
        const role = payload.data?.role;
        const scope = payload.data?.scope;
        if ((role === 'owner' || role === 'operator') && typeof scope === 'string' && /^[0-9a-f]{24}$/.test(scope)) {
          setState({ status: 'authenticated', role, scope });
          return;
        }
        setState({ status: 'unavailable' });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'unavailable' });
      });
    return () => { unsubscribe(); controller.abort(); };
  }, []);

  return state;
}
