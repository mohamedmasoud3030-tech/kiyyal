#!/usr/bin/env node
/**
 * Deterministic CSS comparison fixture for the cleanup review.
 * It uses the same server-derived-looking strings for baseline and current CSS,
 * then captures RTL phone/tablet/desktop, light/dark, and print states.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = join(root, 'ci', 'browser-evidence', 'deep-cleanup-2026-11-01');
mkdirSync(outDir, { recursive: true });
const css = (ref, path) => ref === 'current'
  ? readFileSync(join(root, path), 'utf8')
  : execFileSync('git', ['show', `cleanup-baseline-2026-11-01:${path}`], { encoding: 'utf8' });

const fixture = (ref, theme) => `<!doctype html>
<html lang="ar" dir="rtl" data-theme="${theme}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deep cleanup visual fixture — ${ref}</title><style>${css(ref, 'src/app/globals.css')}\n${css(ref, 'src/app/workspace.css')}</style></head>
<body>
<div class="app-shell">
  <aside class="app-shell__sidebar"><div class="app-shell__brand"><a class="brand" href="#">كيّال</a><small>مراجعة التنظيف</small></div><nav class="app-shell__nav"><p class="app-shell__nav-caption">مساحات العمل</p><ul class="app-shell__nav-list"><li><a class="app-shell__nav-link app-shell__nav-link--current" href="#">التقارير</a></li><li><a class="app-shell__nav-link" href="#">المخزون</a></li><li><a class="app-shell__nav-link" href="#">الحركات</a></li></ul></nav><div class="app-shell__account"><span class="app-shell__avatar">م</span><div><strong>مالك الساحة</strong><p>owner</p></div></div></aside>
  <div class="app-shell__workspace"><header class="app-shell__mobile-header"><a class="brand" href="#">كيّال</a><button class="ui-button ui-button--secondary" type="button">القائمة</button></header><header class="app-shell__desktop-header"><p>الرئيسية <span>←</span> التقارير <span>←</span> المراجعة</p><div class="app-shell__toolbar"><button class="theme-toggle" type="button">ليلي</button><button class="ui-button ui-button--secondary" type="button">خروج</button></div></header>
    <main class="app-shell__content"><div class="page-container page-container--wide">
      <header class="page-header"><div class="page-header__identity"><p class="page-header__eyebrow">قراءة مالك مصرح بها</p><h1 class="page-header__title">التقارير</h1><p class="page-header__description">بيانات مشتقة من read model الخادمي، مع نصوص طويلة وقيم عشرية محفوظة كما وردت.</p></div><div class="page-header__action"><button class="ui-button ui-button--secondary" type="button">طباعة</button></div></header>
      <section class="ui-section ui-section--muted"><div class="ui-section__header"><div><h2 class="ui-section__title">الفلاتر</h2><p class="ui-section__description">نفس نطاق البيانات في baseline وبعد التنظيف.</p></div></div><form class="reports-filters"><label class="form-field"><span class="form-field__label">نوع التقرير</span><select class="text-input"><option>المشتريات</option></select></label><label class="form-field"><span class="form-field__label">من</span><input class="text-input" type="date" value="2026-10-01"></label><label class="form-field"><span class="form-field__label">إلى</span><input class="text-input" type="date" value="2026-10-31"></label><label class="form-field"><span class="form-field__label">الصنف</span><input class="text-input" value="كل الأصناف"></label><div class="reports-filters__actions"><button class="ui-button ui-button--primary" type="button">تطبيق</button><button class="ui-button ui-button--secondary" type="button">إعادة</button></div></form></section>
      <div class="reports-actions"><button class="ui-button ui-button--secondary" type="button">تصدير</button><button class="ui-button ui-button--secondary" type="button">مشاركة</button></div>
      <section class="ui-section ui-section--outlined"><div class="ui-section__header"><div><h2 class="ui-section__title">ملخص التقرير</h2><p class="ui-section__description">الأرقام لا تتغير بتغيير CSS.</p></div></div><dl class="reports-summary"><div><dt>عدد الصفوف</dt><dd>3</dd></div><div><dt>إجمالي الوزن</dt><dd><bdi dir="ltr">1234567890.1200 كجم</bdi></dd></div><div><dt>الإجمالي</dt><dd><bdi dir="ltr">4500000.0000 ج.م</bdi></dd></div><div><dt>مقتطع</dt><dd>لا</dd></div></dl></section>
      <section class="ui-section ui-section--outlined"><div class="ui-section__header"><div><h2 class="ui-section__title">صفوف المشتريات (3)</h2><p class="ui-section__description">جدول تقارير بحد scroll أفقي محصور.</p></div></div><div class="reports-table-wrap" role="region" tabindex="0" aria-label="تقرير المشتريات"><table class="reports-table"><caption class="visually-hidden">تقرير المشتريات</caption><thead><tr><th scope="col">التاريخ</th><th scope="col">الصنف</th><th scope="col">الكمية</th><th scope="col">السعر</th><th scope="col">القيمة</th></tr></thead><tbody><tr><td>2026-10-31</td><td>بلاستيك صناعي طويل الاسم للاختبار</td><td><bdi dir="ltr">1234567890.1200 كجم</bdi></td><td><bdi dir="ltr">987654.3210 ج.م/كجم</bdi></td><td><bdi dir="ltr">4500000.0000 ج.م</bdi></td></tr><tr><td>2026-10-30</td><td>نحاس أحمر</td><td><bdi dir="ltr">12.5000 كجم</bdi></td><td><bdi dir="ltr">700.0000 ج.م/كجم</bdi></td><td><bdi dir="ltr">8750.0000 ج.م</bdi></td></tr><tr><td>2026-10-29</td><td>حديد خردة</td><td><bdi dir="ltr">0.0000 كجم</bdi></td><td><bdi dir="ltr">0.0000 ج.م/كجم</bdi></td><td><bdi dir="ltr">0.0000 ج.م</bdi></td></tr></tbody></table></div></section>
      <section class="ui-section ui-section--outlined"><div class="ui-section__header"><div><h2 class="ui-section__title">تفاصيل إعادة التصنيف</h2><p class="ui-section__description">نفس allocation order والقيم المقربة/التقريبية.</p></div></div><div class="regrade-preview-table-wrap" role="region" tabindex="0" aria-label="مخرجات إعادة التصنيف"><table class="regrade-preview-table"><caption class="visually-hidden">مخرجات إعادة التصنيف</caption><thead><tr><th scope="col">المادة</th><th scope="col">الكمية الأصلية</th><th scope="col">المباع</th><th scope="col">المخزون</th></tr></thead><tbody><tr><td><bdi dir="ltr">material-very-long-id-0001</bdi></td><td><bdi dir="ltr">120.0000 كجم</bdi></td><td><bdi dir="ltr">20.0000 كجم</bdi></td><td><bdi dir="ltr">100000.0000 ج.م*</bdi></td></tr><tr><td>نحاس أحمر</td><td><bdi dir="ltr">0.5000 كجم</bdi></td><td>لم يُحل</td><td>—</td></tr></tbody></table></div></section>
      <div class="preview-content"><section class="ui-section ui-section--outlined"><div class="state-panel state-panel--warning"><strong class="state-panel__title">جار التحميل</strong><p class="state-panel__description">يتم جلب البيانات...</p></div><div class="state-panel state-panel--danger"><strong class="state-panel__title">تعذر تحميل البيانات</strong><p class="state-panel__description">رسالة خطأ طويلة قابلة للقراءة.</p></div></section><section class="ui-section ui-section--outlined"><h2 class="ui-section__title">القوائم والبيانات الطويلة</h2><ul class="inventory-list"><li class="inventory-list__item"><div class="inventory-list__identity"><strong class="inventory-list__name">مادة ذات اسم طويل جداً حتى لا تكسر الصفحة أو تتجاوز الحاوية</strong><span class="inventory-list__status inventory-list__status--warning">تحتاج مراجعة</span></div><div class="inventory-list__facts"><span class="inventory-list__fact">1234567890.1200 كجم</span><a class="inventory-list__detail-link" href="#">التفاصيل</a></div></li></ul><ul class="operational-list"><li class="operational-list__item"><div class="operational-list__primary"><strong>حركة مالية محمية</strong><span>وصف طويل لحالة العملية ومصدرها</span></div><div class="operational-list__meta"><span class="status-badge status-badge--success">مكتملة</span><a class="operational-list__detail-link" href="#">فتح</a></div></li></ul></section><div class="ui-section ui-section--outlined" role="dialog" aria-label="حوار خطأ"><h2 class="ui-section__title">تأكيد الإجراء</h2><p>تأكد من أن البيانات الظاهرة مصدرها الخادم.</p><div class="form-actions"><button class="ui-button ui-button--primary" type="button">تأكيد</button><button class="ui-button ui-button--secondary" type="button">إلغاء</button></div></div></div>
    </div></main><nav class="app-shell__mobile-nav"><ul class="app-shell__mobile-nav-list"><li><a class="app-shell__mobile-nav-link app-shell__nav-link--current" href="#">تقارير</a></li><li><a class="app-shell__mobile-nav-link" href="#">اليوم</a></li><li><a class="app-shell__mobile-nav-link" href="#">المزيد</a></li></ul></nav></div>
</div>
</body></html>`;

const viewports = { phone: { width: 375, height: 900 }, tablet: { width: 768, height: 1000 }, desktop: { width: 1440, height: 1100 } };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const manifest = { browser: browser.version(), generatedAt: new Date().toISOString(), cases: [] };
for (const ref of ['baseline', 'current']) {
  for (const theme of ['light', 'dark']) {
    for (const [viewportName, viewport] of Object.entries(viewports)) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      await page.setContent(fixture(ref, theme), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts?.ready);
      const layout = await page.evaluate(() => ({
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        scrollRegions: [...document.querySelectorAll('[role="region"]')].map((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
        exactValues: ['1234567890.1200 كجم', '4500000.0000 ج.م'].map((value) => document.body.innerText.includes(value)),
      }));
      const bodyText = await page.locator('body').innerText();
      const file = `${ref}-${theme}-${viewportName}.png`;
      const path = join(outDir, file);
      await page.screenshot({ path, fullPage: true });
      manifest.cases.push({ ref, theme, media: 'screen', viewportName, viewport, file, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), bodyTextSha256: createHash('sha256').update(bodyText).digest('hex'), layout: { ...layout, bodyTextSha256: createHash('sha256').update(bodyText).digest('hex') } });
      await page.close();
    }
    const page = await browser.newPage({ viewport: viewports.desktop, deviceScaleFactor: 1 });
    await page.setContent(fixture(ref, theme), { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.fonts?.ready);
    const layout = await page.evaluate(() => ({
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      scrollRegions: [...document.querySelectorAll('[role="region"]')].map((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
      exactValues: ['1234567890.1200 كجم', '4500000.0000 ج.م'].map((value) => document.body.innerText.includes(value)),
    }));
    const bodyText = await page.locator('body').innerText();
    const file = `${ref}-${theme}-print.png`;
    const path = join(outDir, file);
    await page.screenshot({ path, fullPage: true });
    manifest.cases.push({ ref, theme, media: 'print', viewportName: 'desktop', viewport: viewports.desktop, file, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), bodyTextSha256: createHash('sha256').update(bodyText).digest('hex'), layout });
    await page.close();
  }
}
await browser.close();
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ browser: manifest.browser, screenshots: manifest.cases.length, outDir }, null, 2));
