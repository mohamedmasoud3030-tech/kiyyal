/**
 * رحلة عدم الاتصال بالمتصفح الحقيقي (توجيه المالك 8): IndexedDB فعلي داخل
 * Chromium، والخادم build+start حقيقي، وقاعدة PostgreSQL حقيقية — والبرهان
 * بعدّ صفوف الدفتر والمفاتيح وما يراه المستخدم على الشاشة.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:net';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { hashPin } from '../../src/auth/hash.js';
import { ar } from '../../src/ui/copy/ar.js';
import { freshRealDatabase, seedYard, stopServer, type Seed, type TestDb } from '../db/pg-harness.js';

let t: TestDb;
let A: Seed;
let B2: Seed;
let baseUrl: string;
let nextServer: ChildProcessWithoutNullStreams | undefined;
let loginCode: string;
let loginCode2: string;

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

async function dbCountForKey(key: string): Promise<number> {
  const rows = await t.admin.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM app.transactions WHERE idempotency_key = $1::uuid', [key],
  );
  return Number(rows.rows[0]?.count ?? '0');
}

let cachedLogin: { token: string; csrf: string; scope: string } | null = null;

/** دخول مركزي واحد للملف بالكامل — عدّاد الواسطة يقاوم الضغط المتسلسل (429).
 *  والعقدة المقيدة 5 هويات/دقيقة تعني أن التخبئة يجب أن تتحقق وتبقى صادقة: */
