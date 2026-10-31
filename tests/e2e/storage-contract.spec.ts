import { test, expect, chromium } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// A real browser imports the product modules unchanged (only TS is erased).
// No fake IndexedDB, mocked transaction, Next server, or external database.
let server: Server;
let origin: string;
let networkDown = false;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (networkDown) { req.socket.destroy(); return; }
    if (req.url === '/') { res.end('<!doctype html><title>Storage contract</title>'); return; }
    if (['/sw.js', '/offline.html', '/offline.js', '/manifest.webmanifest', '/icon.svg'].includes(req.url ?? '') || (req.url ?? '').startsWith('/icons/')) {
      try {
        const pathname = req.url ?? '';
        const js = pathname.endsWith('.js');
        const png = pathname.endsWith('.png');
        res.setHeader('Content-Type', js ? 'application/javascript' : png ? 'image/png' : 'text/html');
        res.end(readFileSync(resolve('public', '.' + pathname)));
      } catch { res.writeHead(404).end(); }
      return;
    }
    try {
      const path = resolve(process.cwd(), '.' + req.url!.split('?')[0]);
      if (!path.startsWith(resolve('src') + '/')) { res.writeHead(404).end(); return; }
      const source = readFileSync(path.endsWith('.ts') ? path : path + '.ts', 'utf8');
      res.setHeader('Content-Type', 'application/javascript');
      res.end(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterEach(() => { networkDown = false; });
test.afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

test('real two-tab IndexedDB ownership: one claim wins; no-lock expiry and stale recovery cannot steal', async () => {
  const browser = await chromium.launch({ ...(process.env.KAYYAL_CHROMIUM_PATH ? { executablePath: process.env.KAYYAL_CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const a = await context.newPage();
  const b = await context.newPage();
  await Promise.all([a.goto(origin), b.goto(origin)]);
  await a.evaluate(async () => {
    const { createIndexedDbOfflineStore } = await import('/src/ui/offline/indexeddb-store' as string);
    await createIndexedDbOfflineStore().putOp({ queueId: 'a:k', scope: 'a', status: 'queued', claimedBy: null, claimExpiresAt: null });
  });
  const claims = await Promise.all([a, b].map((page, i) => page.evaluate(async owner => {
    const { createIndexedDbOfflineStore } = await import('/src/ui/offline/indexeddb-store' as string);
    return createIndexedDbOfflineStore().claimOp('a:k', owner, 0, 1);
  }, `owner-${i}`)));
  expect(claims.filter(Boolean)).toHaveLength(1);
  const result = await b.evaluate(async () => {
    Object.defineProperty(navigator, 'locks', { value: undefined });
    const { sweepScope } = await import('/src/ui/offline/outbox' as string);
    const { createIndexedDbOfflineStore } = await import('/src/ui/offline/indexeddb-store' as string);
    const s = createIndexedDbOfflineStore();
    const stale = await s.getOp('a:k');
    const sweep = await sweepScope('a');
    const afterSweep = await s.getOp('a:k');
    await s.patchOpIfOwner('a:k', stale.claimedBy, { claimExpiresAt: 999 });
    const recovered = await s.recoverOp(stale, Date.now());
    return { recovered, orphans: sweep.recoveredOrphans, owner: afterSweep.claimedBy, expectedOwner: stale.claimedBy };
  });
  // جولة 3 (الاستعادة بالغريس): المطالبة المنتهية أمدها بعيدًا (أكثر من فترة
  // السماح) يثبت موت صاحبها، فيستردها الكاسح ويعيدها للطابور بذات مفتاحها —
  // والمطالب القديم لا يصلح (fenced) ولا يسترد ثانية (CAS).
  expect(result.recovered).toBe(false);
  expect(result.orphans).toBe(1);
  expect(result.owner).toBeNull();
  expect(['owner-0', 'owner-1']).toContain(result.expectedOwner);
  await browser.close();
});

test('a reopened tab stays locked when localStorage writing failed in the signing-out tab', async () => {
  const browser = await chromium.launch({ ...(process.env.KAYYAL_CHROMIUM_PATH ? { executablePath: process.env.KAYYAL_CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const a = await context.newPage();
  await a.goto(origin);
  await a.evaluate(async () => {
    const lock = await import('/src/ui/localLogoutLock' as string);
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    lock.markLogoutRevocationPending(true);
    lock.setLocalLogoutLock();
  });
  await a.close();
  const b = await context.newPage();
  await b.goto(origin);
  expect(await b.evaluate(async () => {
    const lock = await import('/src/ui/localLogoutLock' as string);
    return [lock.isLocalLogoutLocked(), lock.isLogoutRevocationPending()];
  })).toEqual([true, true]);
  await browser.close();
});

test('logout lock prevents a late draft writer from repopulating a wiped real database', async () => {
  const browser = await chromium.launch({ ...(process.env.KAYYAL_CHROMIUM_PATH ? { executablePath: process.env.KAYYAL_CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { createIndexedDbOfflineStore } = await import('/src/ui/offline/indexeddb-store' as string);
    const { setLocalLogoutLock } = await import('/src/ui/localLogoutLock' as string);
    const s = createIndexedDbOfflineStore();
    setLocalLogoutLock();
    await s.clearAll();
    let rejected = false;
    try { await s.putDraft({ scope: 'a', formKey: 'expense', fields: { amount: '1' } }); } catch { rejected = true; }
    return { rejected, empty: await s.isEmpty() };
  });
  expect(result).toEqual({ rejected: true, empty: true });
  await browser.close();
});

test('service worker reopens a safe shell offline without caching session or transaction responses', async () => {
  const browser = await chromium.launch({ ...(process.env.KAYYAL_CHROMIUM_PATH ? { executablePath: process.env.KAYYAL_CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.evaluate(async () => {
    await fetch('/api/session');
    await fetch('/api/transactions');
  });
  // Cut the actual origin too: older Chromium does not apply CDP's offline
  // emulation to a newly started service-worker process.
  networkDown = true;
  await context.setOffline(true);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(origin + '/today');
  await expect(reopened.getByRole('heading', { name: 'كيّال — تشتغل دون شبكة' })).toBeVisible();
  const cached = await reopened.evaluate(async () => {
    const names = await caches.keys();
    return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname)))).flat();
  });
  // العقد: nothing cached beyond the public shell + static assets — no API
  // responses, no authenticated HTML, no RSC payloads.
  const allowedPrefixes = ['/offline.html', '/offline.js', '/manifest.webmanifest', '/icons/', '/_next/static/'];
  expect(cached.every((path) => allowedPrefixes.some((prefix) => path.startsWith(prefix)))).toBe(true);
  expect(cached.some((path) => path.startsWith('/api/'))).toBe(false);
  expect(cached).toContain('/offline.html');
  expect(cached).toContain('/offline.js');
  networkDown = false;
  await context.setOffline(false);
  await reopened.goto(origin);
  await expect(reopened).toHaveTitle('Storage contract');
  await browser.close();
});

test('ADR-0010 round-3: functional offline shell reads device store, edits drafts by same key, shows honest reference age', async () => {
  const browser = await chromium.launch({ ...(process.env.KAYYAL_CHROMIUM_PATH ? { executablePath: process.env.KAYYAL_CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  // Seed the device store exactly as the product would (same store module).
  await page.evaluate(async () => {
    const { createIndexedDbOfflineStore } = await import('/src/ui/offline/indexeddb-store' as string);
    const s = createIndexedDbOfflineStore();
    const scope = 'f'.repeat(24);
    await s.putOp({ queueId: scope + ':k1', scope, idempotencyKey: 'aaaaaaaa-1111-4111-8111-111111111111', type: 'expense', body: { amount: '45' }, status: 'queued', attempts: 0, claimedBy: 'tab-x', claimExpiresAt: 1, ack: null });
    await s.putDraft({ scope, formKey: 'expense', fields: { amount: '120', note: 'شاحن' }, intent: { idempotencyKey: 'bbbbbbbb-2222-4222-8222-222222222222', opType: 'expense', acked: false }, savedAt: '2026-10-31T08:00:00.000Z' });
    await s.putRef({ scope, kind: 'snapshot', savedAt: '2026-10-31T07:30:00.000Z', payload: { scope, fetched_at: '2026-10-31T07:30:00.000Z', materials: [{ id: '33333333-3333-4333-8333-333333333333', display_name: 'نحاس أحمر', default_pricing_unit: 'kg' }], parties: [] } });
  });
  networkDown = true;
  await context.setOffline(true);
  await page.close();
  const shell = await context.newPage();
  await shell.goto(origin + '/today'); // تنقّل حقيقي دون شبكة — القشرة تخدمه
  await expect(shell.getByRole('heading', { name: 'كيّال — تشتغل دون شبكة' })).toBeVisible();
  // الطابور يعرض العملية المعلقة بصدق مع مبلغها
  await expect(shell.locator('#ops-list li')).toHaveCount(1);
  await expect(shell.locator('#ops-list li').first()).toContainText('مصروف');
  await expect(shell.locator('#ops-list li').first()).toContainText('بانتظار الشبكة');
  await expect(shell.locator('#ops-list li').first()).toContainText('45');
  // المسودة قابلة للتعديل، واللقطة المرجعية تُعرض بختم «آخر مزامنة»
  const amountInput = shell.locator('#drafts-list input').first();
  await expect(amountInput).toBeVisible();
  await expect(shell.locator('#ref-note')).toContainText('آخر مزامنة');
  await amountInput.fill('350');
  await amountInput.blur();
  await expect(shell.locator('#banner')).toContainText('تم حفظ تعديل المسودة');
  // التحقق من القاعدة الذهبية: التعديل حفظ الحقول فقط — مفتاح الإرسال الأصلي لم يتغير
  const draftAfter = await shell.evaluate(async () => {
    const req = indexedDB.open('kayyal-offline');
    const db = await new Promise<IDBDatabase>((res, rej) => { req.onsuccess = () => res(req.result as IDBDatabase); req.onerror = () => rej(req.error); });
    const get = db.transaction('drafts').objectStore('drafts').get(('f'.repeat(24)) + '|expense');
    return new Promise<{ fields: { amount: string; note: string }; intent: { idempotencyKey: string } }>((res, rej) => { get.onsuccess = () => res(get.result as { fields: { amount: string; note: string }; intent: { idempotencyKey: string } }); get.onerror = () => rej(get.error); });
  });
  expect(draftAfter.fields.amount).toBe('350');
  expect(draftAfter.fields.note).toBe('شاحن');
  expect(draftAfter.intent.idempotencyKey).toBe('bbbbbbbb-2222-4222-8222-222222222222');
  networkDown = false;
  await context.setOffline(false);
  await browser.close();
});

for (const failure of ['exception', 'abort'] as const) {
test(`real IndexedDB: ${failure} rolls back an earlier ack write and preserves draft on restart`, async () => {
  const browser = await chromium.launch({ ...(process.env.KAYYAL_CHROMIUM_PATH ? { executablePath: process.env.KAYYAL_CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.goto(origin);
  const result = await page.evaluate(async (failure) => {
    const { createIndexedDbOfflineStore } = await import('/src/ui/offline/indexeddb-store' as string);
    const s = createIndexedDbOfflineStore();
    const op = { queueId: 'a:k', scope: 'a', idempotencyKey: 'k', type: 'expense', status: 'syncing', claimedBy: 'owner', claimExpiresAt: 1, ack: null };
    await s.putOp(op);
    await s.putDraft({ scope: 'a', formKey: 'expense', fields: { amount: '10' }, intent: { idempotencyKey: 'k' } });
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(key) {
      if (this.name === 'drafts') {
        if (failure === 'exception') throw new Error('injected callback failure after ack write');
        this.transaction.abort();
      }
      return original.call(this, key);
    };
    let rejected = false;
    try { await s.commitAck('a:k', 'owner', { idempotentReplay: false }, 'a', 'expense'); } catch { rejected = true; }
    IDBObjectStore.prototype.get = original;
    return { rejected, status: (await s.getOp('a:k')).status, intent: (await s.getDraft('a', 'expense')).intent };
  }, failure);
  expect(result).toEqual({ rejected: true, status: 'syncing', intent: { idempotencyKey: 'k' } });
  await page.reload();
  expect(await page.evaluate(async () => {
    const { createIndexedDbOfflineStore } = await import('/src/ui/offline/indexeddb-store' as string);
    const s = createIndexedDbOfflineStore();
    await s.commitAck('a:k', 'owner', { idempotentReplay: true }, 'a', 'expense');
    return { ack: (await s.getOp('a:k')).ack, intent: (await s.getDraft('a', 'expense')).intent };
  })).toEqual({ ack: { idempotentReplay: true }, intent: null });
  await browser.close();
});
}

test('real IndexedDB: aborted clear cannot claim success and verification sees every scope', async () => {
  const browser = await chromium.launch({ ...(process.env.KAYYAL_CHROMIUM_PATH ? { executablePath: process.env.KAYYAL_CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { createIndexedDbOfflineStore } = await import('/src/ui/offline/indexeddb-store' as string);
    const s = createIndexedDbOfflineStore();
    await s.putOp({ queueId: 'other:k', scope: 'other' });
    await s.putDraft({ scope: 'third', formKey: 'expense', fields: {}, intent: null });
    const before = await s.isEmpty();
    const original = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function() {
      const request = original.call(this);
      if (this.name === 'drafts') this.transaction.abort();
      return request;
    };
    let rejected = false;
    try { await s.clearAll(); } catch { rejected = true; }
    IDBObjectStore.prototype.clear = original;
    const retained = !(await s.isEmpty());
    await s.clearAll();
    return { before, rejected, retained, empty: await s.isEmpty() };
  });
  expect(result).toEqual({ before: false, rejected: true, retained: true, empty: true });
  await browser.close();
});
