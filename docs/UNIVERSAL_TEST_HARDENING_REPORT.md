# Universal Test Hardening Report

**Assessment date:** 2026-09-15

**Scope:** the checked-out application source, not a requirements-only interpretation.

**Final assessment:** **PASS WITH EXPLICIT LIMITATIONS**

## What was inspected

A second, independent source and runtime inventory was performed after the hardening changes:

- 22 implemented `src/app/api/**/route.ts` modules;
- 20 App Router page modules, including all protected deep links;
- 35 UI components, 9 service modules, auth/session code, HTTP adapters, read models, 18 SQL migrations, middleware, and runtime database configuration;
- live Next servers backed by disposable real PostgreSQL databases for route and client-flow tests;
- the complete automated suite, production build, type checking, decimal/RTL guard, focused shuffled UI run, and controlled mutations.

A behavior is **PROVEN** only when the cited test observes a meaningful result across the applicable boundary (visible result plus persisted data, an actual handler response, or a real PostgreSQL/RLS result). Static markup, snapshots, and mock-call assertions are not counted as feature-success proof.

## Behavior matrix

| ID | Actual behavior and observable success | Primary proof | Status |
| --- | --- | --- | --- |
| H-01 | Public root redirects to login; login, forbidden, offline, and not-found pages serve the correct HTTP result/content. | `tests/routes/next-http.test.ts` against a live Next server | **PROVEN** |
| H-02 | Each implemented protected page and parameterized deep link admits only a potential session shell; an anonymous request redirects, and a stale opaque cookie cannot obtain an API session. | `tests/routes/next-http.test.ts` | **PROVEN** |
| H-03 | The shell obtains its role from live `/api/session`, renders no child before verification, and gives operator and owner different navigation/read surfaces. | `tests/ui/operator-live-flow.test.tsx`, `tests/ui/protected-screen.test.tsx`, RLS tests | **PROVEN** |
| H-04 | Operator login exchanges a PIN for a server-issued opaque cookie, not a PIN-bearing client token; lockout, expiry, rotation, revocation, and per-session scope fail closed. | live UI flow; `tests/auth/auth.test.ts` on real PostgreSQL | **PROVEN** |
| H-05 | A stale/malformed owner SSR cookie cannot silently inherit a shared-device operator session. | actual `/api/session` route-handler request in `tests/routes/app-routes.test.ts` | **PROVEN** |
| H-06 | Owner browser login maps a provider-verified subject through the live application and sign-out revokes the provider session rather than hiding UI only. | live UI flow with a protocol-faithful disposable provider transport | **PROVEN** |
| H-07 | Cookie mutations require same-origin double-submit CSRF and idempotency; owner bearer compatibility is bounded; malformed inputs and typed failures receive stable safe responses. | `tests/server/http-hardening.test.ts`, live route/UI flows | **PROVEN** |
| H-08 | Owner material creation, explicit deactivation confirmation, persistence, and post-save inactive state work; operators cannot mutate owner catalogue data. | `tests/ui/operator-live-flow.test.tsx`, `tests/services/posting.test.ts`, RLS tests | **PROVEN** |
| H-09 | Parties can be created, payment and expense forms create their separate durable facts, and owner party ledger/deep-link preselection remains scoped to the selected party. | live UI flow plus PostgreSQL assertions | **PROVEN** |
| H-10 | Purchase computes server-side totals, commits header/line/stock/cash/audit facts atomically, and is recoverable through the real UI result. | live UI flow; `tests/services/posting.test.ts`; route journey | **PROVEN** |
| H-11 | A normal operator sale is numbered only after stock/ledger commit and exposes its receipt path. | live UI flow plus PostgreSQL assertions | **PROVEN** |
| H-12 | An operator excess sale is visibly pending and unnumbered; an owner can add the narrowly scoped physical correction and settle that same immutable sale once. | live UI flow; service atomicity/authorization tests | **PROVEN** |
| H-13 | Owner opening balance and reasoned physical adjustment are immutable ledger facts, not direct balance edits; balances/value update deterministically. | live UI flow; `tests/services/posting.test.ts`; database write guards | **PROVEN** |
| H-14 | A closed-source purchase cost correction creates one immutable current-period detail/header linkage, preserves physical/cash facts, and rejects invalid/duplicate/negative-value branches. | live UI flow; service, database immutability, and route tests | **PROVEN** |
| H-15 | Expense and payment create one posted transaction, linked cash movement, audit fact, and safe idempotent replay/duplicate-confirmation behavior. | live UI flow; `tests/services/posting.test.ts`; route journey | **PROVEN** |
| H-16 | Cash-day read model derives expected drawer cash; explicit acknowledgement is required before an owner close persists/reloads the close fact. Pending work blocks closing. | live UI flow; `tests/services/posting.test.ts`; database tests | **PROVEN** |
| H-17 | Owner history uses RLS-scoped server filtering, bounded text/date/type/status filters and keyset pagination; operator history remains restricted to its own current-day records. | live owner filter flow; `tests/services/posting.test.ts`; RLS tests | **PROVEN** |
| H-18 | Transaction detail and receipt APIs are scoped and schema-filtered. Operator receipt/details do not receive owner-only cost/profit fields; a pending sale receives no receipt. | live UI receipt/pending checks; route and service output-boundary tests | **PROVEN** |
| H-19 | Material, party, stock, transaction, cash, audit, and buyer-directory reads/writes are tenant-scoped; capability checks, composite FKs, FORCE RLS, least-privilege runtime role, and append-only ledger/audit constraints remain effective. | `tests/db/schema.test.ts`, `tests/db/isolation.test.ts`, `tests/db/real-postgres-security.test.ts`, `tests/db/immutability.test.ts` | **PROVEN** |
| H-20 | Exact decimal parsing/rounding, line deductions, ton/kg conversion, moving-average costing, profit boundaries, cash arithmetic, regrade conservation/allocation, and deferred resolution preserve their stated numeric invariants. | `tests/domain/golden.test.ts`, `tests/domain/hardening.test.ts` | **PROVEN** |
| H-21 | Every implemented API module is traversed in a real-handler journey that includes authentication, parsing, CSRF/idempotency, output schemas, runtime DB access, persistence, reads, and sign-out. | `tests/routes/app-routes.test.ts` | **PROVEN** |
| H-22 | UI flow tests are repeatable rather than order-dependent: mutable workflow facts are reset between tests and every prerequisite is created through the real service/database boundary. | focused isolated pending-sale run, shuffled live suite, and shuffled full suite with seed `20260915` | **PROVEN** |
| H-23 | The development-only `/ui-preview` route, copy, CSS tokens, and presentational primitives do not write business data. They are not separate operational product behavior. | source inventory and HTTP route inventory | **NON-BEHAVIORAL** |
| H-24 | No service worker, web manifest, or offline cache implementation exists in the checked-out source. `/offline` is a static fallback route already covered by H-01, not an implemented offline-sync feature. | source inventory (`src`, `public`, configuration) | **NON-BEHAVIORAL** |
| H-25 | Native browser navigation after login/sign-out, actual print dialog behavior, keyboard/assistive-technology behavior, and responsive overflow at a real viewport. A Playwright journey exists for these checks but could not launch. | `npm run test:e2e` stopped before the test because the Chromium executable is absent; `npx playwright install chromium` retried and failed with `ECONNRESET` from `cdn.playwright.dev` | **ENVIRONMENT-LIMITED** |
| H-26 | Live Supabase tenant verification/refresh/logout and managed-Supabase staging role/grant/Data API validation. Local provider protocol and PostgreSQL evidence exist, but no disposable real tenant/staging credentials are available. | provider transport-backed live tests; `npm run gate:staging` exited 2 because `STAGING_MIGRATOR_URL` and `STAGING_RUNTIME_URL` are absent | **ENVIRONMENT-LIMITED** |

