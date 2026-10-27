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
let baseUrl: string;
let nextServer: ChildProcessWithoutNullStreams | undefined;
let loginCode: string;

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

/** دخول مركزي واحد للملف بالكامل — عدّاد الواسطة يقاوم الضغط المتسلسل (429). */
async function loginOnce(force = false): Promise<{ token: string; csrf: string; scope: string }> {
  if (cachedLogin && !force) return cachedLogin;
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
    const open = indexedDB.open('kayyal-offline', 1);
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
    const open = indexedDB.open('kayyal-offline', 1);
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
  await expect(page.getByTestId('connection-chip').first()).toContainText('غير متصل');

  // «أُغلق التطبيق مقطوعًا وفُتح لاحقًا بشبكة»: بلا Service Worker التنقل
  // يتطلب اتصالًا — القطع هنا كان قبل إرسال الطلب قطعيًا (يلتزم به العدّاد).
  expect(await dbCountForKey(draftBefore!.intent!.idempotencyKey)).toBe(0);
  await context.setOffline(false);
  // [تشخيص مؤقت] راقب مفتاح المسودة قبل/بعد إعادة الفتح لتحديد مصدر الاستراقاق:
  await page.reload();
  // الاستئناف التلقائي بنفس المفتاح حرفيًا + شارة الإقرار المرئية — وبعد الإقرار:
  await expect(page.getByTestId('connection-chip').first()).toContainText('اكتملت', { timeout: 30_000 });
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
  await expect(page.getByTestId('connection-chip').first()).toContainText('اكتملت', { timeout: 30_000 });
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
  await expect(page.getByTestId('connection-chip').first()).toContainText('غير متصل');
  await context.setOffline(false);
  // ضغطة ثانية محدقة تزامنًا مع الكنس التلقائي — قفل الطيران الواحد هو الحكم.
  // requestSubmit يختبر منطق الأزرار/الصندوق دون انتظار تفعيل واجهة الاستجابة.
  await page.evaluate(() => {
    const form = document.querySelector('form.expense-form');
    if (form instanceof HTMLFormElement) form.requestSubmit();
  });
  await expect(page.getByTestId('connection-chip').first()).toContainText('اكتملت', { timeout: 30_000 });
  await page.waitForFunction(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const open = indexedDB.open('kayyal-offline', 1);
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
  await expect(page2.getByTestId('connection-chip').first()).toBeVisible({ timeout: 15_000 });
  await context.setOffline(true);
  await page1.locator('form.expense-form button[type="submit"]').click();
  await expect(page1.getByTestId('connection-chip').first()).toContainText('غير متصل');
  await expect(page2.getByTestId('connection-chip').first()).toContainText('لم تُرسل', { timeout: 15_000 });
  await context.setOffline(false); // عودة الشبكة تضرب التبويبين معًا
  await expect(page1.getByTestId('connection-chip').first()).toContainText('اكتملت', { timeout: 40_000 });
  await expect(page2.getByTestId('connection-chip').first()).toContainText('اكتملت', { timeout: 40_000 });
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
  await expect(page.getByTestId('connection-chip').first()).toContainText('اكتملت', { timeout: 40_000 });
  expect(await dbCountForKey(key)).toBe(1);
  await page.close();
});

test('C6: تعارض يوم مغلق يبقى ظاهرًا بعد إعادة التحميل بسببه وإجراءاته المشروعة', async ({ context }) => {
  await signInOperatorTo(context);
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
  const page = await context.newPage();
  await fillExpense(page, '60.00');
  const draft = await idbDraft(page, 'expense');
  const key = draft!.intent!.idempotencyKey;
  await page.locator('form.expense-form button[type="submit"]').click();
  await expect(page.getByText(/تعارض يحتاج قرارك/)).toBeVisible({ timeout: 20_000 });
  expect(await dbCountForKey(key)).toBe(0); // تعارض = صفر توليد
  await page.reload();
  // بعد الإعادة: الرقاقة ما تزال تنادي بالنزاع، واللوحة تفصّله.
  await page.getByTestId('connection-chip').first().click();
  await expect(page.getByText(/اليوم مقفول|تعارض في البيانات/)).toBeVisible({ timeout: 15_000 });
  // الكنس لا يلمس التعارضات أبدًا (لا إعادة صامتة):
  await page.waitForTimeout(1_500);
  expect(await dbCountForKey(key)).toBe(0);
  await page.close();
});

test('C7: الخروج مع عمل غير محسوم — عدّاد ظاهر واختيار صريح موثق، لا مسح صامت', async ({ context }) => {
  await signInOperatorTo(context);
  const page = await context.newPage();
  await fillExpense(page, '77.00');
  await context.setOffline(true);
  await page.locator('form.expense-form button[type="submit"]').click();
  await expect(page.getByTestId('connection-chip').first()).toContainText('غير متصل');
  const draft = await idbDraft(page, 'expense');
  const key = draft!.intent!.idempotencyKey;

  await page.getByRole('button', { name: ar.auth.signOutAction }).first().click();
  // البوابة تعرض الحساب الدقيق قبل أي مسح:
  await expect(page.getByText(ar.signOutGate.pendingTitle)).toBeVisible();
  await expect(page.getByText(/1 عملية غير مؤكدة/)).toBeVisible();
  // التراجع يُبقي كل شيء:
  await page.getByRole('button', { name: ar.signOutGate.cancel }).click();
  expect(await dbCountForKey(key)).toBe(0);
  await expect(page.getByTestId('connection-chip').first()).toContainText('غير متصل');
  // القرار التدميري الصريح هو وحده من يمسح:
  await page.getByRole('button', { name: ar.auth.signOutAction }).first().click();
  await expect(page.getByText(ar.signOutGate.pendingTitle)).toBeVisible();
  await page.getByRole('button', { name: /أخرج واحذف المحلي نهائيًا/ }).click();
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
