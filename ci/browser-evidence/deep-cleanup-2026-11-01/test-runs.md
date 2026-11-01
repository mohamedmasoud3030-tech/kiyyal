# Deep cleanup test ledger — 2026-11-01

All database-backed commands below used Node `v24.22.2`, npm `11.19.1`, the checked ICU 60 artifact, and the same repository checkout unless marked `baseline`. No credentials or hosted data were used.

## Environment preparation

```text
node --version                         v24.22.2
npm --version                          11.19.1
@playwright/test                       1.63.0
Chromium                                153.0.8010.12 (Playwright v1243)
embedded-postgres                      18.4.0-beta.17
libicu60.deb SHA-256                   f01f61f57e63dc905e02e6441d10370fe0c79e43e70e6f5fe24b342fd2633209
npm ci --ignore-scripts                 PASS; found 0 vulnerabilities
```

The repeatable local wrapper is `scripts/with-embedded-postgres-runtime.sh`; CI uses the same pinned Debian package and checksum.

## Cleanup checkout

| Command | Result |
|---|---|
| `npm run lint` | PASS — typecheck + decimal/RTL guard |
| `npm run test:unit` | PASS — 2 files, 36/36 |
| `npm run build` | PASS — Next 16.4.3, TypeScript, static generation and route collection |
| `node scripts/verify-css-cleanup.mjs` | PASS — 23/23 families, 0 source hits, 0 current CSS hits |
| `npx vitest run tests/ui/data-table.test.tsx tests/ui/foundation.test.tsx tests/ui/workspace.test.tsx` | PASS — 3 files, 24/24 |
| `npm audit --audit-level=high` | PASS — 0 vulnerabilities |

## Full Vitest comparison

### Cleanup tree

Command: `npm test`

```text
Test Files  1 failed | 25 passed (27)
Tests       1 failed | 308 passed (325)
Errors      1 unhandled worker error
```

The failed test is the existing HTTP route journey in `tests/routes/next-http.test.ts`; the worker error is an unexpected Vitest worker exit during the same suite. The database-backed suites and live operator-flow suite completed after the ICU fix.

### Baseline `cleanup-baseline-2026-11-01` → `1b3186d`

Command: `npx vitest run` on the same Node24/ICU environment.

```text
Test Files  3 failed | 23 passed (26)
Tests       1 failed | 299 passed | 22 skipped (322)
```

The baseline failures were its `next-http` socket failure plus Next-build failures inside `offline-resilience` and `operator-live-flow`. The latter two did not reproduce as failures on the cleanup tree after the runtime was repaired.

### Focused attribution

Command on cleanup and baseline: `npx vitest run tests/routes/next-http.test.ts`

Both trees reproduced the same 1/2 failure:

```text
TypeError: fetch failed
Caused by: SocketError: other side closed
code: UND_ERR_SOCKET
```

This is recorded as pre-existing; it is not treated as green.

## Full Playwright comparison

### Cleanup tree

Command: `npm run test:e2e` with Playwright Chromium v1243.

- Final full retry: **20/21 passed, 1 failed**.
- `offline-journey.spec.ts`: **12/12 passed** in that retry.
- `storage-contract.spec.ts`: **8/8 passed**.
- `operator-journey.spec.ts`: the same test passed when run isolated (`1/1`), but a full run can fail before the journey during its child `next build`.
- First full attempt had two pre-journey build failures; this is why the ledger records the final retry separately rather than hiding the instability.

### Baseline tree

Command: `npx playwright test` on the same environment.

- **9 passed, 1 failed, 11 did not run**.
- Failure occurred before C1 in `offline-journey.spec.ts` because its child `next build` returned non-zero; operator journey passed when reached.

These results prove the browser executable and ICU runtime are now present, but do not justify an all-green E2E verdict in the 2 GB runner.

## Visual fixture comparison

Command: `node scripts/capture-cleanup-visuals.mjs`

- Browser: `153.0.8010.12`.
- 16 PNG screenshots plus `manifest.json`.
- Phone/tablet/desktop: `375`, `768`, `1440` CSS pixels.
- Light/dark and print media.
- Baseline/current body-text hashes match for every same viewport/theme/media case.
- Document scroll width equals viewport width in all cases; table scroll regions retain their intended internal overflow on narrow viewports.
- Exact decimal/unit strings were present in all cases.

## Production-component visual comparison — closure addendum

Command (cleanup source):

```text
WORKSPACE_BASE_URL=http://127.0.0.1:3137 \
PRODUCTION_VISUAL_OUTPUT=ci/browser-evidence/production-components-current-2026-11-01 \
node scripts/capture-production-visuals.mjs
```

- Source pages/components: `/reports`, `/regrade`, `/regrade/fixture-regrade`, `ReportsContent`, `RegradeDetailContent`, `AppShell`, and `DataTable`.
- Current source SHA used by the production-page manifest: `427be699494347e7b23aa11231ebf5430374f58b`.
- Browser: Chromium `153.0.8010.12`; 13 screenshots; 0 page errors; **0 assertion failures**.
- Assertions covered document overflow, internal table scrolling, exact read-model strings, table semantics, named/focusable scroll regions, keyboard focus, empty/error/loading/print, light/dark, local `.woff2` font loading, manifest/icon HTTP 200, and long Arabic text.

The same script ran against a temporary checkout of `cleanup-baseline-2026-11-01` using the same isolated read-model route fixtures. Baseline: **13 screenshots, 0 page errors, 35 retained semantic assertion failures** (caption, named/focusable region, and baseline Regrade header scope). The failure list is preserved in `ci/browser-evidence/production-components-baseline-2026-11-01/manifest.json`; it is not converted to a pass.

The original `capture-cleanup-visuals.mjs` fixture remains a CSS-only helper. Its evidence is not used as proof that React rendered the production tables.

## DataTable regression closure

```text
npx vitest run tests/ui/data-table.test.tsx
```

```text
Test Files  1 passed (1)
Tests       4 passed (4)
```

The added case exercises `['a', 'a', 'a:1']` and verifies three distinct composed row keys. The combined DataTable/foundation/workspace targeted run is **25/25**.

## CI browser job change

`.github/workflows/ci.yml` now contains an independent `browser-e2e` job. It installs the pinned Node/ICU/Chromium runtime, runs `npm run test:e2e` on `ubuntu-latest` with a 60-minute timeout, and uploads traces/results on failure. This job is intentionally not treated as a substitute for a passing run; its result must be read separately from `verify`.
