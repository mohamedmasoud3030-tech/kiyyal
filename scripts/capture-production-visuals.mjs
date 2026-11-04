#!/usr/bin/env node
/**
 * Browser evidence from the real Next pages and production React components.
 *
 * This is deliberately separate from capture-cleanup-visuals.mjs: that script
 * is a small CSS-only fixture. This script loads /reports, /regrade, and the
 * real regrade detail route, while only mocking their read-model HTTP responses.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.WORKSPACE_BASE_URL ?? 'http://127.0.0.1:3137';
const output = process.env.PRODUCTION_VISUAL_OUTPUT ?? 'ci/browser-evidence/production-components-current-2026-11-01';
const strict = process.env.PRODUCTION_VISUAL_STRICT !== 'false';
const reference = process.env.PRODUCTION_VISUAL_REFERENCE ?? 'current';
const fixtureScope = '0123456789abcdef01234567';
const sourceSha = process.env.PRODUCTION_VISUAL_SOURCE_SHA
  ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Production visual evidence must run against a local server');
mkdirSync(output, { recursive: true });

const materialId = '11111111-1111-4111-8111-111111111111';
const materialId2 = '22222222-2222-4222-8222-222222222222';
const longMaterialName = 'مادة صناعية ذات اسم عربي طويل جداً لاختبار حدود الجدول';
const reportRows = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', number: '1024', business_date: '2026-10-31',
    material_name: longMaterialName, quantity_kg: '1234567890.1200', price_per_kg: '987654.3210',
    value: '4500000.0000', party_name: 'شركة تدوير المعادن والخامات الصناعية ذات الاسم الطويل جداً', user_name: 'المستخدم الاختباري',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', number: '1023', business_date: '2026-10-30',
    material_name: 'نحاس أحمر', quantity_kg: '12.5000', price_per_kg: '700.0000',
    value: '8750.0000', party_name: 'أحمد محمود', user_name: 'المستخدم الاختباري',
  },
];
const reportSummary = { row_count: '2', total_quantity_kg: '1234567902.6200', total_amount: '4508750.0000', truncated: 'لا' };
const regradeDetail = {
  id: 'fixture-regrade', status: 'pending', business_date: '2026-10-31', number: null,
  allocation_method: 'proportional', unallocated_regrade_cost: '100000.0000', resolved_at: null,
  allocations: [
    { id: 'alloc-1', material_id: materialId, role: 'output', kg: '120.0000', ref_sell_price_snapshot: '500.0000', allocated_value: '60000.0000', allocated_cost_per_kg: '500.0000', sold_kg_at_resolution: '20.0000', unattributed_value: null, to_inventory_value: '100000.0000', is_cost_unallocated: false },
    { id: 'alloc-2', material_id: materialId2, role: 'output', kg: '0.5000', ref_sell_price_snapshot: null, allocated_value: null, allocated_cost_per_kg: null, sold_kg_at_resolution: null, unattributed_value: null, to_inventory_value: null, is_cost_unallocated: true },
  ],
  lines: [],
};

const state = { mode: 'loaded', reportMode: 'loaded' };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext();
const fontResponses = [];
context.on('response', (response) => {
  if (/\/fonts\/|\/icons\/|manifest\.webmanifest/.test(response.url())) {
    fontResponses.push({ url: response.url(), status: response.status() });
  }
});
await context.addCookies([
  { name: 'kayyal_csrf', value: 'visual-production-fixture', url: origin },
  { name: 'kayyal_operator_session', value: 'visual-production-fixture', url: origin },
]);
await context.route('**/api/session', (route) => route.fulfill({ json: { data: { role: 'owner', scope: fixtureScope } } }));
await context.route('**/api/materials*', (route) => state.mode === 'error'
  ? route.fulfill({ status: 503, json: {} })
  : route.fulfill({ json: { data: [
    { id: materialId, display_name: longMaterialName, ref_sell_price: '500.0000', default_pricing_unit: 'kg' },
    { id: materialId2, display_name: 'نحاس أحمر', ref_sell_price: null, default_pricing_unit: 'kg' },
  ] } }));
await context.route('**/api/stock*', (route) => state.mode === 'error'
  ? route.fulfill({ status: 503, json: {} })
  : route.fulfill({ json: { data: [
    { material_id: materialId, material_name: longMaterialName, quantity_kg: '1250.5000' },
    { material_id: materialId2, material_name: 'نحاس أحمر', quantity_kg: '8700.0000' },
  ] } }));
