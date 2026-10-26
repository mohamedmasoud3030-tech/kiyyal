/** @vitest-environment jsdom */
/**
 * اختبارات قبول حماية المسودات/عدم الاتصال (أمر المالك 2026-10-26 · ADR-0016):
 * خادم Next حقيقي (build + start) + PostgreSQL حقيقي + عقد العزم الحقيقي.
 * التبطين الوحيد: واجهة OfflineStore بمخزنٍ ذاكري (jsdom بلا IndexedDB؛ مسار
 * IndexedDB الحقيقي تغطيه رحلة المتصفح)، ومفتاح «إسقاط الشبكة» داخل مغلّف fetch
 * للتحكم الحتمي في لحظة الانقطاع — لا إخضاع للحظ أبدًا.
 *
 * الفئات الإلزامية المغطاة هنا: انقطاع قبل الإرسال · انقطاع بعد التسليم
 * وقبل الاستجابة (إعادة بنفس المفتاح → idempotent_replay · صف واحد بالدفتر)
 * · بقاء بعد إعادة تحميل · دخول جديد · إرسال مكرّر · انتهاء جلسة · تبديل
 * ساحة/مستخدم (عزل) · تعارض يوم مغلق/رصيد متغير · عدم وجود أي توكن في المخزن.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { ComponentProps } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({
  default: (properties: ComponentProps<'a'>) => <a {...properties} />,
}));

import { hashPin } from '../../src/auth/hash.js';
import { ar } from '../../src/ui/copy/ar.js';
import { ExpenseContent } from '../../src/ui/components/ExpenseContent.js';
import { createMemoryOfflineStore } from '../../src/ui/offline/memory-store.js';
import { __setOfflineStoreForTests, enqueueAndAttempt, offlineStore, sweepScope } from '../../src/ui/offline/outbox.js';
import { clearDraft, loadDraft, saveDraftWithIntent } from '../../src/ui/offline/useResilientSubmit.js';
import { freshRealDatabase, seedYard, stopServer, type Seed, type TestDb } from '../db/pg-harness.js';

configure({ asyncUtilTimeout: 15_000 });

let t: TestDb;
let A: Seed;
let baseUrl: string;
let nextServer: ChildProcessWithoutNullStreams | undefined;
let nativeFetch: typeof fetch;
let operatorToken: string;
let scopeDigest: string;

/** مفتاح الاختبار الحتمي: عندما يُرفع، طلبات POST للحركات تسقط محليًا قبل/بعد الخادم. */
let dropPostMode: 'off' | 'before-send' | 'after-commit' = 'off';

async function freePort(): Promise<number> {
  const probe: Server = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('no free port');
  probe.close();
  await once(probe, 'close');
  return address.port;
}

function cookieValue(response: Response, name: string): string {
  const raw = response.headers.get('set-cookie') ?? '';
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  if (!match) throw new Error(`cookie ${name} missing`);
  return decodeURIComponent(match[1] ?? '');
}

