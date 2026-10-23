/**
 * Real browser proof for the implemented shared-device operator workflow.
 *
 * The spec starts a disposable real PostgreSQL instance and an actual Next
 * development server. It intentionally does not mock fetch, React hooks, or
 * route handlers: a successful save is verified again through both a reload and
 * a direct database query. Owner browser SSO is separately documented as an
 * environment-limited integration because this checkout has no disposable
 * Supabase tenant credentials.
 */
import { createServer, type Server } from 'node:net';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';

import { expect, test } from '@playwright/test';

import { hashPin } from '../../src/auth/hash.js';
import { ar } from '../../src/ui/copy/ar.js';
import { freshRealDatabase, seedYard, stopServer, type Seed, type TestDb } from '../db/pg-harness.js';

let t: TestDb;
let operator: Seed;
let loginCode: string;
let baseUrl: string;
let nextServer: ChildProcessWithoutNullStreams | undefined;

async function freePort(): Promise<number> {
  const probe: Server = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('could not allocate test port');
  const { port } = address;
  probe.close();
  await once(probe, 'close');
  return port;
}

async function waitForApplication(url: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/login`, { redirect: 'manual' });
      if (response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next test server did not become ready: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
}

async function stopNextServer(): Promise<void> {
  if (!nextServer || nextServer.exitCode !== null) return;
  nextServer.kill('SIGTERM');
  await Promise.race([
    once(nextServer, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (nextServer.exitCode === null) nextServer.kill('SIGKILL');
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  t = await freshRealDatabase();
  operator = await seedYard(t.admin, 'متصفح', await hashPin('4271'));
  loginCode = (await t.admin.query<{ operator_login_code: string }>(
    'SELECT operator_login_code FROM app.yards WHERE id = $1', [operator.yardId],
  )).rows[0]!.operator_login_code;
  const port = await freePort();
  // Keep the browser URL aligned with Next dev's normalized request host so
  // the real Origin/CSRF comparison uses one canonical origin.
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

  nextServer = spawn(process.execPath, [
    './node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port),
  ], {
    cwd: process.cwd(), env: environment, stdio: 'pipe',
  });
  nextServer.stderr.on('data', () => undefined);
  nextServer.stdout.on('data', () => undefined);
  await waitForApplication(baseUrl);
});

test.afterAll(async () => {
  await stopNextServer();
  await t?.close();
  await stopServer();
});

test('operator login, protected deep-link, purchase persistence, reload, responsive shell, and sign-out', async ({ page }) => {
  await page.goto(`${baseUrl}/login`);
  const operatorForm = page.locator('form').filter({ has: page.locator('input[name="operator_login_code"]') });
  await expect(operatorForm).toBeVisible();
  await expect(operatorForm.locator('button[type="submit"]')).toBeEnabled();
  await operatorForm.locator('input[name="operator_login_code"]').fill(loginCode);
  await operatorForm.locator('input[name="display_name"]').fill('عامل متصفح');
  await operatorForm.locator('input[name="pin"]').fill('4271');
  await operatorForm.locator('button[type="submit"]').click();

  await page.waitForURL(`${baseUrl}/today`);
  await expect(page.getByRole('heading', { name: ar.today.title })).toBeVisible();
  await expect(page.locator('main')).toContainText(ar.today.noTransactionsTitle);

  await page.goto(`${baseUrl}/purchase`);
  const transactionForm = page.locator('form.transaction-entry');
  await expect(transactionForm).toBeVisible();
  await transactionForm.locator('select[name="line-0-material"]').selectOption(operator.copperId);
  await transactionForm.locator('input[name="line-0-gross"]').fill('10.00');
  await transactionForm.locator('input[name="line-0-price"]').fill('20.0000');
  await transactionForm.locator('input[name="amount_cash"]').fill('0.00');
  await transactionForm.locator('input[name="note"]').fill('شراء مثبت في المتصفح');
  await transactionForm.locator('button[type="submit"]').click();

  await expect(page.getByRole('heading', { name: ar.transactionEntry.savedTitle })).toBeVisible();
  await expect(page.locator('.transaction-result__amount')).toContainText('200.00');
  const transactionHref = await page.locator('a').filter({ hasText: ar.transactionEntry.viewTransactionAction }).getAttribute('href');
  expect(transactionHref).toMatch(/^\/transactions\/[0-9a-f-]{36}$/);
  const transactionId = transactionHref!.split('/').at(-1)!;

  const persisted = await t.admin.query<{ total_amount: string; status: string; n: string }>(
    `SELECT total_amount::text, status,
            (SELECT count(*)::text FROM app.transaction_lines WHERE transaction_id = t.id) AS n
       FROM app.transactions t WHERE id = $1`,
    [transactionId],
  );
  expect(persisted.rows[0]).toEqual({ total_amount: '200.00', status: 'posted', n: '1' });

  await page.goto(`${baseUrl}/today`);
  await expect(page.getByRole('heading', { name: ar.today.title })).toBeVisible();
  await expect(page.locator('main')).toContainText('شراء مثبت في المتصفح');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.app-shell__mobile-header')).toBeVisible();
  await expect(page.locator('main')).toContainText('شراء مثبت في المتصفح');
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);

  await page.getByRole('button', { name: ar.auth.signOutAction }).click();
  await page.waitForURL(`${baseUrl}/login`);
  await page.goto(`${baseUrl}/today`);
  await page.waitForURL(`${baseUrl}/login`);
});
