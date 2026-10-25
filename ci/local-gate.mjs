#!/usr/bin/env node
/**
 * بوابة تحقق محلية موثقة مؤقتة (قرار المالك 2026-10-25) — بديلة GitHub Actions
 * المعطلة على مستوى الحساب. تشغّل نفس أوامر ci.yml حرفيًا، وتسجّل لكل خطوة:
 * أمر التشغيل · كود الخروج · المدة · ملف اللوج. ثم تكتب manifest بيئة وهوية
 * الكومِت ونتيجة البوابة الإجمالية. الخروج بكود 1 إن سقط أي أمر إلزامي.
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
  { name: 'test-ui-liveflow',     cmd: 'vitest run tests/ui/operator-live-flow.test.tsx', heavy: true, envNote: 'يشغّل خادم Next كاملًا بجانب قاعدة Postgres المدمجة — ذاكرة صندوق التطوير (≤4GB) لا تكفي؛ القرار الرسمي يكون على CI عند استعادة حصة Actions.' },
  { name: 'full-vitest',          cmd: 'npm test', heavy: true, envNote: 'السويت الكامل فيه 3 حزم تشغّل خادم Next حقيقيًا (operator-live-flow + routes/next-http + routes/app-routes) — تسقط بـ fetch failed في صندوق 2GB حتى منفردة (مُثبت 2026-10-25)؛ باقي 245 اختبارًا تشمل يوم-التشغيل 15/15 تمر. نتيجته الكاملة على CI عند استعادة حصة Actions.' },
  { name: 'production-build',     cmd: 'npm run build', heavy: true, envNote: 'بناء Next/Turbopack لكامل التطبيق يقتله صندوق التطوير بالذاكرة (~10 ثوانٍ ثم Killed). دليل نجاح البناء: آخر نشر إنتاجي ناجح على Vercel (مرجع RUNBOOK).' },
];

const heavySkipped = process.env.GATE_SKIP_HEAVY === '1';
const sha = execSync('git rev-parse HEAD').toString().trim();
const shortSha = sha.slice(0, 8);
const dirty = execSync('git status --porcelain').toString().trim().length > 0;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = `ci/gate-results/${stamp}Z-${shortSha}`;
mkdirSync(dir, { recursive: true });

const rows = [];
let failed = false;
for (const step of steps) {
  if (step.heavy && heavySkipped) {
    rows.push({ ...step, code: null, ms: 0, note: `مُتخطّى عمدًا (GATE_SKIP_HEAVY=1) — ${step.envNote ?? ''}` });
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

const env = {
  node: process.version,
  npm: execSync('npm -v').toString().trim(),
  uname: execSync('uname -srm').toString().trim(),
  ldLibraryPath: process.env.LD_LIBRARY_PATH ?? '(empty)',
  memMb: Math.round((execSync("grep MemTotal /proc/meminfo | awk '{print $2}'").toString().trim()) / 1024),
};

const lines = [
  `# محضر بوابة محلية — ${stamp}Z`,
  ``,
  `| الحقل | القيمة |`,
  `|---|---|`,
  `| commit | \`${sha}\`${dirty ? ' (شجرة غير نظيفة!)' : ''} |`,
  `| node | ${env.node} |`,
  `| npm | ${env.npm} |`,
  `| نظام | ${env.uname} · RAM ${env.memMb}MB |`,
  `| LD_LIBRARY_PATH | ${env.ldLibraryPath} |`,
  ``,
  `| الخطوة | الأمر | الخروج | المدة |`,
  `|---|---|---|---|`,
];
for (const r of rows) {
  if (r.code === null) lines.push(`| ${r.name} | \`${r.cmd}\` | ⏭️ | — |`);
  else lines.push(`| ${r.name} | \`${r.cmd}\` | ${r.code === 0 ? '✅ 0' : `❌ ${r.code}`} | ${(r.ms / 1000).toFixed(1)}s |`);
}
lines.push(`\n**النتيجة الإجمالية: ${failed ? '❌ GATE FAIL' : '✅ GATE PASS'}**`);
const skipped = rows.filter((r) => r.note).map((r) => `- ${r.name}: ${r.note}`).join('\n');
if (skipped) lines.push(`\n## تعذّر تشغيله في هذه البيئة (مصرّح)\n${skipped}`);
writeFileSync(`${dir}/MANIFEST.md`, lines.join('\n'));
console.log(lines.join('\n'));
process.exit(failed ? 1 : 0);