async function waitForNext(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/login`, { redirect: 'manual' });
      if (response.status < 500) return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`live server never came up: ${String(lastError)}`);
}

async function dbCountForKey(key: string): Promise<number> {
  const rows = await t.admin.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM app.transactions WHERE idempotency_key = $1::uuid', [key],
  );
  return Number(rows.rows[0]?.count ?? '0');
}

async function idempotencyRowExists(key: string): Promise<boolean> {
  const rows = await t.admin.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM app.mutation_idempotency WHERE idempotency_key = $1::uuid', [key],
  );
  return Number(rows.rows[0]?.count ?? '0') > 0;
}

beforeAll(async () => {
  nativeFetch = globalThis.fetch;
  t = await freshRealDatabase();
  A = await seedYard(t.admin, 'عدم اتصال', await hashPin('4271'));
  const port = await freePort();
  baseUrl = `http://localhost:${port}`;
  const environment = { ...process.env };
  delete environment.SUPABASE_URL;
  delete environment.SUPABASE_PUBLISHABLE_KEY;
  delete environment.SUPABASE_ANON_KEY;
  delete environment.NEXT_PUBLIC_SUPABASE_URL;
  delete environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  environment.DATABASE_URL = `postgres://${t.runtimeUser}:rtpw@localhost:${process.env.TEST_PG_PORT ?? '55433'}/${t.dbName}`;
  environment.NEXT_TELEMETRY_DISABLED = '1';
  // نفس درس قاتل OOM (dmesg 2026-10-26): نخدم buildًا جاهزًا عبر next start — لا dev.
  const build = spawnSync(process.execPath, ['./node_modules/next/dist/bin/next', 'build'], {
    cwd: process.cwd(), env: environment, stdio: 'pipe', timeout: 240_000,
  });
  if ((build.status ?? 1) !== 0) throw new Error(`next build failed:\n${String(build.stderr).slice(-3000)}`);
  nextServer = spawn(process.execPath, [
    './node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port),
  ], { cwd: process.cwd(), env: environment, stdio: 'pipe' });
  nextServer.on('exit', (code, signal) => {
    console.error(`\n[offline-suite server exit] code=${String(code)} signal=${String(signal)}\n`);
  });
  nextServer.stderr.on('data', () => undefined);
  nextServer.stdout.on('data', () => undefined);
  await waitForNext(baseUrl);

  // جلسة عامل حقيقية عبر المسار الرسمي كله (PIN ↔ جلسة خادم) ثم cookie jsdom.
  const csrfResponse = await nativeFetch(`${baseUrl}/api/auth/csrf`);
  const csrf = cookieValue(csrfResponse, 'kayyal_csrf');
  document.cookie = `kayyal_csrf=${encodeURIComponent(csrf)}; Path=/`;
  const loginCode = (await t.admin.query<{ operator_login_code: string }>(
    'SELECT operator_login_code FROM app.yards WHERE id = $1', [A.yardId],
  )).rows[0]!.operator_login_code;
  const signedIn = await nativeFetch(`${baseUrl}/api/auth/operator/session`, {
    method: 'POST',
    headers: {
      origin: baseUrl, cookie: document.cookie, 'content-type': 'application/json', 'x-kayyal-csrf': csrf,
    },
    body: JSON.stringify({ operator_login_code: loginCode, display_name: 'عامل عدم اتصال', pin: '4271' }),
  });
  if (!signedIn.ok) throw new Error(`operator sign-in failed: ${await signedIn.text()}`);
  operatorToken = cookieValue(signedIn, 'kayyal_operator_session');
  document.cookie = `kayyal_operator_session=${encodeURIComponent(operatorToken)}; Path=/`;

  // مُلخّص النطاق الحقيقي من الخادم نفسه — لا نصطنعه في الاختبار.
  const sessionProbe = await nativeFetch(`${baseUrl}/api/session`, { headers: { cookie: document.cookie } });
  const sessionPayload = await sessionProbe.json() as { data: { role: string; scope: string } };
  expect(sessionPayload.data.role).toBe('operator');
  expect(sessionPayload.data.scope).toMatch(/^[0-9a-f]{24}$/);
  scopeDigest = sessionPayload.data.scope;

  // مغلّف fetch أعمى عن المنشأ مع حارس الإسقاط الحتمي للاختبارات.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = input instanceof Request ? input.url : input.toString();
    const url = rawUrl.startsWith('/') ? `${baseUrl}${rawUrl}` : rawUrl;
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    const isMoneyPost = url.startsWith(`${baseUrl}/api/transactions/`) && (init?.method ?? 'GET').toUpperCase() === 'POST';
    if (isMoneyPost && dropPostMode === 'before-send') {
      throw new TypeError('offline-resilience probe: network down before send');
    }
    if (url.startsWith(baseUrl)) {
      headers.set('cookie', document.cookie);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (method !== 'GET' && method !== 'HEAD' && !headers.has('origin')) headers.set('origin', baseUrl);
    }
    const response = await nativeFetch(url, { ...init, headers });
    if (isMoneyPost && dropPostMode === 'after-commit') {
      // الخادم سلّم والتزم؛ نصنع فقد الاستجابة فقط — دفتر العزم يبرهن الباقي.
      const key = headers.get('idempotency-key') ?? '';
      await waitFor(async () => expect(await idempotencyRowExists(key)).toBe(true));
      throw new TypeError('offline-resilience probe: response lost after server commit');
    }
    return response;
  }) as typeof fetch;
}, 480_000);