async function loginOnce(force = false): Promise<{ token: string; csrf: string; scope: string }> {
  if (cachedLogin && !force) {
    const probe = await fetch(`${baseUrl}/api/session`, { headers: { cookie: `kayyal_operator_session=${cachedLogin.token}` } });
    if (probe.ok) return cachedLogin;
    cachedLogin = null; // الجلسة أُبطلت (خروج C8/حذف SQL في C11) — لا نُعيد رمزًا ميتًا
  }
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  const csrf = (csrfResponse.headers.get('set-cookie') ?? '').match(/kayyal_csrf=([^;]+)/)?.[1];
  if (!csrf) throw new Error('csrf cookie missing');
  let signedIn: Response | null = null;
  for (let tries = 0; tries < 12; tries++) {
    signedIn = await fetch(`${baseUrl}/api/auth/operator/session`, {
      method: 'POST',
      headers: {
        origin: baseUrl, cookie: `kayyal_csrf=${csrf}`, 'content-type': 'application/json',
        'x-kayyal-csrf': decodeURIComponent(csrf),
      },
      body: JSON.stringify({ operator_login_code: loginCode, display_name: 'عامل متصفح', pin: '4271' }),
    });
    if (signedIn.status !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (!signedIn || !signedIn.ok) throw new Error(`operator sign-in failed: ${signedIn ? await signedIn.text() : 'no attempt'}`);
  const token = (signedIn.headers.get('set-cookie') ?? '').match(/kayyal_operator_session=([^;]+)/)?.[1];
  if (!token) throw new Error('session cookie missing');
  const probe = await fetch(`${baseUrl}/api/session`, { headers: { cookie: `kayyal_operator_session=${token}` } });
  const payload = await probe.json() as { data: { scope: string } };
  cachedLogin = { token: decodeURIComponent(token), csrf: decodeURIComponent(csrf), scope: payload.data.scope };
  return cachedLogin;
}

/** جلسة عامل الساحة الثانية عبر المسار الرسمي — هوية مستقلة عن تخبئة A (5 هويات/15د). */
async function signInYard2To(context: BrowserContext): Promise<{ token: string; scope: string }> {
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  const csrf = (csrfResponse.headers.get('set-cookie') ?? '').match(/kayyal_csrf=([^;]+)/)?.[1];
  if (!csrf) throw new Error('csrf cookie missing');
  let signedIn: Response | null = null;
  for (let tries = 0; tries < 12; tries++) {
    signedIn = await fetch(`${baseUrl}/api/auth/operator/session`, {
      method: 'POST',
      headers: {
        origin: baseUrl, cookie: `kayyal_csrf=${csrf}`, 'content-type': 'application/json',
        'x-kayyal-csrf': decodeURIComponent(csrf),
      },
      body: JSON.stringify({ operator_login_code: loginCode2, display_name: 'عامل آخر', pin: '4271' }),
    });
    if (signedIn.status !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (!signedIn || !signedIn.ok) throw new Error(`yard2 sign-in failed: ${signedIn ? await signedIn.text() : 'no attempt'}`);
  const token = (signedIn.headers.get('set-cookie') ?? '').match(/kayyal_operator_session=([^;]+)/)?.[1];
  if (!token) throw new Error('session cookie missing');
  const probe = await fetch(`${baseUrl}/api/session`, { headers: { cookie: `kayyal_operator_session=${token}` } });
  const payload = await probe.json() as { data: { scope: string } };
  await context.addCookies([
    { name: 'kayyal_csrf', value: decodeURIComponent(csrf), domain: 'localhost', path: '/', httpOnly: false },
    { name: 'kayyal_operator_session', value: decodeURIComponent(token), domain: 'localhost', path: '/', httpOnly: true },
  ]);
  return { token: decodeURIComponent(token), scope: payload.data.scope };
}

/** جلسة عامل عبر المسار الرسمي ثم حقن الكوكي HttpOnly في سياق المتصفح الحقيقي. */
async function signInOperatorTo(context: BrowserContext, forceNew = false): Promise<{ token: string; scope: string }> {
  const { token, csrf, scope } = await loginOnce(forceNew);
  await context.addCookies([
    { name: 'kayyal_csrf', value: csrf, domain: 'localhost', path: '/', httpOnly: false },
    { name: 'kayyal_operator_session', value: token, domain: 'localhost', path: '/', httpOnly: true },
  ]);
  return { token, scope };
}

/** فحص مخزن IndexedDB الحقيقي من داخل الصفحة نفسها. */
async function idbOps(page: Page): Promise<Array<{ queueId: string; status: string; idempotencyKey: string; body: Record<string, unknown> }>> {
  return page.evaluate(async () => new Promise((resolve, reject) => {
    const open = indexedDB.open('kayyal-offline')  // بلا تثبيت إصدار: يفتح النسخة الجارية (v2 بمخازنها الثلاثة);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('outbox')) { resolve([]); db.close(); return; }
      const tx = db.transaction('outbox', 'readonly');
      const req = tx.objectStore('outbox').getAll();
      req.onsuccess = () => { resolve(req.result as never); db.close(); };
      req.onerror = () => { reject(req.error); db.close(); };
    };
    open.onupgradeneeded = () => { open.result.close(); resolve([]); };
  }));
}

async function idbDraft(page: Page, formKey: string): Promise<{ intent: { idempotencyKey: string } | null; fields: Record<string, unknown> } | null> {
  return page.evaluate(async (key) => new Promise((resolve, reject) => {
    const open = indexedDB.open('kayyal-offline')  // بلا تثبيت إصدار: يفتح النسخة الجارية (v2 بمخازنها الثلاثة);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('drafts')) { resolve(null); db.close(); return; }
      const tx = db.transaction('drafts', 'readonly');
      const req = tx.objectStore('drafts').getAll();
      req.onsuccess = () => {
        const all = req.result as Array<{ formKey: string }>;
        resolve((all.find((d) => d.formKey === key) as never) ?? null);
        db.close();
      };
      req.onerror = () => { reject(req.error); db.close(); };
    };
    open.onupgradeneeded = () => { open.result.close(); resolve(null); };
  }), formKey);
}

async function fillExpense(page: Page, amount: string): Promise<void> {
  await page.goto(`${baseUrl}/expense`);
  await page.locator('#expense-category').selectOption('fuel');
  await page.locator('#expense-amount').fill(amount);
  await page.waitForTimeout(650); // ترقّق الحفظ التلقائي 500ms
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(360_000);
  t = await freshRealDatabase();
  A = await seedYard(t.admin, 'متصفح عدم اتصال', await hashPin('4271'));
  loginCode = (await t.admin.query<{ operator_login_code: string }>(
    'SELECT operator_login_code FROM app.yards WHERE id = $1', [A.yardId],
  )).rows[0]!.operator_login_code;
  B2 = await seedYard(t.admin, 'ساحة الحساب الآخر', await hashPin('4271'));
  loginCode2 = (await t.admin.query<{ operator_login_code: string }>(
    'SELECT operator_login_code FROM app.yards WHERE id = $1', [B2.yardId],
  )).rows[0]!.operator_login_code;
  await t.admin.query("UPDATE app.users SET display_name='عامل آخر' WHERE id = $1", [B2.operatorId]);
  await t.admin.query("UPDATE app.users SET display_name='عامل متصفح' WHERE id = $1", [A.operatorId]);
  const port = await freePort();
  baseUrl = `http://localhost:${port}`;
  const environment = { ...process.env };
  for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    delete environment[name];
  }
  environment.DATABASE_URL = `postgres://${t.runtimeUser}:rtpw@localhost:${process.env.TEST_PG_PORT ?? '55433'}/${t.dbName}`;
  environment.NEXT_TELEMETRY_DISABLED = '1';
  // نفس درس قاتل OOM/التجميع الكسول: بناء أحادي ثم next start.
  const build = spawnSync(process.execPath, ['./node_modules/next/dist/bin/next', 'build'], {
    cwd: process.cwd(), env: environment, stdio: 'pipe', timeout: 240_000,
  });
  if ((build.status ?? 1) !== 0) throw new Error(`next build failed: ${String(build.stderr).slice(-2000)}`);
  nextServer = spawn(process.execPath, [
    './node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port),
  ], { cwd: process.cwd(), env: environment, stdio: 'pipe' });
  nextServer.stderr.on('data', () => undefined);
  nextServer.stdout.on('data', () => undefined);
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
      if (response.status < 500) break;
    } catch { /* boot */ }
    if (Date.now() > deadline) throw new Error('browser-journey server never came up');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
});