await context.route('**/api/parties*', (route) => route.fulfill({ json: { data: [{ id: 'party-1', name: 'شركة تدوير المعادن والخامات الصناعية ذات الاسم الطويل جداً', phone: null }] } }));
await context.route('**/api/users*', (route) => route.fulfill({ json: { data: [{ id: 'user-1', display_name: 'المستخدم الاختباري' }] } }));
await context.route('**/api/reports*', async (route) => {
  if (state.reportMode === 'loading') return new Promise(() => {});
  if (state.reportMode === 'error') return route.fulfill({ status: 503, json: {} });
  if (state.reportMode === 'empty') return route.fulfill({ json: { rows: [], summary: { row_count: '0', truncated: 'لا' } } });
  return route.fulfill({ json: { rows: reportRows, summary: reportSummary } });
});
await context.route('**/api/transactions/regrade/fixture-regrade*', (route) => route.fulfill({ json: regradeDetail }));
await context.route('**/api/auth/csrf', (route) => route.fulfill({ status: 200, headers: { 'set-cookie': 'kayyal_csrf=visual-production-fixture; Path=/' }, json: { data: { csrf: 'visual-production-fixture' } } }));
await context.route('https://example.supabase.co/**', (route) => route.abort());

const manifest = {
  evidenceVersion: 'production-components-v1',
  generatedAt: new Date().toISOString(),
  reference,
  sourceSha,
  origin,
  browser: browser.version(),
  strict,
  script: 'scripts/capture-production-visuals.mjs',
  dataMode: 'read-model fixture intercepted at HTTP boundaries; real Next routes and React pages are rendered; no hosted-data mutation',
  sourceRoutes: ['/reports', '/regrade', '/regrade/fixture-regrade'],
  sourceComponents: ['src/ui/components/ReportsContent.tsx', 'src/ui/components/RegradeDetailContent.tsx', 'src/ui/components/AppShell.tsx', 'src/ui/components/DataTable.tsx'],
  cases: [],
  assertionFailures: [],
};
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

async function waitFontsAndAssets() {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const checks = await page.evaluate(async () => {
    const [manifestResponse, iconResponse] = await Promise.all([
      fetch('/manifest.webmanifest', { cache: 'no-store' }),
      fetch('/icons/icon-192.png', { cache: 'no-store' }),
    ]);
    return {
      fontStatus: document.fonts.status,
      fontCheck: document.fonts.check('16px "Kayyal Arabic"'),
      manifestStatus: manifestResponse.status,
      iconStatus: iconResponse.status,
      fontEntries: performance.getEntriesByType('resource').filter((entry) => /\/fonts\/.*\.woff2/.test(entry.name)).map((entry) => entry.name),
    };
  });
  return checks;
}

async function collectAssertions(pageName, viewportName, media, theme, assets) {
  const checks = await page.evaluate(({ media }) => {
    const table = document.querySelector('table');
    const wrapper = table?.parentElement ?? null;
    const tableText = table?.textContent ?? '';
    const region = wrapper?.getAttribute('role') === 'region' && wrapper?.getAttribute('aria-label');
    const scopedHeaders = table ? [...table.querySelectorAll('th')].every((th) => th.getAttribute('scope') === 'col') : false;
    const captions = table ? table.querySelectorAll('caption').length : 0;
    return {
      documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyOverflowX: getComputedStyle(document.body).overflowX,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      appOverflowX: getComputedStyle(document.querySelector('.app-shell')).overflowX,
      viewportWidth: window.innerWidth,
      overflowElements: [...document.querySelectorAll('*')].map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, className: element.className, left: rect.left, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth };
      }).filter((item) => item.left < -1 || item.right > window.innerWidth + 1 || item.scrollWidth > window.innerWidth + 1).slice(0, 12),
      tableFound: Boolean(table),
      tableText,
      exactDecimal: tableText.includes('1234567890.1200'),
      exactUnit: tableText.includes('كجم'),
      captions,
      scopedHeaders,
      region,
      regionTabIndex: wrapper?.getAttribute('tabindex') === '0',
      regionScrollWidth: wrapper?.scrollWidth ?? 0,
      regionClientWidth: wrapper?.clientWidth ?? 0,
      activeElementIsRegion: document.activeElement === wrapper,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      printChromeHidden: media !== 'print' || (
        getComputedStyle(document.querySelector('.app-shell__sidebar') ?? document.body).display === 'none'
        && getComputedStyle(document.querySelector('.app-shell__mobile-nav') ?? document.body).display === 'none'
      ),
    };
  }, { media });
  const loadedTablePage = ['reports-loaded', 'reports-loaded-dark', 'regrade-detail', 'reports-print'].includes(pageName);
  const required = {
    documentNoOverflow: checks.documentNoOverflow,
    tableFound: !loadedTablePage || checks.tableFound,
    exactDecimal: !['reports-loaded', 'reports-loaded-dark', 'reports-print'].includes(pageName) || checks.exactDecimal,
    exactUnit: !pageName.startsWith('regrade-detail') || checks.exactUnit,
    fontLoaded: media === 'print' || (assets.fontStatus === 'loaded' && assets.fontCheck),
    localAssets: assets.manifestStatus === 200 && assets.iconStatus === 200 && assets.fontEntries.length > 0,
  };
  if (pageName.startsWith('reports-loaded') || pageName === 'regrade-detail') {
    required.caption = checks.captions === 1;
    required.scopedHeaders = checks.scopedHeaders;
    required.scrollRegionName = Boolean(checks.region);
    required.scrollRegionKeyboard = checks.regionTabIndex;
    required.focusedRegion = checks.activeElementIsRegion;
  }
  for (const [name, passed] of Object.entries(required)) if (!passed) manifest.assertionFailures.push({ pageName, viewportName, media, theme, name, checks });
  return checks;
}

