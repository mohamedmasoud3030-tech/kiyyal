/** @vitest-environment jsdom */
/**
 * Client-component proof with a live Next server and real PostgreSQL.
 *
 * JSDOM supplies only DOM event dispatch; every component fetch goes over TCP to
 * the actual Next API and its real runtime database. The assertions therefore
 * require both a visible post-save screen and persisted ledger facts. This is an
 * alternative interaction proof while a Chromium binary is unavailable; it is
 * not presented as a substitute for visual/browser compatibility testing.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer, type Server } from 'node:net';
import { randomUUID } from 'node:crypto';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Route navigation itself is verified through the real Next server in
// tests/routes/next-http.test.ts. This avoids JSDOM-only Next Link scheduler
// updates from obscuring the form/API/persistence behavior under test here.
vi.mock('next/link', () => ({
  default: (properties: ComponentProps<'a'>) => <a {...properties} />,
}));

import { hashPin } from '../../src/auth/hash.js';
import { normalizeOwnerPhone } from '../../src/ui/phone.js';
import type { AuthContext } from '../../src/auth/context.js';
import { createParty } from '../../src/services/party.js';
import { postCostAdjustment } from '../../src/services/postCostAdjustment.js';
import { postPayment } from '../../src/services/postPayment.js';
import { postStockMovement } from '../../src/services/postStockMovement.js';
import { ar } from '../../src/ui/copy/ar.js';
import { CashContent } from '../../src/ui/components/CashContent.js';
import { CostAdjustmentContent } from '../../src/ui/components/CostAdjustmentContent.js';
import { ExpenseContent } from '../../src/ui/components/ExpenseContent.js';
import { InventoryDetailContent } from '../../src/ui/components/InventoryDetailContent.js';
import { MaterialsContent } from '../../src/ui/components/MaterialsContent.js';
import { OperatorLoginForm } from '../../src/ui/components/OperatorLoginForm.js';
import { OwnerLoginForm } from '../../src/ui/components/OwnerLoginForm.js';
import { PartiesContent } from '../../src/ui/components/PartiesContent.js';
import { PaymentContent } from '../../src/ui/components/PaymentContent.js';
import { PartyLedgerContent } from '../../src/ui/components/PartyLedgerContent.js';
import { ProtectedScreen } from '../../src/ui/components/ProtectedScreen.js';
import { SignOutButton } from '../../src/ui/components/SignOutButton.js';
import { TodayContent } from '../../src/ui/components/TodayContent.js';
import { TransactionDetailContent } from '../../src/ui/components/TransactionDetailContent.js';
import { TransactionEntryContent } from '../../src/ui/components/TransactionEntryContent.js';
import { TransactionReceiptContent } from '../../src/ui/components/TransactionReceiptContent.js';
import { HistoryContent } from '../../src/ui/components/HistoryContent.js';
import { postTransaction } from '../../src/services/postTransaction.js';
import { freshRealDatabase, seedYard, stopServer, type Seed, type TestDb } from '../db/pg-harness.js';

let t: TestDb;
let A: Seed;
let baseUrl: string;
let ownerSubject: string;
let providerBaseUrl: string;
let providerServer: HttpServer | undefined;
let serverExitEvidence: string | null = null;
const serverTrace: string[] = [];
function pushServerTrace(line: string): void {
  serverTrace.push(line);
  if (serverTrace.length > 300) serverTrace.splice(0, serverTrace.length - 300);
  if (line.includes('Error') || line.includes('Killed') || line.includes('heap')) {
    console.error(`[next-server] ${line.trimEnd()}`);
  }
}
let ownerAccessTokenRevoked = false;
let ownerPasswordGrantRequests = 0;
let operatorSessionToken: string;
let nextServer: ChildProcessWithoutNullStreams | undefined;
let originalBrowserProviderEnvironment: { url: string | undefined; key: string | undefined } | undefined;
let nativeFetch: typeof fetch;

const OWNER_ACCESS_TOKEN = 'owner-live-provider-token';
const OWNER_SESSION_COOKIE = 'sb-localhost-auth-token';
const OWNER_PHONE = '01012345678';
const OWNER_PASSWORD = 'owner-live-password';

function ownerProviderUser() {
  return {
    id: ownerSubject,
    aud: 'authenticated',
    role: 'authenticated',
    phone: OWNER_PHONE,
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function ownerProviderSession() {
  return {
    access_token: OWNER_ACCESS_TOKEN,
    token_type: 'bearer',
    expires_in: 60 * 60,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    refresh_token: 'owner-live-refresh-token',
    user: ownerProviderUser(),
  };
}

async function freePort(): Promise<number> {
  const probe: Server = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('could not allocate a test port');
  const { port } = address;
  probe.close();
  await once(probe, 'close');
  return port;
}

async function requestJson(request: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

async function startOwnerProvider(): Promise<void> {
  providerServer = createHttpServer(async (request, response) => {
    // Supabase الحقيقي يرسل ترويسات CORS على كل رد ويرد على preflight؛ المتصفح
    // (وhence jsdom fetch بأصل http://localhost) يرفض العبور بدونها، فكان الطلب
    // يسقط قبل الوصول ويظهر وكأنه «لم يُرسَل». نحاكي السلوك الحقيقي بأمانة.
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'authorization, content-type, apikey, x-client-info, x-supabase-api-version');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.url === '/auth/v1/user' && !ownerAccessTokenRevoked && request.headers.authorization === `Bearer ${OWNER_ACCESS_TOKEN}`) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(ownerProviderUser()));
      return;
    }
    if (request.method === 'POST' && request.url?.startsWith('/auth/v1/token?grant_type=password')) {
      const credentials = await requestJson(request) as { phone?: unknown; password?: unknown } | null;
      // مزوّد الهوية الحقيقي يخزّن الهاتف بصيغة E.164 المحسوبة عبر normalizeOwnerPhone —
      // النموذج يرسلها كذلك؛ مقارنة mock يجب أن تحاكي ذلك بدل النص الخام (وإلا
      // سقطت كل الجلسات بصمت: يسجَّل الفشل `ownerPasswordGrantRequests = 0`).
      if (credentials?.phone === normalizeOwnerPhone(OWNER_PHONE) && credentials.password === OWNER_PASSWORD) {
        ownerPasswordGrantRequests += 1;
        ownerAccessTokenRevoked = false;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(ownerProviderSession()));
        return;
      }
    }
    if (request.method === 'POST' && request.url?.startsWith('/auth/v1/logout') && request.headers.authorization === `Bearer ${OWNER_ACCESS_TOKEN}`) {
      ownerAccessTokenRevoked = true;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'unauthenticated' }));
  });
  providerServer.listen(0, '127.0.0.1');
  await once(providerServer, 'listening');
  const address = providerServer.address();
  if (!address || typeof address === 'string') throw new Error('could not allocate provider port');
  providerBaseUrl = `http://localhost:${address.port}`;
}

async function stopOwnerProvider(): Promise<void> {
  if (!providerServer?.listening) return;
  providerServer.close();
  await once(providerServer, 'close');
}

function restoreBrowserProviderEnvironment(): void {
  if (!originalBrowserProviderEnvironment) return;
  if (originalBrowserProviderEnvironment.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalBrowserProviderEnvironment.url;
  if (originalBrowserProviderEnvironment.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalBrowserProviderEnvironment.key;
}

async function waitForNext(url: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastFailure = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await nativeFetch(`${url}/login`, { redirect: 'manual' });
      if (response.status === 200) return;
      lastFailure = `status ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next server did not start: ${lastFailure}`);
}

async function stopNext(): Promise<void> {
  if (!nextServer || nextServer.exitCode !== null) return;
  nextServer.kill('SIGTERM');
  await Promise.race([once(nextServer, 'exit'), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  if (nextServer.exitCode === null) nextServer.kill('SIGKILL');
}

function cookieValue(response: Response, name: string): string {
  const setCookie = response.headers.get('set-cookie');
  const matched = setCookie?.match(new RegExp(`(?:^|,\\s*|;)${name}=([^;,]+)`));
  if (!matched?.[1]) throw new Error(`missing ${name} cookie`);
  return decodeURIComponent(matched[1]);
}

function applySetCookie(response: Response): void {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return;
  // All currently emitted client cookies are single-cookie responses. Preserve
  // the name/value only: JSDOM is the cookie jar and the fetch bridge submits it
  // to the live server exactly as a browser's same-origin request would.
  document.cookie = setCookie.split(';', 1)[0]!;
}

function installLiveBrowserFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = input instanceof Request ? input.url : input.toString();
    const url = rawUrl.startsWith('/') ? `${baseUrl}${rawUrl}` : rawUrl;
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    if (url.startsWith(baseUrl)) {
      headers.set('cookie', document.cookie);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (method !== 'GET' && method !== 'HEAD' && !headers.has('origin')) headers.set('origin', baseUrl);
    }
    const response = await nativeFetch(url, { ...init, headers });
    if (url.startsWith(baseUrl)) applySetCookie(response);
    return response;
  }) as typeof fetch;
}

async function establishOwnerBrowserCookie(): Promise<void> {
  ownerAccessTokenRevoked = false;
  const encodedSession = `base64-${Buffer.from(JSON.stringify(ownerProviderSession())).toString('base64url')}`;
  document.cookie = `${OWNER_SESSION_COOKIE}=${encodeURIComponent(encodedSession)}; Path=/`;
  const accepted = await waitFor(async () => {
    const response = await nativeFetch(`${baseUrl}/api/session`, { headers: { cookie: document.cookie } });
    return response.ok
      && JSON.stringify(await response.json()) === JSON.stringify({ data: { role: 'owner' } });
  }, { timeout: 30_000, interval: 500 });
  if (!accepted) {
    throw new Error('owner session cookie was not accepted by the live application');
  }
}

async function createStableOperatorSession(): Promise<void> {
  const csrfResponse = await nativeFetch(`${baseUrl}/api/auth/csrf`);
  const csrf = cookieValue(csrfResponse, 'kayyal_csrf');
  const code = (await t.admin.query<{ operator_login_code: string }>(
    'SELECT operator_login_code FROM app.yards WHERE id = $1', [A.yardId],
  )).rows[0]!.operator_login_code;
  const signedIn = await nativeFetch(`${baseUrl}/api/auth/operator/session`, {
    method: 'POST',
    headers: {
      origin: baseUrl,
      cookie: `kayyal_csrf=${encodeURIComponent(csrf)}`,
      'content-type': 'application/json',
      'x-kayyal-csrf': csrf,
    },
    body: JSON.stringify({ operator_login_code: code, display_name: 'عامل واجهة', pin: '4271' }),
  });
  if (!signedIn.ok) throw new Error(`operator sign-in failed: ${await signedIn.text()}`);
  operatorSessionToken = cookieValue(signedIn, 'kayyal_operator_session');
}

async function establishOperatorBrowserCookie(): Promise<void> {
  const csrfResponse = await nativeFetch(`${baseUrl}/api/auth/csrf`);
  document.cookie = `kayyal_csrf=${encodeURIComponent(cookieValue(csrfResponse, 'kayyal_csrf'))}; Path=/`;
  document.cookie = `kayyal_operator_session=${encodeURIComponent(operatorSessionToken)}; Path=/`;
}

function ownerContext(): AuthContext {
  return { yardId: A.yardId, actorId: A.ownerId, role: 'owner' };
}

function operatorContext(): AuthContext {
  return { yardId: A.yardId, actorId: A.operatorId, role: 'operator' };
}

async function currentBusinessDate(): Promise<string> {
  return (await t.admin.query<{ date: string }>('SELECT CURRENT_DATE::text AS date')).rows[0]!.date;
}

/**
 * Prerequisites are created through the real service/DB boundary rather than
 * another test's side effects. The UI action under test remains the only action
 * asserted as its feature success in each test below.
 */