test.afterAll(async () => {
  if (nextServer && nextServer.exitCode === null) nextServer.kill('SIGTERM');
  await t?.close();
  await stopServer();
});

test('C1: إغلاق أثناء الإرسال قبل الوصول — المفتاح والمحتوى يُستعادان، والإكمال التلقائي يظهر ويسجّل مرة واحدة', async ({ context }) => {
  await signInOperatorTo(context);
  const page = await context.newPage();
  await fillExpense(page, '25.00');
  const draftBefore = await idbDraft(page, 'expense');
  expect(draftBefore?.intent?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  await context.setOffline(true);
  await page.locator('form.expense-form button[type="submit"]').click();
  await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toContainText('غير متصل');

  // «أُغلق التطبيق مقطوعًا وفُتح لاحقًا بشبكة»: بلا Service Worker التنقل
  // يتطلب اتصالًا — القطع هنا كان قبل إرسال الطلب قطعيًا (يلتزم به العدّاد).
  expect(await dbCountForKey(draftBefore!.intent!.idempotencyKey)).toBe(0);
  await context.setOffline(false);
  // [تشخيص مؤقت] راقب مفتاح المسودة قبل/بعد إعادة الفتح لتحديد مصدر الاستراقاق:
  await page.reload();
  // الاستئناف التلقائي بنفس المفتاح حرفيًا + شارة الإقرار المرئية — وبعد الإقرار:
  await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toContainText('اكتملت', { timeout: 30_000 });
  // المسودة صارت شاهدة مستهلكة (intent=null) والنموذج صُفّر — لا ترجيع «كجديدة».
  expect((await idbDraft(page, 'expense'))?.intent ?? null).toBeNull();
  expect(await page.locator('#expense-amount').inputValue()).toBe('');
  const ops = await idbOps(page);
  expect(await dbCountForKey(draftBefore!.intent!.idempotencyKey)).toBe(1);
  expect(ops.filter((op) => op.status === 'acknowledged')).toHaveLength(1);
  await page.close();
});

test('C2: إغلاق أثناء الإرسال بعد التزام الخادم — إعادة بنفس المفتاح تسترجع الرد الأصلي بعلم replay', async ({ context }) => {
  await signInOperatorTo(context);
  const page = await context.newPage();
  await fillExpense(page, '40.00');
  let capturedKey: string | null = null;
  await page.route('**/api/transactions/expense', async (route) => {
    capturedKey = route.request().headers()['idempotency-key'] ?? null;
    // الطلب يصل الخادم ويعالَج، ثم تُقطع الاستجابة عن العميل — أقصى سوء وبائي.
    await route.fetch().catch(() => null);
    await route.abort('failed');
  });
  await page.locator('form.expense-form button[type="submit"]').click();
  await expect(page.getByText(/لم تُرسل بعد|انقطعت/)).toBeVisible({ timeout: 20_000 });
  expect(capturedKey).toMatch(/^[0-9a-f-]{36}$/);
  await page.waitForTimeout(400);
  expect(await dbCountForKey(capturedKey!)).toBe(1); // الخادم التزم فعلًا

  await page.unroute('**/api/transactions/expense');
  await page.reload();
  await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toContainText('اكتملت', { timeout: 30_000 });
  const ops = await idbOps(page);
  const acked = ops.find((op) => op.status === 'acknowledged');
  expect(acked?.idempotencyKey).toBe(capturedKey);
  expect(await dbCountForKey(capturedKey!)).toBe(1); // مرة واحدة، لا ازدواج أبدًا
  await page.close();
});

test('C3: الضغط حفظ قبل الاستئناف التلقائي وبعده — سطر واحد، وأي إدخال لاحق هوية جديدة لا إعادة تسجيل', async ({ context }) => {
  await signInOperatorTo(context);
  const page = await context.newPage();
  await fillExpense(page, '33.00');
  const draft = await idbDraft(page, 'expense');
  const key = draft!.intent!.idempotencyKey;
  await context.setOffline(true);
  await page.locator('form.expense-form button[type="submit"]').click();
  await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toContainText('غير متصل');
  await context.setOffline(false);
  // ضغطة ثانية محدقة تزامنًا مع الكنس التلقائي — قفل الطيران الواحد هو الحكم.
  // requestSubmit يختبر منطق الأزرار/الصندوق دون انتظار تفعيل واجهة الاستجابة.
  await page.evaluate(() => {
    const form = document.querySelector('form.expense-form');
    if (form instanceof HTMLFormElement) form.requestSubmit();
  });
  await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toContainText('اكتملت', { timeout: 30_000 });
  await page.waitForFunction(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const open = indexedDB.open('kayyal-offline')  // بلا تثبيت إصدار: يفتح النسخة الجارية (v2 بمخازنها الثلاثة);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
      open.onupgradeneeded = () => { open.result.close(); resolve(null); };
    });
    if (!db || !db.objectStoreNames.contains('outbox')) return false;
    const all = await new Promise<unknown[]>((resolve) => {
      const tx = db.transaction('outbox', 'readonly');
      const req = tx.objectStore('outbox').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    });
    db.close();
    return all.length === 1;
  }, undefined, { timeout: 30_000 }).catch(() => undefined);
  expect((await idbOps(page)).length).toBe(1); // سطر واحد لكل نية مهما تداخلت الأزرار والموقتات
  expect(await dbCountForKey(key)).toBe(1);
  // الإقرار ظاهر في إحدى صورتيه الشرعيتين: راية الخلفية فوق نموذج مصفّر
  // أو شاشة نجاح الإرسال المباشر — كلاهما ظهور صحيح لحدث الإقرار نفسه.
  await expect(
    page.getByTestId('external-ack-banner').or(page.getByRole('heading', { name: ar.expense.savedTitle }).first())
  ).toBeVisible({ timeout: 45_000 });
  await page.goto(`${baseUrl}/expense`); // دخول جديد للنموذج = نية جديدة عند الإدخال
  await page.locator('#expense-category').selectOption('fuel');
  await page.locator('#expense-amount').fill('12.00');
  await page.waitForTimeout(650); // ترقّق الحفظ التلقائي — هوية جديدة لهذه النية
  const freshDraft = await idbDraft(page, 'expense');
  expect(freshDraft?.intent?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(freshDraft?.intent?.idempotencyKey).not.toBe(key); // مستهلك لا يُعاد
  expect(await dbCountForKey(key)).toBe(1);
  await page.close();
});