**Matrix count:** 22 PROVEN, 2 ENVIRONMENT-LIMITED, 2 NON-BEHAVIORAL, **0 UNPROVEN**.

## False-pass and isolation audit

The first focused mutation attempt exposed an order dependency in the new live UI file: a pending-sale test inherited stock from a previous sale test. That failure was **not** counted as a mutation result. The harness was changed so each test starts with mutable ledger/projection/party state reset and creates its own real-service prerequisite.

A later candidate mutation initially left a purchase test green because it checked the visible success screen and transaction header/line but did not yet assert the stock projection. That was also **not** counted as a valid mutation. The test now checks exact persisted `stock`, `stock_value`, zero-cash case, and audit fact; the same mutation then failed as required. The opaque operator session is deliberately reused only to avoid testing against the production rate limiter; it is still a token minted by the live auth route and is installed with a fresh browser CSRF cookie for each test.

The repaired suite passed both normal execution and a randomized test order:

```text
npx vitest run tests/ui/operator-live-flow.test.tsx --sequence.shuffle --sequence.seed=20260915
15 passed
```

## Controlled mutation ledger

| Mutation | Meaningful detector | Result | Restored |
| --- | --- | --- | --- |
| Replace `canSettle || settlement === 'succeeded'` with `canSettle` in `TransactionDetailContent`. | Isolated live pending-sale journey must render the persisted settlement result after owner recovery. | Focused test failed (`exit 1`) because `تم ترحيل العملية` was no longer rendered. This verifies the result-panel assertion, not just the write. | Yes; literal source condition was verified and the full suite passed afterwards. |
| Replace owner-cookie fallback predicate with unconditional `return true` in `requestAuth.ts`. | Actual `/api/session` handler receives a stale owner SSR cookie plus a valid operator cookie and must return 401. | Route journey failed (`exit 1`): received 200 where 401 was required. This verifies a real authorization boundary. | Yes; original predicate was verified and the full suite passed afterwards. |
| Suppress the posted stock-projection block in `postTransaction.ts`. | Isolated live purchase flow must leave the visible result **and** the exact durable stock value/audit facts. | Focused test failed (`exit 1`): the header/line still existed but `stock` and `stock_value` were `null` instead of `10.00`/`200.00`. | Yes; original condition was verified; normal and shuffled full suites passed afterwards. |