async function seedPostedPurchase(materialId: string, quantityKg = '10.00', unitPrice = '20.0000') {
  return postTransaction(t.runtime, ownerContext(), {
    type: 'purchase',
    businessDate: await currentBusinessDate(),
    amountCash: '0.00',
    idempotencyKey: randomUUID(),
    lines: [{ materialId, grossKg: quantityKg, deductionType: 'none', deductionValue: '0', unitPrice, priceUnit: 'kg' }],
    note: 'تهيئة مستقلة لاختبار الواجهة',
  });
}

async function seedClosedPurchaseForCostAdjustment(materialId: string) {
  const historicDate = (await t.admin.query<{ date: string }>('SELECT (CURRENT_DATE - 1)::text AS date')).rows[0]!.date;
  const source = await postTransaction(t.runtime, ownerContext(), {
    type: 'purchase',
    businessDate: historicDate,
    amountCash: '0.00',
    idempotencyKey: randomUUID(),
    lines: [{ materialId, grossKg: '5.00', deductionType: 'none', deductionValue: '0', unitPrice: '10.0000', priceUnit: 'kg' }],
    note: 'مصدر مستقل لتسوية تكلفة',
  });
  const sourceLineId = (await t.admin.query<{ id: string }>(
    'SELECT id::text FROM app.transaction_lines WHERE transaction_id = $1', [source.transactionId],
  )).rows[0]!.id;
  await t.admin.transaction(async (tx) => {
    await tx.query("SELECT set_config('app.posting', 'on', true)");
    await tx.query(
      `INSERT INTO app.day_closes (yard_id, business_date, opening_amount, expected_amount, counted_amount, pending_amount, closed_by)
       VALUES ($1::uuid, $2::date, 0, 0, 0, 0, $3::uuid)`,
      [A.yardId, historicDate, A.ownerId],
    );
  });
  return { source, sourceLineId };
}

