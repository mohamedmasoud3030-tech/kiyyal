/**
 * Cross-tab local logout lock (owner directive 2026-10-27 #1).
 *
 * Signing out is split into two outcomes the UI must never conflate:
 * 1) device data wipe — local, immediate, survives offline;
 * 2) server session revocation — DELETE /api/auth/session, may fail offline.
 *
 * When revocation cannot be confirmed, this lock makes the intent explicit
 * across every tab (localStorage + BroadcastChannel): protected screens stop
 * rendering local data and move to /login, while any tab retries the DELETE
 * once the network returns. The lock never claims the cookie was removed and
 * never substitutes for the server-side revocation — it is cleared only by an
 * explicit successful login.
 */

const LOCK_KEY = 'gz.session.logoutLock.v1';
const RETRY_KEY = 'gz.session.logoutRevocationPending.v1';
const CHANNEL_NAME = 'gz.session.lock';

type LockMessage = { readonly type: 'locked' | 'unlocked'; readonly tabId: string };

/**
 * A BroadcastChannel instance receives messages posted by OTHER instances in
 * the SAME tab too. Without a sender id, the signing-out tab would treat its
 * own lock broadcast as a cross-tab signal and shortcut the honest
 * locked/unconfirmed flow — so every message carries its origin tab id.
 */
const TAB_ID = (() => {
  try { return crypto.randomUUID(); } catch { return `tab-${Math.random().toString(36).slice(2)}`; }
})();

function read(key: string): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1'; }
  catch { return false; }
}

function write(key: string, on: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key);
  } catch { /* storage full / private mode: lock degrades to this tab only */ }
}

function broadcast(message: LockMessage): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(message);
      channel.close();
    }
  } catch { /* jsdom / unsupported env: storage event still covers real tabs */ }
}

/** Device is locked locally because the user chose to sign out. */
export function isLocalLogoutLocked(): boolean { return read(LOCK_KEY); }

/** Server revocation still unconfirmed — a retry is owed on next connectivity. */
export function isLogoutRevocationPending(): boolean { return read(RETRY_KEY); }

export function setLocalLogoutLock(): void {
  write(LOCK_KEY, true);
  broadcast({ type: 'locked', tabId: TAB_ID });
}

/** Explicit successful login lifts the lock for every tab of this device. */
export function clearLocalLogoutLock(): void {
  write(LOCK_KEY, false);
  write(RETRY_KEY, false);
  broadcast({ type: 'unlocked', tabId: TAB_ID });
}

export function markLogoutRevocationPending(pending: boolean): void {
  write(RETRY_KEY, pending);
}

/**
 * Best-effort retry of the pending server revocation. Returns true only when
 * the server actually answered the DELETE — the caller may then state success.
 */
export async function retryPendingServerRevocation(): Promise<boolean> {
  if (!isLogoutRevocationPending()) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const { ensureCsrfToken } = await import('./clientSecurity');
    const csrf = await ensureCsrfToken().catch(() => null);
    if (!csrf) return false;
    const response = await fetch('/api/auth/session', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'x-kayyal-csrf': csrf },
    });
    if (response.ok || response.status === 401) {
      // Revoked, or the session was already gone server-side — either way the
      // pending debt is settled and this is now confirmed, not assumed.
      markLogoutRevocationPending(false);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Notify any tab when the lock flips (storage event — fires across tabs — plus
 * BroadcastChannel for same-instant delivery). Returns an unsubscribe.
 */
export function subscribeLocalLogoutLock(onLockChange: (locked: boolean) => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === LOCK_KEY) onLockChange(isLocalLogoutLocked());
  };
  let channel: BroadcastChannel | null = null;
  let onMessage: ((event: MessageEvent) => void) | null = null;
  try {
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      onMessage = (event: MessageEvent) => {
        const data = event.data as LockMessage | null;
        if (!data || data.tabId === TAB_ID) return; // own-tab signal: handled locally by the initiator
        if (data.type === 'locked') onLockChange(true);
        if (data.type === 'unlocked') onLockChange(false);
      };
      channel.addEventListener('message', onMessage);
    }
  } catch { /* unsupported env */ }
  return () => {
    try {
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      if (channel && onMessage) {
        channel.removeEventListener('message', onMessage);
        channel.close();
      }
    } catch { /* noop */ }
  };
}
