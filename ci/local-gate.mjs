#!/usr/bin/env node
/**
 * بوابة تحقق محلية موثقة (قرار المالك 2026-10-25، منقّحة 2026-10-26 الملاحظة 7).
 *
 * الأنماط:
 *  - افتراضي (تطوير): كل الخطوات تعمل، بما فيها الثقيلة. النتيجة «PASS كامل»
 *    فقط إن اخضرّ الجميع، و«FAIL» عند أي سقوط. الخروج 0/1.
 *  - GATE_SKIP_HEAVY=1 (حلقة تطوير سريعة، مصرّح بها للبيئات الصغيرة): الخطوات
 *    الثقيلة تُتخطّى مع توثيق السبب ⇒ النتيجة «PARTIAL» — لا تُوصف أبدًا بنجاح
 *    كامل، والخروج 0 فقط إن اخضرّ كل ما نُفّذ.
 *  - GATE_RELEASE=1 (وضع الإصدار الصارم): لا تخطٍّ مسموحًا أصلًا. إن ضُبط
 *    GATE_SKIP_HEAVY معًا أو كانت الشجرة غير نظيفة ⇒ «BLOCKED» بخروج 2 دون
 *    ادعاء نجاح. أي سقوط ⇒ FAIL بخروج 1. PASS كامل ⇒ خروج 0.
 *
 * تسجّل لكل خطوة: أمر التشغيل · كود الخروج · المدة · ملف اللوج، ثم manifest
 * بيئة وهوية الكومِت وحالة الشجرة والنتيجة الإجمالية الدقيقة اللفظ.
 */