async function seedPartyWithIncomingPayment(name: string, amount = '25.00') {
  const party = await createParty(t.runtime, ownerContext(), {
    name,
    kind: 'both',
    idempotencyKey: randomUUID(),
  });
  await postPayment(t.runtime, ownerContext(), {
    partyId: party.id,
    direction: 'in',
    amount,
    note: 'تهيئة مستقلة لسداد',
    idempotencyKey: randomUUID(),
  });
  return party;
}

async function resetWorkflowFacts(): Promise<void> {
  // Keep the seeded identities/catalogue and the stable opaque operator session,
  // but erase every mutable workflow projection and source fact between tests.
  // CASCADE also clears transaction children and party relations.
  await t.admin.query(`
    TRUNCATE TABLE
      app.transactions,
      app.stock_balances,
      app.day_closes,
      app.transaction_counters,
      app.audit_log,
      app.mutation_idempotency,
      app.parties
    CASCADE
  `);
}

beforeAll(async () => {
  nativeFetch = globalThis.fetch;
  t = await freshRealDatabase();
  A = await seedYard(t.admin, 'واجهة', await hashPin('4271'));
  ownerSubject = (await t.admin.query<{ auth_user_id: string }>(
    'SELECT auth_user_id::text FROM app.users WHERE id = $1', [A.ownerId],
  )).rows[0]!.auth_user_id;
  await startOwnerProvider();
  originalBrowserProviderEnvironment = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = providerBaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'owner-live-publishable-key';
  const port = await freePort();
  // See the companion TCP route test: Next dev canonicalizes request.url to
  // localhost, which must match the browser Origin used by the CSRF boundary.
  baseUrl = `http://localhost:${port}`;
  const environment = { ...process.env };
  // The app is given a disposable local Auth provider. Owner API calls use the
  // exact SSR cookie format and the provider verifies the access token; this is
  // intentionally stronger than injecting an owner role or bypassing auth.
  environment.SUPABASE_URL = providerBaseUrl;
  environment.SUPABASE_PUBLISHABLE_KEY = 'owner-live-publishable-key';
  delete environment.SUPABASE_ANON_KEY;
  delete environment.NEXT_PUBLIC_SUPABASE_URL;
  delete environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  environment.DATABASE_URL = `postgres://${t.runtimeUser}:rtpw@localhost:${process.env.TEST_PG_PORT ?? '55433'}/${t.dbName}`;
  environment.NEXT_TELEMETRY_DISABLED = '1';
  nextServer = spawn(process.execPath, [
    './node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port),
  ], { cwd: process.cwd(), env: environment, stdio: 'pipe' });
  // مرصد الخروج (ملاحظة المالك 6): عند موت الخادم أثناء التشغيل نلتقط كود الخروج
  // والإشارة وآخر stderr — فيُثبت OOM بإشارة SIGKILL مثلًا بدل اتهام الذاكرة تعسّفًا.
  nextServer.stderr.on('data', (chunk: Buffer) => pushServerTrace('[stderr] ' + chunk.toString('utf8')));
  nextServer.stdout.on('data', (chunk: Buffer) => pushServerTrace('[stdout] ' + chunk.toString('utf8')));
  nextServer.on('exit', (code, signal) => {
    serverExitEvidence = `next dev exited — code=${String(code)} signal=${String(signal)}`;
    console.error(`\n[next-server exit] ${serverExitEvidence}\n${serverTrace.join('')}`);
  });
  await waitForNext(baseUrl);
  await createStableOperatorSession();
  // تدفئة تجميع dev لمسار DELETE /api/auth/session: أول نداء فعلي لهذا المسار
  // (اختبار إبطال جلسة المالك) كان يدفع كلفة التجميع الكسول — حتى دقيقة تحت
  // ضغط RAM البالغ 2GB داخل بوابة الإصدار — فينفجر صبر نافذة التحقق. ننقل الكلفة
  // هنا إلى الإقلاع بطلبٍ غير موثّق (401 لا يهمنا، التجميع هو المطلوب).
  try {
    await nativeFetch(`${baseUrl}/api/auth/session`, { method: 'DELETE' });
  } catch {
    // أفضل جهد ممكن: انقطاع الشبكة هنا يكشفه إقلاع الخادم نفسه لاحقًا.
  }
  installLiveBrowserFetch();
}, 180_000);

beforeEach(async () => {
  await resetWorkflowFacts();
});

afterEach(() => {
  cleanup();
  document.cookie = 'kayyal_csrf=; Max-Age=0; Path=/';
  document.cookie = 'kayyal_operator_session=; Max-Age=0; Path=/';
  document.cookie = `${OWNER_SESSION_COOKIE}=; Max-Age=0; Path=/`;
});

afterAll(async () => {
  globalThis.fetch = nativeFetch;
  await stopNext();
  await stopOwnerProvider();
  restoreBrowserProviderEnvironment();
  await t?.close();
  await stopServer();
});