test('C4: تبويبان بإعادة اتصال متزامنة — مانع السباق الذرّي يضمن التسجيل الوحيد', async ({ context }) => {
  await signInOperatorTo(context);
  const page1 = await context.newPage();
  await fillExpense(page1, '51.00');
  const draft = await idbDraft(page1, 'expense');
  const key = draft!.intent!.idempotencyKey;
  // التبويب الثاني يُفتح قبل انفلات الشبكة (واقع الفتح المسبق — لا تنقّل مقطوعًا).
  const page2 = await context.newPage();
  await page2.goto(`${baseUrl}/today`);
  await expect(page2.locator('[data-testid="connection-chip"]:visible').first()).toBeVisible({ timeout: 15_000 });
  await context.setOffline(true);
  await page1.locator('form.expense-form button[type="submit"]').click();
  await expect(page1.locator('[data-testid="connection-chip"]:visible').first()).toContainText('غير متصل');
  await expect(page2.locator('[data-testid="connection-chip"]:visible').first()).toContainText('لم تُرسل', { timeout: 15_000 });
  await context.setOffline(false); // عودة الشبكة تضرب التبويبين معًا
  await expect(page1.locator('[data-testid="connection-chip"]:visible').first()).toContainText('اكتملت', { timeout: 40_000 });
  await expect(page2.locator('[data-testid="connection-chip"]:visible').first()).toContainText('اكتملت', { timeout: 40_000 });
  expect(await dbCountForKey(key)).toBe(1);
  const ops1 = await idbOps(page1);
  const ops2 = await idbOps(page2);
  expect(ops1.length).toBe(ops2.length); // رؤية واحدة من المخزن المشترك
  expect(ops1.filter((op) => op.status === 'acknowledged')).toHaveLength(1);
  await page1.close();
  await page2.close();
});