async function capture(pageName, fileName, viewportName, viewport, media = 'screen', theme = 'light') {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ media, colorScheme: theme });
  await page.evaluate((value) => { document.documentElement.setAttribute('data-theme', value); }, theme);
  const assets = await waitFontsAndAssets();
  const checks = await collectAssertions(pageName, viewportName, media, theme, assets);
  const bodyText = await page.locator('body').innerText();
  const file = `${fileName}.png`;
  await page.screenshot({ path: join(output, file), fullPage: true });
  manifest.cases.push({ pageName, viewportName, viewport, media, theme, file, assets, checks, bodyTextSha256: createHash('sha256').update(bodyText).digest('hex'), fontResponses: fontResponses.splice(0) });
}

async function loadReports() {
  await page.goto(`${origin}/reports`, { waitUntil: 'domcontentloaded' });
  await page.locator('table').first().waitFor({ state: 'visible', timeout: 20_000 });
}
async function loadRegradeDetail() {
  await page.goto(`${origin}/regrade/fixture-regrade`, { waitUntil: 'domcontentloaded' });
  await page.locator('table').first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('table').first().locator('xpath=..').focus();
}

const viewports = { phone: { width: 375, height: 900 }, tablet: { width: 768, height: 1000 }, desktop: { width: 1440, height: 1100 } };
for (const [viewportName, viewport] of Object.entries(viewports)) {
  await loadReports();
  await page.locator('table').first().locator('xpath=..').focus();
  await capture('reports-loaded', `reports-loaded-light-${viewportName}`, viewportName, viewport, 'screen', 'light');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'region');
  if (strict) assert.equal(focused, true, 'reports scroll region must be keyboard-focusable');
  await page.keyboard.press('ArrowRight');
  if (strict) assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'region', 'keyboard focus must remain on the table scroll region');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await capture('reports-loaded-dark', `reports-loaded-dark-${viewportName}`, viewportName, viewport, 'screen', 'dark');
}

await loadRegradeDetail();
for (const [viewportName, viewport] of Object.entries(viewports)) {
  await capture('regrade-detail', `regrade-detail-light-${viewportName}`, viewportName, viewport, 'screen', 'light');
}

state.reportMode = 'empty';
await page.goto(`${origin}/reports`, { waitUntil: 'domcontentloaded' });
await page.locator('.state-panel').first().waitFor({ state: 'visible', timeout: 20_000 });
await capture('reports-empty', 'reports-empty-phone', 'phone', viewports.phone, 'screen', 'light');
state.reportMode = 'error';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.state-panel--danger').first().waitFor({ state: 'visible', timeout: 20_000 });
await capture('reports-error', 'reports-error-phone', 'phone', viewports.phone, 'screen', 'light');
state.reportMode = 'loading';
await page.goto(`${origin}/reports`, { waitUntil: 'domcontentloaded' });
await page.locator('.state-panel').first().waitFor({ state: 'visible', timeout: 20_000 });
await capture('reports-loading', 'reports-loading-phone', 'phone', viewports.phone, 'screen', 'light');

state.reportMode = 'loaded';
await loadReports();
await page.emulateMedia({ media: 'print', colorScheme: 'light' });
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await capture('reports-print', 'reports-print-desktop', 'desktop', viewports.desktop, 'print', 'light');

manifest.pageErrors = pageErrors;
if (strict) {
  assert.deepEqual(pageErrors, [], `production visual page errors: ${pageErrors.join('; ')}`);
  assert.equal(manifest.assertionFailures.length, 0, JSON.stringify(manifest.assertionFailures, null, 2));
}
writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await context.close();
await browser.close();
console.log(JSON.stringify({ reference, sourceSha, browser: manifest.browser, screenshots: manifest.cases.length, assertionFailures: manifest.assertionFailures.length, pageErrors: pageErrors.length, output }, null, 2));
