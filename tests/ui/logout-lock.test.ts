/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  for (const name of ['gz.session.logoutWipePending.v1', 'gz.session.logoutLock.v1', 'gz.session.logoutRevocationPending.v1']) document.cookie = `${name}=; Path=/; Max-Age=0`;
  vi.resetModules();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('fails closed when persisted lock cannot be read, including a reopened tab', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
  const lock = await import('../../src/ui/localLogoutLock');
  expect(lock.isLocalLogoutLocked()).toBe(true);
  expect(lock.isLogoutRevocationPending()).toBe(true);
});

it('retains lock and revocation debt if writes fail; never returns a false confirmation offline', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const lock = await import('../../src/ui/localLogoutLock');
  lock.setLocalLogoutLock();
  lock.markLogoutRevocationPending(true);
  expect(lock.isLocalLogoutLocked()).toBe(true);
  expect(lock.isLogoutRevocationPending()).toBe(true);
  expect(await lock.retryPendingServerRevocation()).toBe(false);
});

it('notifies subscribers in the initiating tab so protected content is removed too', async () => {
  const lock = await import('../../src/ui/localLogoutLock');
  const listener = vi.fn();
  const stop = lock.subscribeLocalLogoutLock(listener);
  lock.setLocalLogoutLock();
  expect(listener).toHaveBeenCalledWith(true);
  stop();
});

it('does not clear lock if a successful login cannot persist unlocking', async () => {
  const lock = await import('../../src/ui/localLogoutLock');
  lock.setLocalLogoutLock();
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  expect(() => lock.clearLocalLogoutLock()).toThrow();
  expect(lock.isLocalLogoutLocked()).toBe(true);
});

it('a failed device wipe leaves revocation unconfirmed and never calls DELETE', async () => {
  vi.doMock('../../src/ui/offline/outbox', () => ({ offlineStore: () => ({
    clearAll: async () => { throw new Error('disk failed'); },
    isEmpty: async () => false,
  }) }));
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const lock = await import('../../src/ui/localLogoutLock');
  lock.beginLocalLogout();
  expect(await lock.retryPendingServerRevocation()).toBe(false);
  expect(lock.isLocalLogoutLocked()).toBe(true);
  expect(lock.isLocalWipePending()).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  vi.doUnmock('../../src/ui/offline/outbox');
});

it('does not create a new login session while old revocation is unconfirmed', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const lock = await import('../../src/ui/localLogoutLock');
  lock.setLocalLogoutLock();
  lock.markLogoutRevocationPending(true);
  const login = vi.fn();
  await expect(lock.withVerifiedLogoutBeforeLogin(login)).rejects.toThrow();
  expect(login).not.toHaveBeenCalled();
});