test('C5: جلسة منتهية — parked بلا إعادة محاولات، ولا استئناف إلا بعد جلسة صالحة لنفس النطاق', async ({ context }) => {
  await signInOperatorTo(context);
  const page = await context.newPage();
  await fillExpense(page, '12.00');
  const draft = await idbDraft(page, 'expense');
  const key = draft!.intent!.idempotencyKey;
  await t.admin.query('DELETE FROM app.sessions WHERE user_id = $1', [A.operatorId]);
  await page.locator('form.expense-form button[type="submit"]').click();
  await expect(page.getByText(/انتهت الجلسة/)).toBeVisible({ timeout: 20_000 });
  expect(await dbCountForKey(key)).toBe(0);
  // إعادة تحميل بلا جلسة صالحة: لا مسبار نطاق ⇒ لا كنس ⇒ لا محاولة صامتة.
  await page.reload();
  await page.waitForTimeout(2_000);
  expect(await dbCountForKey(key)).toBe(0);
  // دخول جديد لنفس المستخدم = نفس scope ⇒ استئناف بنفس المفتاح.
  await signInOperatorTo(context, true);
  await page.goto(`${baseUrl}/today`);
  await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toContainText('اكتملت', { timeout: 40_000 });
  expect(await dbCountForKey(key)).toBe(1);
  await page.close();
});

test('C6: تعارض يوم مغلق يبقى ظاهرًا بعد إعادة التحميل بسببه وإجراءاته المشروعة', async ({ context }) => {
  const { yardId, ownerId } = B2;
  await signInYard2To(context);
  const businessDate = (await t.admin.query<{ d: string }>(
    "SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text AS d",
  )).rows[0]!.d;
  await t.admin.transaction(async (tx) => {
    await tx.query("SELECT set_config('app.posting', 'on', true)");
    await tx.query(
      `INSERT INTO app.day_closes (yard_id, business_date, opening_amount, expected_amount, counted_amount, pending_amount, closed_by)
       VALUES ($1::uuid, $2::date, 0, 0, 0, 0, $3::uuid)`,
      [yardId, businessDate, ownerId],
    );
  });
  const page = await context.newPage();
  await fillExpense(page, '60.00');
  const draft = await idbDraft(page, 'expense');
  const key = draft!.intent!.idempotencyKey;
  await page.locator('form.expense-form button[type="submit"]').click();
  await expect(page.getByText(/تعارض يحتاج قرارك/)).toBeVisible({ timeout: 20_000 });
  expect(await dbCountForKey(key)).toBe(0); // تعارض = صفر توليد
  await page.reload();
  // بعد الإعادة: الرقاقة ما تزال تنادي بالنزاع، واللوحة تفصّله.
  await page.locator('[data-testid="connection-chip"]:visible').first().click();
  await expect(page.getByText(/اليوم مقفول|تعارض في البيانات/)).toBeVisible({ timeout: 15_000 });
  // الكنس لا يلمس التعارضات أبدًا (لا إعادة صامتة):
  await page.waitForTimeout(1_500);
  expect(await dbCountForKey(key)).toBe(0);
  await page.close();
});