import { spawnSync, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const steps = [
  { name: 'typecheck',            cmd: 'npm run typecheck' },
  { name: 'guard-decimal',        cmd: 'npm run guard:decimal' },
  { name: 'test-unit-domain',     cmd: 'npm run test:unit' },
  { name: 'test-db-from-zero',    cmd: 'npm run test:db' },
  { name: 'test-rls',             cmd: 'npm run test:rls' },
  { name: 'test-auth',            cmd: 'npm run test:auth' },
  { name: 'test-atomicity',       cmd: 'npm run test:atomicity' },
  { name: 'test-ui-foundation',   cmd: 'npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx' },
  { name: 'test-e2e-day',         cmd: 'npx vitest run tests/e2e-day' },
  { name: 'test-routes-http',     cmd: 'npx vitest run tests/routes' },
  {
    name: 'test-ui-liveflow', cmd: 'npx vitest run tests/ui/operator-live-flow.test.tsx', heavy: true,
    envNote: 'مُثبت نجاحه محليًا 15/15 بخادم Next حي (2026-10-26، ~17s) بعد إصلاح محاكاة المزوّد — نسبته إلى الذاكرة كانت خاطئة وصُحّحت بالتشخيص الفردي. يبقى heavy لتسريع الحلقات فقط، ولا يُتخطّى في وضع الإصدار.',
  },
  {
    name: 'full-vitest', cmd: 'npm test', heavy: true,
    envNote: 'السويت الكامل (~3 دقائق) ويشمل خادم Next وحزم routes — تنجح جميعها منفردة بعد إصلاحات 2026-10-26؛ يُتخطّى فقط في حلقات التطوير السريعة المصرّح بها، ولا يُتخطّى في وضع الإصدار.',
  },
  {
    name: 'browser-journey', cmd: 'npx playwright test', heavy: true,
    envNote: 'رحلة المتصفح الفعلية (دخول/تسجيل/حفظ/إعادة تحميل/إيصال/خروج/دخول) بخادم Next وChromium حقيقيين — مُثبتة محليًا 2026-10-26 (1 passed، 6 لقطات ci/browser-evidence/)؛ تتطلب `npx playwright install chromium` + install-deps في البيئات العارية. تبقى heavy للحلقات السريعة فقط، ولا تُتخطّى في وضع الإصدار.',
  },
  {
    name: 'production-build', cmd: 'npm run build', heavy: true,
    envNote: 'أُثبت نجاحه محليًا في هذا الصندوق 2026-10-26 (exit 0، ~24s — ci/diagnostics/build-success-2026-10-26.log) بعد إصلاحات الحزم؛ الادعاء القديم بالاستحالة كان نسبة متعجلة وصُحّح بالقياس. يبقى heavy لتسريع حلقات التطوير فقط، ولا يُتخطّى في وضع الإصدار.',
  },
];

const skipHeavy = process.env.GATE_SKIP_HEAVY === '1';
const release = process.env.GATE_RELEASE === '1';
const sha = execSync('git rev-parse HEAD').toString().trim();
const shortSha = sha.slice(0, 8);
const dirty = execSync('git status --porcelain').toString().trim().length > 0;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = `ci/gate-results/${stamp}Z-${shortSha}${release ? '-release' : ''}`;
mkdirSync(dir, { recursive: true });

// وضع الإصدار الصارم يرفض مزيج «تخطٍّ + ادعاء إصدار» قبل أي تشغيل.
const preBlocked = release && (skipHeavy || dirty);
const blockReason = !preBlocked ? '' : [
  skipHeavy ? 'GATE_SKIP_HEAVY=1 مضبوط': null,
  dirty ? 'شجرة العمل غير نظيفة' : null,
].filter(Boolean).join(' · ');

const rows = [];
let failed = false;
if (!preBlocked) {
  for (const step of steps) {
    if (step.heavy && skipHeavy && !release) {
      rows.push({ ...step, code: null, ms: 0, note: `مُتخطّى مصرّح (GATE_SKIP_HEAVY=1، وضع التطوير) — ${step.envNote ?? ''}` });
      continue;
    }
    const t0 = Date.now();
    const run = spawnSync(step.cmd, { shell: true, encoding: 'utf8', env: process.env });
    const ms = Date.now() - t0;
    const out = (run.stdout || '') + (run.stderr || '');
    writeFileSync(`${dir}/${step.name}.log`, out);
    const code = typeof run.status === 'number' ? run.status : 127;
    rows.push({ ...step, code, ms, out });
    if (code !== 0) failed = true;
  }
}

const env = {
  node: process.version,
  npm: execSync('npm -v').toString().trim(),
  uname: execSync('uname -srm').toString().trim(),
  ldLibraryPath: process.env.LD_LIBRARY_PATH ?? '(empty)',
  memMb: Math.round((execSync("grep MemTotal /proc/meminfo | awk '{print $2}'").toString().trim()) / 1024),
};

const skippedCount = rows.filter((r) => r.code === null).length;
const executed = rows.filter((r) => r.code !== null);
const verdict = preBlocked
  ? '⛔ BLOCKED — وضع الإصدار الصارم رفض التشغيل: ' + blockReason
  : failed
    ? '❌ GATE FAIL — سقطت خطوة منفّذة واحدة على الأقل'
    : skippedCount > 0
      ? '⚠️ PARTIAL — كل ما نُفّذ أخضر، مع فحوص متخطّاة موثقة (ليس نجاحًا كاملًا)'
      : '✅ GATE PASS كامل — كل الفحوص الإلزامية نُفّذت واخضرّت';

const lines = [
  `# محضر بوابة محلية — ${stamp}Z${release ? ' (وضع الإصدار)' : ''}`,
  ``,
  `| الحقل | القيمة |`,
  `|---|---|`,
  `| commit | \`${sha}\`${dirty ? ' — شجرة غير نظيفة' : ' — شجرة نظيفة'} |`,
  `| node | ${env.node} |`,
  `| npm | ${env.npm} |`,
  `| نظام | ${env.uname} · RAM ${env.memMb}MB |`,
  `| LD_LIBRARY_PATH | ${env.ldLibraryPath} |`,
  `| النمط | ${release ? 'RELEASE صارم (لا تخطٍّ)' : skipHeavy ? 'تطوير سريع (GATE_SKIP_HEAVY)' : 'تطوير كامل'} |`,
  ``,
  `| الخطوة | الأمر | الخروج | المدة |`,
  `|---|---|---|---|`,
];
for (const r of rows) {
  if (r.code === null) lines.push(`| ${r.name} | \`${r.cmd}\` | ⏭️ | — |`);
  else lines.push(`| ${r.name} | \`${r.cmd}\` | ${r.code === 0 ? '✅ 0' : `❌ ${r.code}`} | ${(r.ms / 1000).toFixed(1)}s |`);
}
if (preBlocked) lines.push('| — | لم يُنفّذ أي فحص | ⛔ | — |');
lines.push(`\n**النتيجة الإجمالية: ${verdict}**`);
const skipped = rows.filter((r) => r.note).map((r) => `- ${r.name}: ${r.note}`).join('\n');
if (skipped) lines.push(`\n## متخطّى في هذا التشغيل (مع سبب موثق)\n${skipped}`);
writeFileSync(`${dir}/MANIFEST.md`, lines.join('\n'));
console.log(lines.join('\n'));
process.exit(preBlocked ? 2 : failed ? 1 : 0);
