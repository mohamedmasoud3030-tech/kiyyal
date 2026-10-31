/** Visual-only fixtures: never proves authentication or persistence.
 * Start a local Next server, then: node tests/ui/workspace-browser.mjs
 * Optional WORKSPACE_BROWSER_EXECUTABLE and WORKSPACE_BASE_URL.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const origin = process.env.WORKSPACE_BASE_URL ?? 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Fixtures must only run locally');
const browser = await chromium.launch({
  ...(process.env.WORKSPACE_BROWSER_EXECUTABLE ? { executablePath: process.env.WORKSPACE_BROWSER_EXECUTABLE } : {}),
});
const output = 'docs/ui-evidence';
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext();
  await context.addCookies([
    { name: 'kayyal_csrf', value: 'visual-fixture', url: origin },
    { name: 'kayyal_operator_session', value: 'visual-only', url: origin },
  ]);
  let mode = 'loaded';
  let role = 'owner';
  const transactions = [
    { id: 'fixture-sale', number: '1024', type: 'sale', status: 'posted', business_date: '2026-10-25', party: { name: 'شركة النور لإعادة التدوير', phone: null }, total_amount: '28500.00', expense_category: null },
    { id: 'fixture-purchase', number: '1023', type: 'purchase', status: 'pending_tare', business_date: '2026-10-25', party: { name: 'أحمد محمود', phone: null }, total_amount: '12450.00', expense_category: null },
  ];
  const stock = [
    { material_id: '1', material_name: 'نحاس أحمر', quantity_kg: '1250.500' },
    { material_id: '2', material_name: 'حديد خردة', quantity_kg: '8700.000' },
    { material_id: '3', material_name: 'ألمنيوم', quantity_kg: '420.250' },
  ];
  await context.route('**/api/session', route => route.fulfill({ json: { data: { role } } }));
  const respond = data => route => route.fulfill(mode === 'error' ? { status: 503, json: {} } : { json: { data: mode === 'empty' ? [] : data } });
  await context.route('**/api/transactions?*', respond(transactions));
  await context.route('**/api/stock', respond(stock));
  // Local screenshot builds use a dummy provider configuration; never sign in.
  await context.route('https://example.supabase.co/**', route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function noOverflow() {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
  }
  async function capture(name, fullPage = true) {
    await page.evaluate(() => document.fonts.ready);
    await noOverflow();
    await page.screenshot({ path: `${output}/${name}.png`, fullPage });
  }
  for (const [width, height] of [[1440, 1000], [375, 812], [768, 1024]]) {
    await page.setViewportSize({ width, height });
    for (const route of ['login', 'today']) {
      await page.goto(`${origin}/${route}`);
      if (route === 'today') await page.locator('.kpi-card').first().waitFor();
      else await page.locator('#owner-phone').waitFor();
      await capture(`${route}-${width}`);
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  const summary = page.locator('.navigation-overflow > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.navigation-overflow').getAttribute('open'), '');
  await page.locator('.navigation-overflow a[href="/history"]').waitFor({ state: 'visible' });
  await capture('mobile-more', false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.navigation-overflow').getAttribute('open'), null);
  assert.equal(await summary.evaluate(el => el === document.activeElement), true);
  mode = 'error';
  await page.reload();
  await page.getByRole('button', { name: 'حاول مرة أخرى' }).waitFor();
  await capture('today-error', false);
  mode = 'empty';
  await page.getByRole('button', { name: 'حاول مرة أخرى' }).click();
  await page.locator('.kpi-card').first().waitFor();
  assert.equal(await page.locator('.kpi-card__value').first().textContent(), '0');
  await capture('today-empty');
  mode = 'loaded';
  transactions[0].party.name = 'شركة تدوير المعادن والخامات الصناعية ذات الاسم العربي الطويل جداً';
  transactions[0].total_amount = '9876543210.99';
  await page.reload();
  await page.locator('.kpi-card').first().waitFor();
  await noOverflow();
  transactions[0].party.name = 'شركة النور لإعادة التدوير';
  transactions[0].total_amount = '28500.00';
  role = 'operator';
  await page.reload();
  await page.locator('.kpi-card').first().waitFor();
  assert.deepEqual(await page.locator('.app-shell__mobile-nav a').evaluateAll(links => links.map(a => a.getAttribute('href'))), ['/today', '/purchase', '/sale', '/history']);
  role = 'owner';
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await page.locator('.kpi-card').first().waitFor();
  await capture('today-dark');
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.app-shell__desktop-header').isVisible(), false);
  assert.equal(await page.locator('.app-shell__mobile-nav').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: responsive screenshots, no overflow, keyboard/Escape, retry, empty state, long values, operator boundaries, dark theme, print chrome, no runtime errors');
} finally { await browser.close(); }
