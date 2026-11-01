'use client';

import { useEffect, useState } from 'react';

import {
  isLocalLogoutLocked,
  subscribeLocalLogoutLock,
} from '../localLogoutLock';

export type WebRole = 'owner' | 'operator';
export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'refreshing'; readonly role: WebRole; readonly scope: string }
  | { readonly status: 'authenticated'; readonly role: WebRole; readonly scope: string }
  | { readonly status: 'unavailable' }
  | { readonly status: 'locked' };

let lastVerifiedSession: Extract<SessionState, { readonly status: 'authenticated' }> | null = null;

/**
 * Validates the session through the server on every protected screen. The browser
 * never derives a role from a cookie or local state. A previously verified shell
 * may be reused as a shell while the next no-store probe runs; route data stays
 * unmounted until that fresh probe succeeds, and every page data request still
 * authenticates server-side. This removes the full-shell navigation spinner
 * without turning a client cache into authorization. A cross-tab local logout lock (set
 * after the user chose to sign out) withholds all local data and moves to /login.
 */
export function useSession(): SessionState {
  // Do not read localStorage during render: the server cannot see the durable
  // logout lock, and doing so would create a hydration mismatch. The effect
  // below fences the screen before any protected data request can proceed.
  const [state, setState] = useState<SessionState>(() => lastVerifiedSession
    ? { status: 'refreshing', role: lastVerifiedSession.role, scope: lastVerifiedSession.scope }
    : { status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let locked = false;
    const lockScreen = () => {
      locked = true;
      lastVerifiedSession = null;
      controller.abort();
      setState({ status: 'locked' });
    };
    // Locked device: never render yard data until an explicit new login. Owed
    // revocation is retried best-effort whenever we land here with a network.
    if (isLocalLogoutLocked()) {
      lockScreen();
      return;
    }
    const recheckLock = () => { if (isLocalLogoutLocked()) lockScreen(); };
    window.addEventListener('pageshow', recheckLock);
    window.addEventListener('focus', recheckLock);
    document.addEventListener('visibilitychange', recheckLock);
    const unsubscribe = subscribeLocalLogoutLock((locked) => {
      if (locked) {
        lockScreen();
        return;
      }
      // الإلغاء الصادر بعد «الإنهاء الخادمي المؤكّد» ينقّل تلقائيًا لشاشة الدخول —
      // دونه تجمّد الشاشة على «أكّد الخادم إنهاء الجلسة» بلا نهاية.
      controller.abort();
      window.location.assign('/login');
    });
    void fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (locked || controller.signal.aborted) return;
        if (response.status === 401) {
          lastVerifiedSession = null;
          window.location.replace('/login');
          return;
        }
        if (!response.ok) {
          lastVerifiedSession = null;
          setState({ status: 'unavailable' });
          return;
        }
        const payload = await response.json() as { data?: { role?: unknown; scope?: unknown } };
        if (locked || controller.signal.aborted || isLocalLogoutLocked()) return;
        const role = payload.data?.role;
        const scope = payload.data?.scope;
        if ((role === 'owner' || role === 'operator') && typeof scope === 'string' && /^[0-9a-f]{24}$/.test(scope)) {
          const verified = { status: 'authenticated', role, scope } as const;
          lastVerifiedSession = verified;
          setState(verified);
          return;
        }
        lastVerifiedSession = null;
        setState({ status: 'unavailable' });
      })
      .catch((error: unknown) => {
        if (locked || controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        lastVerifiedSession = null;
        setState({ status: 'unavailable' });
      });
    return () => {
      unsubscribe(); controller.abort();
      window.removeEventListener('pageshow', recheckLock);
      window.removeEventListener('focus', recheckLock);
      document.removeEventListener('visibilitychange', recheckLock);
    };
  }, []);

  return state;
}