## Verification record

| Command | Outcome |
| --- | --- |
| `npm run lint` | Passed: TypeScript and decimal/RTL guard clean. |
| `npm run build` | Passed: optimized Next production build compiled all listed routes. |
| `npm test -- --reporter=verbose` | Passed: 15 test files, 248 tests. |
| `npm test -- --sequence.shuffle --sequence.seed=20260915 --reporter=verbose` | Passed: 15 test files, 248 tests in randomized file/test order. |
| `npx vitest run tests/ui/operator-live-flow.test.tsx --sequence.shuffle --sequence.seed=20260915` | Passed: 15 live client flows in randomized order. |
| `npm run test:e2e` | Environment-limited before browser launch; not treated as a product failure. |
| `npx playwright install chromium` | Environment-limited: repeated TLS connection reset to the Playwright CDN. |
| `npm run gate:staging` | Environment-limited: owner-controlled staging URLs are not present. |

## Explicit limitations and hand-off

1. Install a Playwright-supported browser in the CI/runtime image (or restore access to `cdn.playwright.dev`), then run `npm run test:e2e`. This covers true browser redirect, native print invocation, viewport layout, and keyboard/AT behavior.
2. Provide a disposable Supabase project and non-production staging migrator/runtime URLs only in the controlled staging environment, then run `npm run gate:staging`. This validates provider and managed-platform behavior that the local protocol double cannot establish.
3. These limitations do not represent an untested local implementation branch: each has a specific unavailable external dependency and a local alternate proof listed above.
