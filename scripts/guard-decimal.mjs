#!/usr/bin/env node
/**
 * Automated guard for ADR-0004 (decimal arithmetic) and FRONTEND_RULES (RTL-safe CSS).
 * Fails the build — a convention that is not enforced is not a control.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['src'];
const ALLOWLIST = new Set(['src/domain/decimal.ts']); // the one place primitives are defined

const RULES = [
  { id: 'no-parseFloat', re: /\bparseFloat\s*\(/, msg: 'parseFloat is banned (ADR-0004). Use the decimal helpers.' },
  { id: 'no-parseInt-money', re: /\bparseInt\s*\([^)]*(?:amount|price|total|cost|kg|weight)/i, msg: 'parseInt on a money/weight value is banned (ADR-0004).' },
  { id: 'no-Number-cast', re: /\bNumber\s*\(\s*(?!.*(?:index|length|count|page|limit))/, msg: 'Number() is banned in the domain (ADR-0004). Keep decimals as strings.' },
  { id: 'no-float-type', re: /:\s*number\s*;?\s*\/\/\s*(?:money|amount|kg|weight|price|cost)/i, msg: 'A money or weight value must never be typed as number.' },
  { id: 'no-toFixed-on-number', re: /\b\d+(\.\d+)?\.toFixed\(/, msg: 'Rounding must go through the central helpers.' },
  { id: 'rtl-physical-margin', re: /className="[^"]*\b(ml-|mr-|pl-|pr-|left-|right-)\d/, msg: 'Physical direction classes are banned. Use logical properties (ms-, me-, ps-, pe-).' },
  { id: 'no-service-role', re: /SUPABASE_SERVICE_ROLE|service_role/, msg: 'service_role is forbidden in runtime code (ADR-0003, R-09).' },
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['.ts', '.tsx'].includes(extname(p))) out.push(p);
  }
  return out;
}

let violations = 0;
for (const root of ROOTS) {
  let files = [];
  try { files = walk(root); } catch { continue; }
  for (const file of files) {
    const normalized = file.split('\\').join('/');
    if (ALLOWLIST.has(normalized)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
      for (const rule of RULES) {
        if (rule.re.test(line)) {
          console.error(`${file}:${i + 1}  [${rule.id}]  ${rule.msg}`);
          console.error(`    ${line.trim()}`);
          violations++;
        }
      }
      const isUiSource = normalized.startsWith('src/app/') || normalized.startsWith('src/ui/components/');
      if (isUiSource && /[\u0600-\u06ff]/.test(line)) {
        console.error(`${file}:${i + 1}  [externalized-ui-copy]  UI copy must live in src/ui/copy/.`);
        console.error(`    ${line.trim()}`);
        violations++;
      }
    });
  }
}

if (violations > 0) {
  console.error(`\n✖ decimal/RTL guard: ${violations} violation(s). See docs/CODING_RULES.md.`);
  process.exit(1);
}
console.log('✓ decimal/RTL guard: clean');
