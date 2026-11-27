/**
 * Real browser proof (mobile viewport) for the plain-Arabic onboarding slice:
 * per-page one-line guides, the guided first-run page shell, installable-PWA
 * wiring (manifest, service worker, viewport) and phone-sized tap targets.
 * Runs against a disposable real PostgreSQL and a production `next start`.
 */
import { createServer, type Server } from 'node:net';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { hashPin } from '../../src/auth/hash.js';
import { ar } from '../../src/ui/copy/ar.js';
import { freshRealDatabase, seedYard, stopServer, type Seed, type TestDb } from '../db/pg-harness.js';

let t: TestDb;
let operator: Seed;
let loginCode: string;
let baseUrl: string;
let nextServer: ChildProcessWithoutNullStreams | undefined;
const evidenceDir = process.env.BROWSER_EVIDENCE_DIR ?? 'ci/browser-evidence/latest';

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
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next test server did not become ready: ${lastError instanceof Error ? lastError.message : 'unknown'}`);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(360_000);
  t = await freshRealDatabase();
  operator = await seedYard(t.admin, 'جوال', await hashPin('4271'));
  loginCode = (await t.admin.query<{ operator_login_code: string }>(
    'SELECT operator_login_code FROM app.yards WHERE id = $1', [operator.yardId],
  )).rows[0]!.operator_login_code;
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
  const build = existsSync('.next/BUILD_ID') ? { status: 0, stderr: '', stdout: '' } : spawnSync(process.execPath, ['./node_modules/next/dist/bin/next', 'build'],
    { cwd: process.cwd(), env: environment, stdio: 'pipe', timeout: 240_000 });
  if ((build.status ?? 1) !== 0) {
    throw new Error(`next build failed inside the mobile journey:\n${String(build.stderr)}\n${String(build.stdout)}`);
  }
  nextServer = spawn(process.execPath,
    ['./node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: process.cwd(), env: environment, stdio: 'pipe' });
  nextServer.stderr.on('data', () => undefined);
  nextServer.stdout.on('data', () => undefined);
  await waitForApplication(baseUrl);
});

test.afterAll(async () => {
  if (nextServer && nextServer.exitCode === null) {
    nextServer.kill('SIGTERM');
    await Promise.race([once(nextServer, 'exit'), new Promise((r) => setTimeout(r, 10_000))]);
    if (nextServer.exitCode === null) nextServer.kill('SIGKILL');
  }
  await t?.close();
  await stopServer();
});

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, video: 'off', trace: 'off' });

test('mobile PWA wiring, page guide, first-run shell and phone tap targets', async ({ page }) => {
  await mkdir(evidenceDir, { recursive: true });

  // PWA installability wiring: manifest, service worker and mobile viewport meta.
  const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
  expect(manifest.status).toBe(200);
  const manifestBody = await manifest.json() as { name?: string; display?: string; start_url?: string };
  expect(manifestBody.display).toBe('standalone');
  expect(manifestBody.start_url).toBe('/today');
  const sw = await fetch(`${baseUrl}/sw.js`);
  expect(sw.status).toBe(200);

  await page.goto(`${baseUrl}/login`);
  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewportMeta).toContain('width=device-width');
  expect(viewportMeta).toContain('viewport-fit=cover');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);

  // Operator login on the phone viewport.
  await page.locator('details.login-operator > summary').click();
  const form = page.locator('form').filter({ has: page.locator('input[name="operator_login_code"]') });
  await form.locator('input[name="operator_login_code"]').fill(loginCode);
  await form.locator('input[name="display_name"]').fill('عامل جوال');
  await form.locator('input[name="pin"]').fill('4271');
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(`${baseUrl}/today`);

  // One-line plain-Arabic guide on the page, dismissible.
  const guide = page.getByRole('note');
  await expect(guide).toContainText(ar.guides.lines['/today']);
  await page.screenshot({ path: `${evidenceDir}/mobile-01-today-guide.png` });
  await guide.getByRole('button', { name: ar.guides.dismiss }).click();
  await expect(page.getByRole('note')).toHaveCount(0);

  // Bottom app-like navigation: phone-sized tap targets (>= 44px tall).
  const navLinks = page.locator('.app-shell__mobile-nav a');
  expect(await navLinks.count()).toBeGreaterThanOrEqual(4);
  const heights: number[] = [];
  for (const handle of await navLinks.elementHandles()) {
    const box = await handle.boundingBox();
    if (box) heights.push(box.height);
  }
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);

  // Guided first-run page exists and fails safe for operators (owner-only flow).
  await page.goto(`${baseUrl}/start`);
  await expect(page.getByText(ar.firstRun.ownerOnly)).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/mobile-02-start-operator.png` });

  // The first-run status endpoint shape the hook depends on, against the real DB.
  const purchases = await page.evaluate(async (url) => {
    const response = await window.fetch(url, { credentials: 'same-origin' });
    return { status: response.status, body: await response.json() as { data?: unknown } };
  }, `${baseUrl}/api/transactions?type=purchase&limit=1`);
  expect(purchases.status).toBe(200);
  expect(Array.isArray(purchases.body.data)).toBe(true);
});