test('C7: الخروج مع عمل غير محسوم — عدّاد ظاهر واختيار صريح موثق، لا مسح صامت', async ({ context }) => {
  await signInOperatorTo(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[c7-pageerror]', String(e).slice(0, 400)));
  await fillExpense(page, '77.00');
  await context.setOffline(true);
  await page.locator('form.expense-form button[type="submit"]').click();
  await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toContainText('غير متصل');
  const draft = await idbDraft(page, 'expense');
  const key = draft!.intent!.idempotencyKey;

  await page.getByRole('button', { name: ar.auth.signOutAction }).first().click();
  // البوابة تعرض الحساب الدقيق قبل أي مسح:
  await expect(page.getByText(ar.signOutGate.pendingTitle)).toBeVisible();
  await expect(page.getByText(/1 عملية غير مؤكدة/)).toBeVisible();
  // التراجع يُبقي كل شيء:
  await page.getByRole('button', { name: ar.signOutGate.cancel }).click();
  expect(await dbCountForKey(key)).toBe(0);
  await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toContainText('غير متصل');
  // القرار التدميري الصريح هو وحده من يمسح:
  await page.getByRole('button', { name: ar.auth.signOutAction }).first().click();
  await expect(page.getByText(ar.signOutGate.pendingTitle)).toBeVisible();
  await page.getByRole('button', { name: /أخرج واحذف المحلي نهائيًا/ }).first().click();
  // القرار المحلي نُفّذ فورًا رغم القطع؛ التنقل بعده يتطلب شبكة (بلا SW)
  // — نعيد الشبكة ونعيد التنقّل كما سيفعل المستخدم فعليًا.
  await page.waitForTimeout(1_200);
  await context.setOffline(false);
  await page.goto(`${baseUrl}/login`).catch(() => undefined);
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  const page2 = await context.newPage();
  await page2.goto(`${baseUrl}/login`);
  expect(await idbOps(page2)).toHaveLength(0);
  expect(await dbCountForKey(key)).toBe(0); // المسح لا ينتج تسجيلًا خادميًا أبدًا
  await page.close();
  await page2.close();
});

test('C8: خروج مقطوع الشبكة — لا ادعاء نجاح، قفل محلي عابر للتبويبات، وإنهاء خادمي مؤكد بعد العودة', async ({ context }) => {
  const { token } = await signInOperatorTo(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[c8-pageerror]', String(e).slice(0, 300)));
  await page.goto(`${baseUrl}/today`);
  await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toBeVisible();

  // قطع الشبكة ثم طلب الخروج: المسح المحلي يحدث فورًا، والإنهاء الخادمي يتعذّر.
  await context.setOffline(true);
  await page.getByRole('button', { name: ar.auth.signOutAction }).first().click();

  // الحالة الصادقة (توجيه 1): قفل محلي + عدم تأكيد الإنهاء — لا نجاح على التنقل وحده.
  await expect(page.getByText(ar.signOutLocked.title)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(ar.signOutLocked.unconfirmed)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('gz.session.logoutLock.v1'))).toBe('1');

  // عودة الشبكة ⇒ إعادة المحاولة التلقائية تؤكد الإنهاء ثم تنتقل لشاشة الدخول.
  await context.setOffline(false);
  await page.waitForURL(/\/login/, { timeout: 30_000 });

  // الجلسة الخادمية الفعلية مقطوعة الآن — من الخادم نفسه لا من واجهتنا:
  const serverProbe = await fetch(`${baseUrl}/api/session`, { headers: { cookie: `kayyal_operator_session=${token}` } });
  expect(serverProbe.status).toBe(401);

  // نفس التبويب يعيد فتح /today ⇒ حارس الجلسة يعيده لـ /login.
  await page.goto(`${baseUrl}/today`);
  await page.waitForURL(/\/login/, { timeout: 30_000 });

  // تبويب آخر (نفس الجهاز) يعيد فتح /today ⇒ القفل المحلي الواضح يسبق حتى الشبكة.
  const tabB = await context.newPage();
  await tabB.goto(`${baseUrl}/today`);
  await tabB.waitForURL(/\/login/, { timeout: 30_000 });
  await page.close();
  await tabB.close();
});

test('C9: زر «أرسل المعلّق الآن» نقرة حقيقية — يعمل رغم إيقاف الكنس، يحدّث العدّاد، ويُظهر النجاح/الفشل', async ({ context }) => {
  await signInOperatorTo(context);
  const page = await context.newPage();
  await fillExpense(page, '33.00');
  await context.setOffline(true);
  await page.locator('form.expense-form button[type="submit"]').click();
  await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toContainText('غير متصل');
  const draft = await idbDraft(page, 'expense');
  const key = draft!.intent!.idempotencyKey;

  await page.getByRole('button', { name: ar.auth.signOutAction }).first().click();
  await expect(page.getByText(ar.signOutGate.pendingTitle)).toBeVisible();
  await expect(page.getByText(/1 عملية غير مؤكدة/)).toBeVisible();

  // نقرة حقيقية مقطوعة الشبكة: محاولة مقصودة تحدث وتُقاوَم بصدق (توجيه 2).
  await page.getByRole('button', { name: ar.signOutGate.resumeFirst }).click();
  await expect(page.getByText(ar.signOutGate.sendFailed)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/1 عملية غير مؤكدة/)).toBeVisible();
  expect(await dbCountForKey(key)).toBe(0);

  // بعد عودة الشبكة: نفس الزر يُرسل رغم إيقاف الكنس الخلفي. استجابة 429 الممكنة
  // (ضغط الجناح على مُقيّد المعدل) تُظهر فشلًا صادقًا وتراجعًا — والمستخدم الحقيقي
  // يكرر النقر بعد انقضائه؛ نحاكي ذلك حتى النجاح أو نفاد السقف الزمني.
  await context.setOffline(false);
  const successText = page.getByText(ar.signOutGate.sendSucceeded);
  for (let clicks = 1; clicks <= 6; clicks += 1) {
    await page.getByRole('button', { name: ar.signOutGate.resumeFirst }).click();
    try {
      await expect(successText).toBeVisible({ timeout: 10_000 });
      break;
    } catch (failure) {
      if (clicks === 6) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync('test-results/c9-debug.json', JSON.stringify({
          ops: await idbOps(page), dbRows: await dbCountForKey(key),
          dialogText: await page.locator('.outbox-panel').innerText().catch(() => 'no-dialog'),
        }, null, 2));
        throw failure;
      }
      await page.waitForTimeout(6_000); // تراجع 429/الخدمة ينقضي ثم يعيد المستخدم النقر
    }
  }
  await expect(page.getByText(/0 عملية غير مؤكدة/)).toBeVisible();
  expect(await dbCountForKey(key)).toBe(1);
  const ops = await idbOps(page);
  expect(ops.filter((op) => op.status === 'acknowledged' && op.idempotencyKey === key)).toHaveLength(1);
  await page.close();
});