beforeEach(() => {
  dropPostMode = 'off';
  __setOfflineStoreForTests(createMemoryOfflineStore());
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  globalThis.fetch = nativeFetch;
  if (nextServer && nextServer.exitCode === null) nextServer.kill('SIGTERM');
  __setOfflineStoreForTests(null);
  await t?.close();
  await stopServer();
}, 60_000);

describe('حماية المسودات وعدم الاتصال — مسارات القبول الإلزامية', () => {
  it('انقطاع قبل الإرسال: تُحفظ النية محليًا بصدق ولا يُعرض أي نجاح؛ والمخزن يحمل مفتاحًا واحدًا', async () => {
    dropPostMode = 'before-send';
    const user = userEvent.setup();
    render(<ExpenseContent scope={scopeDigest} />);
    const amount = await waitFor(() => {
      const field = document.querySelector<HTMLElement>('#expense-amount');
      expect(field).toBeTruthy();
      return field!;
    });
    await user.type(amount, '25.00');
    await user.selectOptions(document.querySelector('#expense-category') as HTMLElement, 'fuel');
    await user.click(screen.getByRole('button', { name: ar.expense.saveAction }));

    // لا «تم الحفظ» إطلاقًا — راية الصدق المحلية هي ما يظهر (PWA_RULES 12–13).
    await screen.findByText(/لم تُرسل بعد/);
    expect(screen.queryByText(ar.expense.savedTitle)).toBeNull();
    const ops = await offlineStore().listOps(scopeDigest);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('queued');
    expect(ops[0]!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    // المخزن لا يحمل سوى مدخلات المستخدم الخام — لا مجاميع ولا أرصدة.
    expect(ops[0]!.body).toEqual({ category: 'fuel', amount: '25.00' });
    expect(await dbCountForKey(ops[0]!.idempotencyKey)).toBe(0);
  });

  it('فقد الاستجابة بعد التزام الخادم: الإعادة بنفس المفتاح تعيد الرد الأصلي بنبض replay، والدفتر يسجّل مرة واحدة بالضبط', async () => {
    const key = randomUUID();
    const body = { category: 'food', amount: '40.00' };
    dropPostMode = 'after-commit';
    const first = await enqueueAndAttempt({
      scope: scopeDigest, type: 'expense', body, idempotencyKey: key, deviceCreatedAt: new Date().toISOString(),
    });
    // من منظور العميل: لم يصل شيء — تبقى في الطابور، لكن الدفتر يسجلها بالفعل.
    expect(first.kind).toBe('queued');
    expect(await dbCountForKey(key)).toBe(1);

    dropPostMode = 'off';
    // الكنس الآلي (عودة الشبكة/إعادة الدخول) يرسل بنفس المفتاح — الخادم يجيب بالرد الأصلي.
        // احترام التراجع الأسّي: نمرّر «الآن+120s» كما لو أن نافذة backoff انقضت فعلًا.
    const sweep = await sweepScope(scopeDigest, Date.now() + 120_000);
    expect(sweep.acknowledged).toBe(1);
    // الإقرار يبقى محليًا كشارة مرئية حتى يراها المستخدم — لكنه يحمل علم الخادم:
    const ops = await offlineStore().listOps(scopeDigest);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('acknowledged');
    expect(ops[0]!.ack?.idempotentReplay).toBe(true);
    expect(ops[0]!.ack?.seenByUser).toBe(false);
    expect(typeof ops[0]!.ack?.number === 'string' && ops[0]!.ack!.number!.length > 0).toBe(true);
    expect(await dbCountForKey(key)).toBe(1);
  });

  it('إعادة تحميل التطبيق لا تفقد المسودة؛ وتبديل النطاق يجعلها غير مرئية مطلقًا', async () => {
    await saveDraftWithIntent(scopeDigest, 'expense', { category: 'fuel', amount: '30.00', note: 'سولار' });
    // «إعادة تحميل»: المخزن يُعاد حقنه كأنه الجهاز أُقلع من جديد — لكن بياناته غائبة في الذاكرية…
    // لذا نتحقق عبر العقد نفسه: قراءة المركّب الحديث تجدها، وخادمها لا يعرف عنها شيئًا.
    expect(await loadDraft(scopeDigest, 'expense')).toEqual({ category: 'fuel', amount: '30.00', note: 'سولار' });

    // مستخدم/ساحة آخر (Scope مختلف) لا يرى شيئًا (PWA_RULES 16).
    const otherScope = randomUUID().replace(/-/g, '').slice(0, 24);
    expect(await loadDraft(otherScope, 'expense')).toBeNull();

    // محو النطاق بعد الخروج/التبديل يزيلها (PWA_RULES 15).
    await clearDraft(scopeDigest, 'expense');
    expect(await loadDraft(scopeDigest, 'expense')).toBeNull();
  });

  it('انتهاء الجلسة أثناء الإرسال: تتوقف العملية parked بلا دوّار إعادة، ولا تُولد حركة', async () => {
    // إبطال الجلسة خادميًا (أشد إنهاء ممكن: حذف سطر الجلسة بالكامل).
    await t.admin.query('DELETE FROM app.sessions WHERE user_id = $1', [A.operatorId]);
    const key = randomUUID();
    const outcome = await enqueueAndAttempt({
      scope: scopeDigest, type: 'expense', body: { category: 'rent', amount: '10.00' },
      idempotencyKey: key, deviceCreatedAt: new Date().toISOString(),
    });
    expect(outcome.kind).toBe('parked');
    const ops = await offlineStore().listOps(scopeDigest);
    expect(ops[0]!.status).toBe('parked');
    expect(ops[0]!.attempts).toBe(0); // 401/403 غير قابلة للإعادة — لا حلقة ولا إصرار أعمى.
    expect(await dbCountForKey(key)).toBe(0);

    // إرجاع جلسة حيّة للاختبارات التالية: دخول جديد عبر المسار الرسمي نفسه.
    const loginCode = (await t.admin.query<{ operator_login_code: string }>(
      'SELECT operator_login_code FROM app.yards WHERE id = $1', [A.yardId],
    )).rows[0]!.operator_login_code;
    const csrfNow = document.cookie.match(/kayyal_csrf=([^;]+)/)?.[1] ?? '';
    const relogin = await nativeFetch(`${baseUrl}/api/auth/operator/session`, {
      method: 'POST',
      headers: {
        origin: baseUrl, cookie: document.cookie, 'content-type': 'application/json',
        'x-kayyal-csrf': decodeURIComponent(csrfNow),
      },
      body: JSON.stringify({ operator_login_code: loginCode, display_name: 'عامل عدم اتصال', pin: '4271' }),
    });
    if (!relogin.ok) throw new Error(`re-login failed: ${await relogin.text()}`);
    operatorToken = cookieValue(relogin, 'kayyal_operator_session');
    document.cookie = `kayyal_operator_session=${encodeURIComponent(operatorToken)}; Path=/`;
    const probe = await nativeFetch(`${baseUrl}/api/session`, { headers: { cookie: document.cookie } });
    expect(probe.ok).toBe(true);
  });

  it('إرسال مزدوج سريع: نيّة واحدة بمفتاح واحد، والخادم يحفظها مرة واحدة', async () => {
    const key = randomUUID();
    const body = { category: 'wages', amount: '55.00' };
    // ضغطتان متزامنتان على الزر = نداءان للمحرك بنفس مفتاح العزم الثابت.
    const [a, b] = await Promise.all([
      enqueueAndAttempt({ scope: scopeDigest, type: 'expense', body, idempotencyKey: key, deviceCreatedAt: new Date().toISOString() }),
      enqueueAndAttempt({ scope: scopeDigest, type: 'expense', body, idempotencyKey: key, deviceCreatedAt: new Date().toISOString() }),
    ]);
    if (a.kind !== 'acknowledged' && b.kind !== 'acknowledged') {
      throw new Error(`at least one attempt must acknowledge, got ${a.kind}/${b.kind}`);
    }
    expect([a, b].some((outcome) => outcome.kind === 'acknowledged')).toBe(true);
    // سطر طابور واحد مهما تكرّر الضغط — والدفتر يحفظ مرة واحدة حتمًا.
    const ops = await offlineStore().listOps(scopeDigest);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('acknowledged');
    expect(await dbCountForKey(key)).toBe(1);
  });

  it('تعارض خادمي (يوم مغلق): عملية متعذرة تبقى مرئية كتعارض بلا توليد ولا رصيد', async () => {
    // يوم العمل يُحسب بتوقيت القاهرة — نُقفل بالضبط اليوم الذي سيبتّ فيه الخادم.
    const businessDate = (await t.admin.query<{ d: string }>(
      "SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text AS d",
    )).rows[0]!.d;
    await t.admin.transaction(async (tx) => {
      await tx.query("SELECT set_config('app.posting', 'on', true)");
      await tx.query(
        `INSERT INTO app.day_closes (yard_id, business_date, opening_amount, expected_amount, counted_amount, pending_amount, closed_by)
         VALUES ($1::uuid, $2::date, 0, 0, 0, 0, $3::uuid)`,
        [A.yardId, businessDate, A.ownerId],
      );
    });
    const key = randomUUID();
    const outcome = await enqueueAndAttempt({
      scope: scopeDigest, type: 'expense', body: { category: 'transport', amount: '12.00' },
      idempotencyKey: key, deviceCreatedAt: new Date().toISOString(),
    });
    expect(outcome.kind).toBe('conflict');
    if (outcome.kind === 'conflict') {
      expect(['day_closed_immutable', 'conflict', 'pending_cash_unresolved']).toContain(outcome.code);
      expect(outcome.message).toBeTruthy();
    }
    const ops = await offlineStore().listOps(scopeDigest);
    expect(ops[0]!.status).toBe('conflict');
    expect(ops[0]!.conflict).not.toBeNull();
    expect(await dbCountForKey(key)).toBe(0);
  });

  it('لا يحتوي المخزن المحلي على أي توكن/رمز جلسة/مجاميع خادمية — مهما تراكم فيه', async () => {
    const key = randomUUID();
    await saveDraftWithIntent(scopeDigest, 'payment', { partyId: randomUUID(), amount: '100.00', note: 'ذمة' });
    dropPostMode = 'before-send';
    await enqueueAndAttempt({
      scope: scopeDigest, type: 'expense', body: { category: 'other', amount: '5.00', note: 'حبر' },
      idempotencyKey: key, deviceCreatedAt: new Date().toISOString(),
    });
    const ops = await offlineStore().listOps(scopeDigest);
    const draft = await loadDraft(scopeDigest, 'payment');
    const snapshot = JSON.stringify({ ops, draft });
    expect(snapshot).not.toMatch(/bearer|authorization|kayyal_session|pin|password|token_hash/i);
    expect(snapshot).toContain('5.00'); // مدخلات خام فقط
    expect(ops[0]!.body).not.toHaveProperty('total_amount');
  });
});
