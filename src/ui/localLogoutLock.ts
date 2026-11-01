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
const WIPE_KEY = 'gz.session.logoutWipePending.v1';
const RETRY_KEY = 'gz.session.logoutRevocationPending.v1';
const CHANNEL_NAME = 'gz.session.lock';

const local = new Map<string, boolean>();
const listeners = new Set<(locked: boolean) => void>();


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
  if (local.get(key) === true) return true;
  // Non-secret redundant marker survives a full localStorage store and tab death.
  try { if (document.cookie.split(';').some(part => part.trim() === `${key}=1`)) return true; } catch { return true; }
  try {
    // Verify writes too: a readable but full store cannot carry a logout to a
    // reopened tab. Such a device must not expose protected data.
    localStorage.setItem(`${LOCK_KEY}.probe`, '1');
    localStorage.removeItem(`${LOCK_KEY}.probe`);
    return localStorage.getItem(key) === '1';
  } catch { return true; }
}

function write(key: string, on: boolean): boolean {
  if (on) local.set(key, true);
  let storageWritten = false;
  let cookieWritten = false;
  try {
    if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key);
    storageWritten = (localStorage.getItem(key) === '1') === on;
  } catch { /* redundant marker below; uncertainty still fails closed */ }
  try {
    document.cookie = `${key}=${on ? '1' : ''}; Path=/; SameSite=Strict; Max-Age=${on ? 31536000 : 0}`;
    cookieWritten = document.cookie.split(';').some(part => part.trim() === `${key}=1`) === on;
  } catch { /* unavailable cookie storage */ }
  // Clearing must succeed in BOTH stores: an old marker must not resurrect.
  const persisted = on ? storageWritten || cookieWritten : storageWritten && cookieWritten;
  if (persisted) local.set(key, on);
  return persisted;
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

export function isLocalWipePending(): boolean { return read(WIPE_KEY); }

/** Fence every writer before starting the destructive, user-approved wipe. */
export function beginLocalLogout(): void {
  write(WIPE_KEY, true);
  markLogoutRevocationPending(true);
  setLocalLogoutLock();
}

export function setLocalLogoutLock(): void {
  write(LOCK_KEY, true);
  for (const listener of listeners) listener(true);
  broadcast({ type: 'locked', tabId: TAB_ID });
}

/** Explicit successful login lifts the lock for every tab of this device. */
export function clearLocalLogoutLock(): void {
  if (isLocalWipePending() || isLogoutRevocationPending()) throw new Error('logout_not_finished');
  if (!write(RETRY_KEY, false) || !write(LOCK_KEY, false)) {
    write(LOCK_KEY, true);
    throw new Error('logout_lock_storage_unavailable');
  }
  for (const listener of listeners) listener(false);
  broadcast({ type: 'unlocked', tabId: TAB_ID });
}

export function markLogoutRevocationPending(pending: boolean): void {
  write(RETRY_KEY, pending);
}

/* ------------------------------------------------------------------ *
 * Cross-tab session-transition ordering without Web Locks (2026-10-31).
 *
 * Fallback is a localStorage mutex: each contender writes a fresh token and a
 * TTL, then reads back within the SAME synchronous task. Only the last
 * physical writer sees its own token — losers back off with jittered retries.
 * A crashed holder releases via TTL expiry; release deletes owner-only.
 * In tab-less storage this degrades to the per-tab promise chain below.
 * ------------------------------------------------------------------ */
const MUTEX_KEY = 'gz.session.transitionMutex.v1';
const MUTEX_TTL_MS = 30_000;
const MUTEX_ACQUIRE_BUDGET_MS = 12_000;

interface MutexRecord { readonly token: string; readonly expiresAt: number }

function storageMutexAlive(): boolean {
  try {
    localStorage.setItem(`${MUTEX_KEY}.probe`, '1');
    localStorage.removeItem(`${MUTEX_KEY}.probe`);
    return true;
  } catch { return false; }
}