test('C10: تبويب A بطيء وتبويب B يُطلق focus/online — لا سرقة للمحاولة الحيّة ولا تكرار خادمي', async ({ context }) => {
  await signInOperatorTo(context);
  const probe = await context.newPage();
  await probe.goto(`${baseUrl}/login`); // سياق آمن حقيقي (localhost) قبل فحص Web Locks
  expect(await probe.evaluate(() => 'locks' in navigator && typeof navigator.locks.request === 'function'))
    .toBe(true); // آلية القفل حقيقية في هذا المتصفح — ليست افتراضًا
  await probe.close();
  const pageA = await context.newPage();
  await fillExpense(pageA, '55.00');

  let expensePosts = 0;
  let resolveHold: (() => void) | null = null;
  const holdGate = new Promise<void>((resolve) => { resolveHold = resolve; });
  await pageA.route('**/api/transactions/expense', async (route) => {
    expensePosts += 1;
    await holdGate; // طلب A معلّق عمدًا — A حيّ ويمسك قفل العملية
    await route.continue();
  });
  await pageA.locator('form.expense-form button[type="submit"]').click();
  await pageA.waitForTimeout(600); // الطلب غادر نحو الخادم ولم يُحسم بعد

  // تبويب B مفعّل بالكامل على نفس النموذج: mount/focus/online كلها تجرّب السرقة.
  const pageB = await context.newPage();
  await pageB.goto(`${baseUrl}/expense`);
  await pageB.waitForTimeout(800);
  await pageB.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pageB.waitForTimeout(800);
  expect(expensePosts).toBe(1); // صفر سرقة — المحاولة الثانية لم تحدث

  resolveHold!();
  const draftKey = (await idbDraft(pageA, 'expense'))!.intent!.idempotencyKey;
  await expect(pageA.locator('[data-testid="connection-chip"]:visible').first()).toContainText('اكتملت', { timeout: 30_000 });
  expect(await dbCountForKey(draftKey)).toBe(1);
  expect(expensePosts).toBe(1);
  await pageA.close();
  await pageB.close();
});

