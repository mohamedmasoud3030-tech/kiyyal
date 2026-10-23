/** Browser-helper contracts tested with a minimal document surface, not component snapshots. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiErrorCode, apiErrorMessage, csrfTokenFromBrowserCookie, ensureCsrfToken } from '../../src/ui/clientSecurity.js';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});

function setBrowserCookie(value: string): { cookie: string } {
  const document = { cookie: value };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  return document;
}

describe('browser mutation safety helper', () => {
  it('reads only the named, URI-decoded CSRF cookie and rejects malformed values', () => {
    setBrowserCookie('unrelated=x; kayyal_csrf=token%20with%20spaces; another=y');
    expect(csrfTokenFromBrowserCookie()).toBe('token with spaces');
    setBrowserCookie('kayyal_csrf=%E0%A4%A');
    expect(csrfTokenFromBrowserCookie()).toBeNull();
    setBrowserCookie('not-kayyal_csrf=value');
    expect(csrfTokenFromBrowserCookie()).toBeNull();
  });

  it('does not make a bootstrap request when a token exists, and returns a token only after a successful same-origin bootstrap installs one', async () => {
    setBrowserCookie('kayyal_csrf=already-present');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    await expect(ensureCsrfToken()).resolves.toBe('already-present');
    expect(fetchMock).not.toHaveBeenCalled();

    const browser = setBrowserCookie('');
    const bootstrap = vi.fn<typeof fetch>(async (input, init) => {
      expect(input).toBe('/api/auth/csrf');
      expect(init).toEqual({ credentials: 'same-origin', cache: 'no-store' });
      browser.cookie = 'kayyal_csrf=fresh-token';
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', bootstrap);
    await expect(ensureCsrfToken()).resolves.toBe('fresh-token');
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('fails closed when CSRF bootstrap fails or does not result in a cookie', async () => {
    setBrowserCookie('');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(null, { status: 503 })));
    await expect(ensureCsrfToken()).resolves.toBeNull();

    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(null, { status: 200 })));
    await expect(ensureCsrfToken()).resolves.toBeNull();

    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('network unavailable'); }));
    await expect(ensureCsrfToken()).resolves.toBeNull();
  });

  it('uses structured server error data, never message-text inference, for client recovery states', () => {
    const payload = { error: { code: 'duplicate_payment_suspected', message: 'تأكيد مطلوب' } };
    expect(apiErrorCode(payload)).toBe('duplicate_payment_suspected');
    expect(apiErrorMessage(payload)).toBe('تأكيد مطلوب');
    expect(apiErrorCode({ error: { code: 7, message: 'text' } })).toBeNull();
    expect(apiErrorMessage({ error: { code: 'x', message: 7 } })).toBeNull();
    expect(apiErrorCode(null)).toBeNull();
    expect(apiErrorMessage('not a response')).toBeNull();
  });
});