describe('operator client workflows against the live application boundary', () => {
  it('signs an operator in from the browser form and exchanges the PIN only for a durable opaque server session', async () => {
    const code = (await t.admin.query<{ operator_login_code: string }>(
      'SELECT operator_login_code FROM app.yards WHERE id = $1', [A.yardId],
    )).rows[0]!.operator_login_code;
    const user = userEvent.setup();
    render(<OperatorLoginForm />);
    const submit = await screen.findByRole('button', { name: ar.auth.signInAction });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    const form = submit.closest('form')!;
    await user.type(form.querySelector('input[name="operator_login_code"]')!, code);
    await user.type(form.querySelector('input[name="display_name"]')!, 'عامل واجهة');
    await user.type(form.querySelector('input[name="pin"]')!, '4271');
    await user.click(submit);

    await waitFor(() => expect(document.cookie).toContain('kayyal_operator_session='), { timeout: 10_000 });
    const session = await nativeFetch(`${baseUrl}/api/session`, { headers: { cookie: document.cookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ data: { role: 'operator' } });
    expect(document.cookie).not.toContain('4271');
  });

  it('submits a purchase from real component controls, renders the server result, obtains CSRF at action time, and persists the ledger facts', async () => {
    await establishOperatorBrowserCookie();
    const today = (await t.admin.query<{ date: string }>('SELECT CURRENT_DATE::text AS date')).rows[0]!.date;
    const user = userEvent.setup();
    render(<TransactionEntryContent type="purchase" />);

    const form = await waitFor(() => {
      const element = document.querySelector('form.transaction-entry');
      if (!element) throw new Error('transaction form not ready');
      return element;
    });
    await user.clear(form.querySelector('input[name="business_date"]')!);
    await user.type(form.querySelector('input[name="business_date"]')!, today);
    await user.selectOptions(form.querySelector('select[name="line-0-material"]')!, A.copperId);
    await user.type(form.querySelector('input[name="line-0-gross"]')!, '10.00');
    await user.type(form.querySelector('input[name="line-0-price"]')!, '20.0000');
    await user.clear(form.querySelector('input[name="amount_cash"]')!);
    await user.type(form.querySelector('input[name="amount_cash"]')!, '0.00');
    await user.type(form.querySelector('input[name="note"]')!, 'شراء من واجهة حية');
    await user.click(form.querySelector('button[type="submit"]')!);

    expect(await screen.findByRole('heading', { name: ar.transactionEntry.savedTitle })).toBeTruthy();
    expect(document.cookie).toContain('kayyal_csrf=');
    expect(document.querySelector('.transaction-result__amount')?.textContent).toContain('200.00');
    const transactionHref = Array.from(document.querySelectorAll('a')).find((element) => element.textContent === ar.transactionEntry.viewTransactionAction)?.getAttribute('href');
    expect(transactionHref).toMatch(/^\/transactions\/[0-9a-f-]{36}$/);
    const transactionId = transactionHref!.split('/').at(-1)!;
    expect((await t.admin.query<{
      status: string; total_amount: string; lines: string; stock: string | null; stock_value: string | null; cash_rows: string; audit_rows: string;
    }>(
      `SELECT t.status, t.total_amount::text,
              (SELECT count(*)::text FROM app.transaction_lines WHERE transaction_id = t.id) AS lines,
              (SELECT quantity_kg::text FROM app.stock_balances WHERE yard_id = t.yard_id AND material_id = $1) AS stock,
              (SELECT total_value::text FROM app.stock_balances WHERE yard_id = t.yard_id AND material_id = $1) AS stock_value,
              (SELECT count(*)::text FROM app.cash_movements WHERE transaction_id = t.id) AS cash_rows,
              (SELECT count(*)::text FROM app.audit_log WHERE entity_type = 'transaction' AND entity_id = t.id) AS audit_rows
         FROM app.transactions t WHERE t.id = $2`, [A.copperId, transactionId],
    )).rows[0]).toEqual({
      status: 'posted', total_amount: '200.00', lines: '1', stock: '10.00', stock_value: '200.00', cash_rows: '0', audit_rows: '1',
    });
  });

  it('creates a party, records an expense and a payment from their focused forms, and reflects all three durable facts in PostgreSQL', async () => {
    await establishOperatorBrowserCookie();
    const user = userEvent.setup();
    const partiesView = render(<PartiesContent role="operator" />);
    await screen.findByRole('button', { name: ar.parties.addAction });
    await user.click(screen.getByRole('button', { name: ar.parties.addAction }));
    const partyForm = document.querySelector('form.party-create-form')!;
    await user.type(partyForm.querySelector('input[name="name"]')!, 'طرف واجهة حية');
    await user.type(partyForm.querySelector('input[name="phone"]')!, '01099999999');
    await user.click(partyForm.querySelector('button[type="submit"]')!);
    await waitFor(() => expect(document.body.textContent).toContain('طرف واجهة حية'));
    const partyId = (await t.admin.query<{ id: string }>(
      "SELECT id::text FROM app.parties WHERE name = 'طرف واجهة حية' AND yard_id = $1", [A.yardId],
    )).rows[0]!.id;
    partiesView.unmount();

    const expenseView = render(<ExpenseContent />);
    const expenseForm = document.querySelector('form.expense-form')!;
    await user.selectOptions(expenseForm.querySelector('select')!, 'transport');
    await user.type(expenseForm.querySelector('#expense-amount')!, '15.00');
    await user.type(expenseForm.querySelector('#expense-note')!, 'نقل واجهة حية');
    await user.click(expenseForm.querySelector('button[type="submit"]')!);
    expect((await screen.findAllByRole('heading', { name: ar.expense.savedTitle })).length).toBeGreaterThanOrEqual(1);
    expenseView.unmount();

    render(<PaymentContent role="operator" />);
    const paymentForm = await waitFor(() => {
      const element = document.querySelector('form.payment-form');
      if (!element) throw new Error('payment form not ready');
      return element;
    });
    await user.selectOptions(paymentForm.querySelector('#payment-party')!, partyId);
    await user.selectOptions(paymentForm.querySelector('#payment-direction')!, 'in');
    await user.type(paymentForm.querySelector('#payment-amount')!, '25.00');
    await user.type(paymentForm.querySelector('#payment-note')!, 'سداد واجهة حية');
    await user.click(paymentForm.querySelector('button[type="submit"]')!);
    expect((await screen.findAllByRole('heading', { name: ar.payment.savedTitle })).length).toBeGreaterThanOrEqual(1);

    const facts = await t.admin.query<{ type: string; amount: string }>(
      `SELECT type, total_amount::text AS amount
         FROM app.transactions WHERE yard_id = $1 AND type IN ('expense', 'payment') ORDER BY type`, [A.yardId],
    );
    expect(facts.rows).toEqual([{ type: 'expense', amount: '15.00' }, { type: 'payment', amount: '25.00' }]);
    expect((await t.admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.cash_movements WHERE yard_id = $1 AND source IN ('expense', 'payment')`, [A.yardId],
    )).rows[0]!.n).toBe('2');
  });

  it('posts an operator sale from the live form and shows a numbered receipt path only after the stock and ledger facts commit', async () => {
    await establishOperatorBrowserCookie();
    const today = await currentBusinessDate();
    await seedPostedPurchase(A.copperId);
    const user = userEvent.setup();
    render(<TransactionEntryContent type="sale" />);
    const form = await waitFor(() => {
      const element = document.querySelector('form.transaction-entry');
      if (!element) throw new Error('sale form not ready');
      return element;
    });
    await user.clear(form.querySelector('input[name="business_date"]')!);
    await user.type(form.querySelector('input[name="business_date"]')!, today);
    await user.selectOptions(form.querySelector('select[name="line-0-material"]')!, A.copperId);
    await user.type(form.querySelector('input[name="line-0-gross"]')!, '4.00');
    await user.clear(form.querySelector('input[name="amount_cash"]')!);
    await user.type(form.querySelector('input[name="amount_cash"]')!, '100.00');
    await user.type(form.querySelector('input[name="note"]')!, 'بيع مرحّل من واجهة حية');
    await user.click(form.querySelector('button[type="submit"]')!);

    expect((await screen.findAllByRole('heading', { name: ar.transactionEntry.savedTitle })).length).toBeGreaterThanOrEqual(1);
    const receiptHref = Array.from(document.querySelectorAll('a'))
      .find((element) => element.textContent === ar.receipt.viewAction)?.getAttribute('href');
    expect(receiptHref).toMatch(/^\/transactions\/[0-9a-f-]{36}\/receipt$/);
    const transactionId = receiptHref!.split('/')[2]!;
    expect((await t.admin.query<{ status: string; total: string; stock: string; cash: string }>(
      `SELECT t.status, t.total_amount::text AS total,
              (SELECT quantity_kg::text FROM app.stock_balances WHERE yard_id = $1 AND material_id = $2) AS stock,
              (SELECT amount::text FROM app.cash_movements WHERE transaction_id = t.id) AS cash
         FROM app.transactions t WHERE t.id = $3`, [A.yardId, A.copperId, transactionId],
    )).rows[0]).toEqual({ status: 'posted', total: '1600.00', stock: '6.00', cash: '100.00' });
  });

  it('shows an operator pending sale as unnumbered, then lets a verified owner add the needed stock and settle that same immutable sale', async () => {
    await establishOperatorBrowserCookie();
    const today = await currentBusinessDate();
    await seedPostedPurchase(A.copperId);
    const operator = userEvent.setup();
    const operatorView = render(<TransactionEntryContent type="sale" />);
    const saleForm = await waitFor(() => {
      const element = document.querySelector('form.transaction-entry');
      if (!element) throw new Error('pending-sale form not ready');
      return element;
    });
    await operator.clear(saleForm.querySelector('input[name="business_date"]')!);
    await operator.type(saleForm.querySelector('input[name="business_date"]')!, today);
    await operator.selectOptions(saleForm.querySelector('select[name="line-0-material"]')!, A.copperId);
    await operator.type(saleForm.querySelector('input[name="line-0-gross"]')!, '50.00');
    await operator.type(saleForm.querySelector('input[name="note"]')!, 'بيع يحتاج تسوية مخزون');
    await operator.click(saleForm.querySelector('button[type="submit"]')!);

    expect((await screen.findAllByRole('heading', { name: ar.transactionEntry.pendingStockTitle })).length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).toContain(ar.transactionEntry.noNumber);
    expect(Array.from(document.querySelectorAll('a')).some((element) => element.textContent === ar.receipt.viewAction)).toBe(false);
    const pendingHref = Array.from(document.querySelectorAll('a'))
      .find((element) => element.textContent === ar.transactionEntry.viewTransactionAction)?.getAttribute('href');
    expect(pendingHref).toMatch(/^\/transactions\/[0-9a-f-]{36}$/);
    const pendingId = pendingHref!.split('/').at(-1)!;
    expect((await t.admin.query<{ status: string; number: string | null; stock: string; pending_cash: string }>(
      `SELECT t.status, t.number::text,
              (SELECT quantity_kg::text FROM app.stock_balances WHERE yard_id = t.yard_id AND material_id = $1) AS stock,
              (SELECT count(*)::text FROM app.cash_movements WHERE transaction_id = t.id AND status = 'pending') AS pending_cash
         FROM app.transactions t WHERE t.id = $2`, [A.copperId, pendingId],
    )).rows[0]).toEqual({ status: 'pending_stock_resolution', number: null, stock: '10.00', pending_cash: '0' });
    operatorView.unmount();

    const pendingReceipt = render(<TransactionReceiptContent transactionId={pendingId} />);
    expect((await screen.findAllByText(ar.receipt.unavailableTitle, {}, { timeout: 10_000 })).length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.transaction-receipt')).toBeNull();
    pendingReceipt.unmount();

    await establishOwnerBrowserCookie();
    const owner = userEvent.setup();
    render(<TransactionDetailContent role="owner" transactionId={pendingId} />);
    await screen.findAllByText(ar.transactionDetail.pendingSettlementTitle, {}, { timeout: 10_000 });
    await owner.click(screen.getByRole('button', { name: ar.transactionDetail.reviewSettlementAction }));
    await owner.click(screen.getByRole('button', { name: ar.transactionDetail.addStockAdjustmentAction }));
    const adjustmentForm = await waitFor(() => {
      const element = document.querySelector('form.transaction-detail__adjustment');
      if (!element) throw new Error('pending-sale adjustment form not ready');
      return element;
    });
    await owner.selectOptions(adjustmentForm.querySelector('select[name="material_id"]')!, A.copperId);
    await owner.type(adjustmentForm.querySelector('input[name="kg"]')!, '40.00');
    await owner.type(adjustmentForm.querySelector('input[name="cost_per_kg"]')!, '8.000000');
    await owner.selectOptions(adjustmentForm.querySelector('select[name="reason"]')!, 'physical_count');
    await owner.type(adjustmentForm.querySelector('input[name="note"]')!, 'تغطية فرق البيع المعلق');
    await owner.click(adjustmentForm.querySelector('button[type="submit"]')!);

    expect((await screen.findAllByText(ar.transactionDetail.settledTitle, {}, { timeout: 10_000 })).length).toBeGreaterThanOrEqual(1);
    await waitFor(async () => {
      const resolved = await t.admin.query<{ status: string; number: string | null; stock: string; adjustment: string }>(
        `SELECT t.status, t.number::text,
                (SELECT quantity_kg::text FROM app.stock_balances WHERE yard_id = $1 AND material_id = $2) AS stock,
                (SELECT count(*)::text FROM app.transactions WHERE yard_id = $1 AND type = 'adjustment' AND status = 'posted') AS adjustment
           FROM app.transactions t WHERE t.id = $3`, [A.yardId, A.copperId, pendingId],
      );
      expect(resolved.rows[0]).toEqual({ status: 'posted', number: '1', stock: '0.00', adjustment: '1' });
    });
  });

  it('renders a printable receipt from the persisted posted sale through the scoped transaction API without owner-only financial fields', async () => {
    await establishOperatorBrowserCookie();
    await seedPostedPurchase(A.copperId);
    const sale = await postTransaction(t.runtime, operatorContext(), {
      type: 'sale',
      businessDate: await currentBusinessDate(),
      amountCash: '100.00',
      idempotencyKey: randomUUID(),
      lines: [{ materialId: A.copperId, grossKg: '4.00', deductionType: 'none', deductionValue: '0', unitPrice: '400.0000', priceUnit: 'kg' }],
      note: 'مصدر مستقل لإيصال البيع',
    });
    expect(sale.status).toBe('posted');
    render(<TransactionReceiptContent transactionId={sale.transactionId} />);

    const receipt = await waitFor(() => {
      const element = document.querySelector('.transaction-receipt');
      if (!element) throw new Error('posted receipt not ready');
      return element;
    }, { timeout: 10_000 });
    expect(receipt.textContent).toContain('1,600.00');
    expect(receipt.textContent).toContain(ar.history.typeLabels.sale);
    expect(receipt.textContent).not.toContain(ar.transactionDetail.costLabel);
    expect(receipt.textContent).not.toContain(ar.transactionDetail.profitLabel);
    expect(screen.getByRole('button', { name: ar.receipt.printAction })).toBeTruthy();
  });

  it('signs an owner in through the provider browser client, then maps that verified browser cookie through the live app boundary', async () => {
    ownerPasswordGrantRequests = 0;
    const user = userEvent.setup();
    render(<OwnerLoginForm />);
    const submit = await screen.findByRole('button', { name: ar.auth.ownerSignInAction });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    const form = submit.closest('form')!;
    await user.type(form.querySelector('input[name="phone"]')!, OWNER_PHONE);
    await user.type(form.querySelector('input[name="password"]')!, OWNER_PASSWORD);
    await user.click(submit);

    await waitFor(() => {
      expect(ownerPasswordGrantRequests).toBe(1);
      expect(document.cookie).toContain(`${OWNER_SESSION_COOKIE}=`);
    }, { timeout: 10_000 });
    const mappedSession = await nativeFetch(`${baseUrl}/api/session`, { headers: { cookie: document.cookie } });
    expect(mappedSession.status).toBe(200);
    expect(await mappedSession.json()).toEqual({ data: { role: 'owner' } });
    await waitFor(() => expect((form.querySelector('input[name="password"]') as HTMLInputElement).value).toBe(''), { timeout: 10_000 });
  });

  it('uses a provider-verified owner SSR cookie to create and explicitly confirm deactivation of catalogue data through live component controls', async () => {
    await establishOwnerBrowserCookie();
    const user = userEvent.setup();
    render(<MaterialsContent role="owner" />);

    await screen.findByRole('button', { name: ar.materials.addAction });
    await user.click(screen.getByRole('button', { name: ar.materials.addAction }));
    const createForm = document.querySelector('form.material-create-form')!;
    await user.type(createForm.querySelector('input[name="type"]')!, 'رصاص');
    await user.type(createForm.querySelector('input[name="grade"]')!, 'مفروز');
    await user.type(createForm.querySelector('input[name="display-name"]')!, 'رصاص حي للمالك');
    await user.selectOptions(createForm.querySelector('select[name="pricing-unit"]')!, 'kg');
    await user.type(createForm.querySelector('input[name="buy-price"]')!, '11.0000');
    await user.type(createForm.querySelector('input[name="sell-price"]')!, '13.0000');
    await user.click(createForm.querySelector('button[type="submit"]')!);
    await waitFor(() => expect(document.body.textContent).toContain('رصاص حي للمالك'));

    const material = await t.admin.query<{ id: string; is_active: boolean }>(
      "SELECT id::text, is_active FROM app.materials WHERE yard_id = $1 AND display_name = 'رصاص حي للمالك'",
      [A.yardId],
    );
    expect(material.rows).toHaveLength(1);
    expect(material.rows[0]!.is_active).toBe(true);

    const item = Array.from(document.querySelectorAll('.materials-list__item'))
      .find((element) => element.textContent?.includes('رصاص حي للمالك'));
    expect(item).toBeTruthy();
    await user.click(item!.querySelector('button')!);
    const editForm = await waitFor(() => {
      const element = document.querySelector('form.material-edit-form');
      if (!element) throw new Error('material edit form not ready');
      return element;
    });
    await user.click(editForm.querySelector('input[name="active"]')!);
    await user.click(editForm.querySelector('button[type="submit"]')!);
    expect((await screen.findAllByText(ar.materials.deactivateTitle)).length).toBeGreaterThanOrEqual(1);
    expect((await t.admin.query<{ is_active: boolean }>('SELECT is_active FROM app.materials WHERE id = $1', [material.rows[0]!.id])).rows[0]!.is_active)
      .toBe(true);

    await user.click(editForm.querySelector('button[type="submit"]')!);
    await waitFor(async () => {
      const persisted = await t.admin.query<{ is_active: boolean }>('SELECT is_active FROM app.materials WHERE id = $1', [material.rows[0]!.id]);
      expect(persisted.rows[0]!.is_active).toBe(false);
    }, { timeout: 10_000 });
    await waitFor(() => expect(document.querySelector('form.material-edit-form')).toBeNull());
    expect(document.body.textContent).toContain(ar.status.inactive);
  });

  it('records an owner opening stock fact from the focused form and exposes its durable receipt', async () => {
    await establishOwnerBrowserCookie();
    const user = userEvent.setup();
    render(<InventoryDetailContent materialId={A.ironId} role="owner" />);

    const openingForm = await waitFor(() => {
      const forms = document.querySelectorAll('form.stock-movement-form');
      if (forms.length < 2) throw new Error('stock detail forms not ready');
      return forms[0]!;
    }, { timeout: 10_000 });
    await user.type(openingForm.querySelector('#opening-quantity')!, '30.00');
    await user.type(openingForm.querySelector('#opening-cost')!, '8.000000');
    await user.type(openingForm.querySelector('#opening-note')!, 'رصيد افتتاح من واجهة المالك');
    await user.click(openingForm.querySelector('button[type="submit"]')!);

    expect((await screen.findAllByRole('heading', { name: ar.stockMovement.savedOpeningTitle })).length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.stock-movement-result')?.textContent).toContain('30.00');
    expect((await t.admin.query<{ quantity: string; value: string }>(
      `SELECT quantity_kg::text AS quantity, total_value::text AS value
         FROM app.stock_balances WHERE yard_id = $1 AND material_id = $2`, [A.yardId, A.ironId],
    )).rows[0]).toEqual({ quantity: '30.00', value: '240.00' });
  });

  it('records an owner physical stock adjustment as a new durable ledger fact instead of editing the balance directly', async () => {
    await establishOwnerBrowserCookie();
    await postStockMovement(t.runtime, ownerContext(), {
      kind: 'opening',
      materialId: A.ironId,
      quantityKg: '30.00',
      costPerKg: '8.000000',
      note: 'تهيئة مستقلة لتعديل الرصيد',
      idempotencyKey: randomUUID(),
    });
    const user = userEvent.setup();
    render(<InventoryDetailContent materialId={A.ironId} role="owner" />);
    const adjustmentForm = await waitFor(() => {
      const forms = document.querySelectorAll('form.stock-movement-form');
      if (forms.length !== 1) throw new Error('stock adjustment form not ready');
      return forms[0]!;
    }, { timeout: 10_000 });
    await user.selectOptions(adjustmentForm.querySelector('#stock-adjustment-direction')!, 'increase');
    await user.type(adjustmentForm.querySelector('#stock-adjustment-quantity')!, '2.00');
    await user.clear(adjustmentForm.querySelector('#stock-adjustment-cost')!);
    await user.type(adjustmentForm.querySelector('#stock-adjustment-cost')!, '9.000000');
    await user.selectOptions(adjustmentForm.querySelector('#stock-adjustment-reason')!, 'physical_count');
    await user.type(adjustmentForm.querySelector('#stock-adjustment-note')!, 'عد فعلي من واجهة المالك');
    await user.click(adjustmentForm.querySelector('button[type="submit"]')!);

    expect((await screen.findAllByRole('heading', { name: ar.stockMovement.savedAdjustmentTitle })).length).toBeGreaterThanOrEqual(1);
    expect((await t.admin.query<{ quantity: string; value: string; adjustments: string }>(
      `SELECT b.quantity_kg::text AS quantity, b.total_value::text AS value,
              (SELECT count(*)::text FROM app.transactions t JOIN app.transaction_lines l ON l.transaction_id = t.id
                 WHERE t.yard_id = $1 AND t.type = 'adjustment' AND t.status = 'posted' AND l.material_id = $2) AS adjustments
         FROM app.stock_balances b WHERE b.yard_id = $1 AND b.material_id = $2`, [A.yardId, A.ironId],
    )).rows[0]).toEqual({ quantity: '32.00', value: '258.00', adjustments: '1' });
  });

  it('submits one eligible closed-purchase cost correction from the owner form and preserves the immutable source linkage', async () => {
    await establishOwnerBrowserCookie();
    const { source, sourceLineId } = await seedClosedPurchaseForCostAdjustment(A.copperId);

    const user = userEvent.setup();
    render(<CostAdjustmentContent role="owner" transactionId={source.transactionId} />);
    const form = await waitFor(() => {
      const element = document.querySelector('form.cost-adjustment-form');
      if (!element) throw new Error('cost adjustment form not ready');
      return element;
    }, { timeout: 10_000 });
    await user.selectOptions(form.querySelector('#cost-adjustment-line')!, sourceLineId);
    await user.type(form.querySelector('#cost-adjustment-corrected-value')!, '60.00');
    await user.selectOptions(form.querySelector('#cost-adjustment-reason')!, 'wrong_price');
    await user.click(form.querySelector('input[type="checkbox"]')!);
    await user.click(form.querySelector('button[type="submit"]')!);

    expect((await screen.findAllByRole('heading', { name: ar.costAdjustment.savedTitle }, { timeout: 10_000 })).length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.cost-adjustment-result__delta')?.textContent).toContain('10.00');
    expect((await t.admin.query<{ original: string; line: string; delta: string }>(
      `SELECT original_transaction_id::text AS original, original_line_id::text AS line, delta_value::text AS delta
         FROM app.cost_adjustment_details WHERE original_transaction_id = $1`, [source.transactionId],
    )).rows[0]).toEqual({ original: source.transactionId, line: sourceLineId, delta: '10.00' });
  });

  it('hydrates protected shells from the live session endpoint and applies an owner history filter against the server-scoped ledger', async () => {
    await establishOperatorBrowserCookie();
    const operatorScreen = render(
      <ProtectedScreen activePath="/today"><TodayContent /></ProtectedScreen>,
    );
    expect((await screen.findAllByRole('link', { name: ar.navigation.purchase }, { timeout: 10_000 })).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByRole('link', { name: ar.navigation.materials })).toHaveLength(0);
    expect((await screen.findAllByRole('heading', { name: ar.today.title })).length).toBeGreaterThanOrEqual(1);
    operatorScreen.unmount();

    await establishOwnerBrowserCookie();
    const { source, sourceLineId } = await seedClosedPurchaseForCostAdjustment(A.copperId);
    const correction = await postCostAdjustment(t.runtime, ownerContext(), {
      originalTransactionId: source.transactionId,
      originalLineId: sourceLineId,
      correctedLineValue: '60.00',
      reason: 'wrong_price',
      note: 'تهيئة مستقلة لفلتر السجل',
      idempotencyKey: randomUUID(),
    });
    const owner = userEvent.setup();
    render(<ProtectedScreen activePath="/history"><HistoryContent /></ProtectedScreen>);
    const filters = await waitFor(() => {
      const element = document.querySelector('form.history-filters');
      if (!element) throw new Error('owner history filters not ready');
      return element;
    }, { timeout: 10_000 });
    expect(screen.getAllByRole('link', { name: ar.navigation.materials }).length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(document.querySelectorAll('.operational-list__item').length).toBeGreaterThan(1), { timeout: 10_000 });
    await owner.selectOptions(filters.querySelector('#history-type')!, 'cost_adjustment');
    await owner.click(filters.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      const rows = document.querySelectorAll('.operational-list__item');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.textContent).toContain(ar.history.typeLabels.cost_adjustment);
      expect(rows[0]!.querySelector('a')?.getAttribute('href')).toBe(`/transactions/${correction.transactionId}`);
    }, { timeout: 10_000 });
  });

  it('renders the owner party ledger from real persisted transaction events and keeps its payment deep link scoped to that party', async () => {
    await establishOwnerBrowserCookie();
    const party = await seedPartyWithIncomingPayment('طرف دفتر حي');
    const partyId = party.id;
    const ledgerView = render(<PartyLedgerContent partyId={partyId} role="owner" />);

    expect((await screen.findAllByText('طرف دفتر حي', {}, { timeout: 10_000 })).length).toBeGreaterThanOrEqual(1);
    const ledger = document.querySelector('.party-ledger__events');
    expect(ledger?.textContent).toContain(ar.partyLedger.paymentIn);
    expect(ledger?.textContent).toContain('25.00');
    expect(Array.from(document.querySelectorAll('a')).find((element) => element.textContent === ar.partyLedger.paymentAction)?.getAttribute('href'))
      .toBe(`/payment?party=${partyId}`);
    ledgerView.unmount();

    render(<PaymentContent initialPartyId={partyId} role="owner" />);
    const paymentForm = await waitFor(() => {
      const element = document.querySelector('form.payment-form');
      if (!element) throw new Error('party payment deep-link form not ready');
      return element;
    }, { timeout: 10_000 });
    expect((paymentForm.querySelector('#payment-party') as HTMLSelectElement).value).toBe(partyId);
  });

  it('closes the current owner cash day only after explicit acknowledgement and reloads the stored close facts', async () => {
    await establishOwnerBrowserCookie();
    await seedPartyWithIncomingPayment('طرف إقفال اليوم', '50.00');
    const dayResponse = await nativeFetch(`${baseUrl}/api/cash/day`, { headers: { cookie: document.cookie } });
    expect(dayResponse.status).toBe(200);
    const day = await dayResponse.json() as { status: string; total_expected_amount: string };
    expect(day.status).toBe('open');
    expect(day.total_expected_amount).toBe('50.00');

    const user = userEvent.setup();
    render(<CashContent role="owner" />);
    const form = await waitFor(() => {
      const element = document.querySelector('form.cash-close');
      if (!element) throw new Error('cash-close form not ready');
      return element;
    });
    const submit = form.querySelector('button[type="submit"]')!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(form.querySelector('#cash-counted-amount')!, day.total_expected_amount);
    await user.click(form.querySelector('input[type="checkbox"]')!);
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await user.click(submit);

    expect(await screen.findByText(ar.cash.closeSuccessTitle)).toBeTruthy();
    await waitFor(async () => {
      const closed = await t.admin.query<{ expected: string; counted: string }>(
        `SELECT expected_amount::text AS expected, counted_amount::text AS counted
           FROM app.day_closes WHERE yard_id = $1 AND business_date = CURRENT_DATE`, [A.yardId],
      );
      expect(closed.rows[0]).toEqual({ expected: day.total_expected_amount, counted: day.total_expected_amount });
    });
    expect((await screen.findAllByText(ar.cash.closedDayStatus)).length).toBeGreaterThanOrEqual(1);
  });

  // كمون صندوق 2GB تحت حمل متتابع يبلغ عشرات الثواني لكل رحلة خادم (مُقاس
  // 2026-10-26: النجاح الطازج 17–26s مقابل 50–130s تحت الضغط، والخادم يخرج
  // code=0 — لا OOM). سقف ممدود صادق لهذا الاختبار بينما سياسة «لا إعادة محاولة
  // مقنّعة» تبقى: إما نجاح بأدلة أو فشل موثق.
  it('uses the live sign-out control to revoke an owner cookie session instead of merely hiding owner UI', { timeout: 150_000 }, async () => {
    await establishOwnerBrowserCookie();
    const user = userEvent.setup();
    render(<SignOutButton />);
    await user.click(screen.getByRole('button', { name: ar.auth.signOutAction }));

    await waitFor(() => expect(ownerAccessTokenRevoked).toBe(true), { timeout: 30_000 });
    const sessionResponse = await nativeFetch(`${baseUrl}/api/session`, { headers: { cookie: document.cookie } });
    expect(sessionResponse.status).toBe(401);
    expect(document.querySelector('.session-actions__error')).toBeNull();
  }, );
});