function readMutex(): MutexRecord | null {
  try {
    const raw = localStorage.getItem(MUTEX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MutexRecord;
    return typeof parsed?.token === 'string' && typeof parsed?.expiresAt === 'number' ? parsed : null;
  } catch { return null; }
}

function newToken(): string {
  try { return crypto.randomUUID(); } catch { return `tk-${Math.random().toString(36).slice(2)}`; }
}

/** Returns a release callback, or null when the mutex could not be acquired. */
async function acquireStorageMutex(): Promise<(() => void) | null> {
  const deadline = Date.now() + MUTEX_ACQUIRE_BUDGET_MS;
  const token = newToken();
  for (;;) {
    const now = Date.now();
    const current = readMutex();
    if (!current || current.expiresAt <= now) {
      const record: MutexRecord = { token, expiresAt: now + MUTEX_TTL_MS };
      try { localStorage.setItem(MUTEX_KEY, JSON.stringify(record)); } catch { return null; }
      // Synchronous readback: simultaneous contenders leave ONE last writer.
      if (readMutex()?.token === token) {
        return () => {
          // Owner-only release; expiry already covers a crashed holder.
          try { if (readMutex()?.token === token) localStorage.removeItem(MUTEX_KEY); } catch { /* noop */ }
        };
      }
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 35 + Math.floor(Math.random() * 90)));
  }
}

/**
 * Best-effort retry of the pending server revocation. Returns true only when
 * the server actually answered the DELETE — the caller may then state success.
 */
let transitionTail: Promise<unknown> = Promise.resolve();
async function withSessionTransition<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks?.request) return await locks.request('kayyal-session-transition', run);
  if (storageMutexAlive()) {
    const release = await acquireStorageMutex();
    if (release) {
      // Serial across tabs: logout/login never overlap device-wide, even
      // without the Locks API. Acquisition failure must NOT run concurrently.
      try { return await run(); } finally { release(); }
    }
    throw new Error('session_transition_busy'); // صريحة: حالة انتقالية معلّقة معروفة
  }
  const pending = transitionTail.then(run, run);
  transitionTail = pending.catch(() => {});
  return pending;
}

/** Exposed for regression tests of the no-Web-Locks ordering contract. */
export const __withSessionTransitionForTests = withSessionTransition;

export function retryPendingServerRevocation(): Promise<boolean> {
  return withSessionTransition(finishPendingLogout);
}

/** Old DELETE requests must finish before a new session is established. */
export function withVerifiedLogoutBeforeLogin<T>(login: () => Promise<T>): Promise<T> {
  return withSessionTransition(async () => {
    if (isLocalLogoutLocked() && !(await finishPendingLogout())) throw new Error('logout_not_finished');
    return login();
  });
}

async function finishPendingLogout(): Promise<boolean> {
  // Wipe is local and must run even offline. No DELETE before a verified wipe.
  if (isLocalWipePending()) {
    try {
      const { offlineStore } = await import('./offline/outbox');
      await offlineStore().clearAll();
      if (!(await offlineStore().isEmpty()) || !write(WIPE_KEY, false)) return false;
    } catch { return false; }
  }
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
      // الدينان سُوِّيا: المسح تحقق والإنهاء الخادمي مؤكد ⇒ المسح المحلي أكّد
      //  ببث «unlocked» حتى تنتقل الشاشات المقفولة (LogoutStatus/useSession)
      // إلى شاشة الدخول تلقائيًا بدل التجميد على «أكّد الخادم».
      if (!isLocalWipePending() && !isLogoutRevocationPending()) {
        if (write(RETRY_KEY, false)) {
          for (const listener of listeners) listener(false);
          broadcast({ type: 'unlocked', tabId: TAB_ID });
        }
      }
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
  listeners.add(onLockChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === LOCK_KEY || event.key === RETRY_KEY || event.key === WIPE_KEY || event.key === null) {
      local.delete(LOCK_KEY);
      local.delete(RETRY_KEY);
      local.delete(WIPE_KEY);
      onLockChange(isLocalLogoutLocked());
    }
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
        if (data.type === 'locked') {
          local.set(LOCK_KEY, true);
          local.set(RETRY_KEY, true);
          onLockChange(true);
        }
        if (data.type === 'unlocked') {
          local.delete(LOCK_KEY);
          local.delete(RETRY_KEY);
          local.delete(WIPE_KEY);
          onLockChange(isLocalLogoutLocked());
        }
      };
      channel.addEventListener('message', onMessage);
    }
  } catch { /* unsupported env */ }
  return () => {
    listeners.delete(onLockChange);
    try {
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      if (channel && onMessage) {
        channel.removeEventListener('message', onMessage);
        channel.close();
      }
    } catch { /* noop */ }
  };
}