test('C10b: موت التبويب المالك وسط محاولة — تبويب B يستعيد بنفس المفتاح والخادم يرد replay: سطر واحد', async ({ context }) => {
  await signInOperatorTo(context);
  const pageA = await context.newPage();
  await fillExpense(pageA, '66.00');

  let expensePosts = 0;
  await pageA.route('**/api/transactions/expense', async (route) => {
    expensePosts += 1;
    const upstream = await route.fetch().catch(() => null); // الخادم التزم فعلًا
    await new Promise((resolve) => setTimeout(resolve, 4_000)); // تبويب A «يموت» قبل الإقرار
    if (upstream) await route.fulfill({ response: upstream });
  });
  await pageA.locator('form.expense-form button[type="submit"]').click();
  await pageA.waitForTimeout(900); // طلب A وصل الخادم والتزامه وزّار — والرد لم يكتمل
  const draftKey = (await idbDraft(pageA, 'expense'))!.intent!.idempotencyKey;
  await pageA.close(); // موت A — القفل يتحرر فورًا، والعملية syncing يتيمة

  const pageB = await context.newPage();
  await pageB.goto(`${baseUrl}/expense`); // كنس B يكتشف اليتيم ويستكمل بنفس المفتاح
  await expect(pageB.locator('[data-testid="connection-chip"]:visible').first()).toContainText('اكتملت', { timeout: 45_000 });
  expect(await dbCountForKey(draftKey)).toBe(1); // التزام واحد رغم محاولتين
  expect(expensePosts).toBeGreaterThanOrEqual(1); // الاستعادة قد تسلك route A المحذوف مع الصفحة
  const opsB = await idbOps(pageB);
  expect(opsB.filter((op) => op.idempotencyKey === draftKey && op.status === 'acknowledged')).toHaveLength(1);
  await pageB.close();
});

test('C11: صرامة parked — دورتا مؤقت بلا إعادة، حساب آخر لا يستأنف، والحساب الصحيح يستأنف بـ POST واحد', async ({ context }) => {
  test.setTimeout(300_000);
  const { token, csrf } = await loginOnce();
  await context.addCookies([
    { name: 'kayyal_csrf', value: csrf, domain: 'localhost', path: '/', httpOnly: false },
    { name: 'kayyal_operator_session', value: token, domain: 'localhost', path: '/', httpOnly: true },
  ]);
  const page = await context.newPage();
  await fillExpense(page, '88.00');

  // إنهاء الجلسة خادميًا «خلف ظهر» الواجهة — المحاولة القادمة تواجه 401 حقيقيًا.
  // (حذف مباشر من قاعدة الاختبار كما في C5 — قاطع ومتحقق منه، بلا حساسية وسيط CSRF.)
  void token; void csrf;
  await t.admin.query('DELETE FROM app.sessions WHERE user_id = $1', [A.operatorId]);
  let expensePosts = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/transactions/expense') && request.method() === 'POST') expensePosts += 1;
  });
  await page.locator('form.expense-form button[type="submit"]').click();
  await expect.poll(async () => (await idbOps(page)).some((op) => op.status === 'parked'), { timeout: 30_000 }).toBe(true);
  const afterParking = expensePosts;

  // أكثر من دورة مؤقت + نبضات focus/online: لا إعادة محاولة إطلاقًا (توجيه 4).
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForTimeout(44_000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(2_000);
  expect(expensePosts).toBe(afterParking);

  // دخول حساب آخر (نطاق مختلف): الـresume يتحقق من /api/session الجديد — scope≠ ⇒ لا يتحرك شيء.
  await page.goto(`${baseUrl}/login`);
  await page.locator('details.login-operator > summary').click();
  const opForm = page.locator('form');
  await opForm.locator('input[name="operator_login_code"]').fill(loginCode2);
  await opForm.locator('input[name="display_name"]').fill('عامل آخر');
  await opForm.locator('input[name="pin"]').fill('4271');
  await opForm.locator('button[type="submit"]').click();
  await page.waitForURL(/\/today/, { timeout: 30_000 });
  await page.waitForTimeout(2_500); // resumeParkedIfSessionValid(scope2) رأفًا — لا شيء لنطاقه
  expect(expensePosts).toBe(afterParking);
  expect((await idbOps(page)).some((op) => op.status === 'parked')).toBe(true);

  // دخول الحساب الصحيح: تحقق جديد ناجح بنفس النطاق ⇒ استئناف وPOST واحد للتسوية.
  await page.goto(`${baseUrl}/login`);
  await page.locator('details.login-operator > summary').click();
  const opForm2 = page.locator('form');
  await opForm2.locator('input[name="operator_login_code"]').fill(loginCode);
  await opForm2.locator('input[name="display_name"]').fill('عامل متصفح');
  await opForm2.locator('input[name="pin"]').fill('4271');
  await opForm2.locator('button[type="submit"]').click();
  await page.waitForURL(/\/today/, { timeout: 30_000 });
  await expect.poll(async () => (await idbOps(page)).some((op) => op.status === 'acknowledged'), { timeout: 30_000 }).toBe(true);
  expect(expensePosts).toBe(afterParking + 1); // POST تسوية واحد لا أكثر
  const parkedKey = (await idbOps(page)).find((op) => op.status === 'acknowledged')!.idempotencyKey;
  expect(await dbCountForKey(parkedKey)).toBe(1);
  await page.close();
});
