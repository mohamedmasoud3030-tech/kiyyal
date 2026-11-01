#!/usr/bin/env node
/**
 * Evidence guard for the 23 CSS selector families removed during the cleanup.
 * It intentionally checks source expressions and the CSS AST-shaped rule text,
 * not only a single grep of className="...".
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import ts from 'typescript';

const FAMILIES = [
  'app-shell__role',
  'directory-card__meta',
  'directory-card__muted',
  'directory-central-notice',
  'directory-detail-grid',
  'directory-filters',
  'directory-label',
  'directory-material-checks',
  'directory-private-note',
  'directory-relation-form',
  'regrade-approximate-notice',
  'regrade-defer-option',
  'regrade-deferred-note',
  'regrade-result-actions',
  'regrade-summary',
  'reports-filter-hint',
  'reports-notice',
  'settings-fields',
  'settings-form',
  'today-summary',
  'users-create-form',
  'users-list',
  'weight__unit',
];
const ROOTS = ['src', 'tests'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const BASELINE = 'cleanup-baseline-2026-11-01';
const cssFiles = ['src/app/globals.css', 'src/app/workspace.css'];
const boundary = (family, flags = 'g') => new RegExp(`(?<![A-Za-z0-9_-])${family}(?![A-Za-z0-9_-])`, flags);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (SOURCE_EXTENSIONS.has(extname(path))) files.push(path);
  }
  return files;
}

const sourceFiles = ROOTS.flatMap((root) => walk(root));
const sourceContents = sourceFiles.map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const sourceText = sourceContents.map(({ text }) => text).join('\n');
const currentCss = cssFiles.map((path) => readFileSync(path, 'utf8')).join('\n');

let jsxClassNameNodes = 0;
let classNamesCallNodes = 0;
const dynamicExpressionHits = [];
for (const { path, text } of sourceContents) {
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.text === 'className') {
      jsxClassNameNodes++;
      const expressionText = node.initializer ? node.initializer.getText(sourceFile) : '';
      for (const family of FAMILIES) if (boundary(family, '').test(expressionText)) dynamicExpressionHits.push(`${path}:className:${family}`);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'classNames') {
      classNamesCallNodes++;
      const expressionText = node.getText(sourceFile);
      for (const family of FAMILIES) if (boundary(family, '').test(expressionText)) dynamicExpressionHits.push(`${path}:classNames:${family}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}
const baselineCss = cssFiles.map((path) => execFileSync('git', ['show', `${BASELINE}:${path}`], { encoding: 'utf8' })).join('\n');
const failures = [];
const baselineCounts = {};
const sourceCounts = {};
const currentCssCounts = {};

for (const family of FAMILIES) {
  const re = boundary(family);
  baselineCounts[family] = (baselineCss.match(re) ?? []).length;
  sourceCounts[family] = (sourceText.match(boundary(family)) ?? []).length;
  currentCssCounts[family] = (currentCss.match(boundary(family)) ?? []).length;
  if (baselineCounts[family] === 0) failures.push(`${family}: absent from baseline CSS`);
  if (sourceCounts[family] !== 0) failures.push(`${family}: found in src/tests source (${sourceCounts[family]})`);
  if (currentCssCounts[family] !== 0) failures.push(`${family}: found in current CSS (${currentCssCounts[family]})`);
}

const classNameAttributeCount = jsxClassNameNodes;
const classNamesCallCount = classNamesCallNodes;
if (dynamicExpressionHits.length) failures.push(...dynamicExpressionHits.map((hit) => `${hit}: removed family appeared in a dynamic class expression`));
const interactiveOrThemeSelector = /(?:^|[,{\s])\.[A-Za-z0-9_-]+(?::(?:hover|focus|focus-visible|active|checked|disabled)|::[A-Za-z-]+)|@media\s+print|prefers-color-scheme|data-theme/;
const baselineTargetRules = baselineCss.split('}').filter((rule) => FAMILIES.some((family) => boundary(family).test(rule)));
const interactiveOrThemeHits = baselineTargetRules.filter((rule) => interactiveOrThemeSelector.test(rule)).length;

console.log(`families=${FAMILIES.length}`);
console.log(`source_files_scanned=${sourceFiles.length}`);
console.log(`className_attributes_scanned=${classNameAttributeCount}`);
console.log(`classNames_calls_scanned=${classNamesCallCount}`);
console.log(`baseline_families_present=${Object.values(baselineCounts).filter((count) => count > 0).length}`);
console.log(`source_family_hits=${Object.values(sourceCounts).reduce((sum, count) => sum + count, 0)}`);
console.log(`current_css_family_hits=${Object.values(currentCssCounts).reduce((sum, count) => sum + count, 0)}`);
console.log(`baseline_removed_family_rules_with_interaction_theme_or_print=${interactiveOrThemeHits}`);
if (failures.length) {
  console.error('FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('PASS: all 23 families were present in baseline CSS, absent from src/tests expressions, and absent from current CSS.');
