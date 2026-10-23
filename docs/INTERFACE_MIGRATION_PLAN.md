# Interface Migration Plan

**Audit date:** 2026-09-15
**Baseline finding:** this began as a greenfield UI migration over verified Stage 0 domain/database/auth foundations. The historical baseline had no browser application and **127/127 tests passed** on 2026-09-09. The current implementation/evidence is recorded below, without retrospectively changing that baseline finding.

## Status legend

Only these labels are used in this plan:

- `VERIFIED COMPLETE`
- `IMPLEMENTED BUT NOT VERIFIED`
- `BLOCKED BY OWNER OR EXTERNAL ACTION`
- `NOT STARTED`

## Safety constraints

1. Do not alter applied database migrations, financial posting semantics, tenant/RLS policy, authentication contract or route/data authorization to make a UI easier to build.
2. Add browser routes only behind trusted server guards and scoped API view models. Never use a browser role flag to authorize an owner view.
3. Build vertically: shared component → one route → real server contract → component/journey tests → rendered verification. Do not scaffold all pages with fake owner financial data.
4. No route/capability is removed until a canonical replacement and compatibility path are deployed and verified. At the current baseline there are no browser routes to redirect.
5. Save/retry/draft/permission/error state is part of each milestone’s definition, not a later polish task.
6. Use the approved framework direction in `docs/ARCHITECTURE.md`; adding an unrelated frontend stack or broad component library is out of scope.

## Current checkpoint — 2026-09-15

- Latest cost-adjustment evidence: `npm run lint`, `npm test` (**211/211**) and `npm run build` pass. The implemented owner route/API accepts only an original displayed purchase line, corrected final value and documented reason; service/API/real-PostgreSQL tests cover closed-source/current-open branching, immutable header/detail shape, no synthetic stock line/cash, idempotent receipt replay, prospective weighted-cost projection, negative-value rejection, duplicate correction, rollback at each write step, owner read models and operator/cross-tenant exclusion. PGlite migration tests also prove generated delta, immutable child, header/no-line/no-cash shape; static UI rendering verifies the owner loading and operator-forbidden boundary. Production smoke confirms the unauthenticated nested correction route redirects to `/login`. Authenticated browser layout remains unverified.
- No browser binary is available for 320/768/1024/1440, zoom, keyboard, or screen-reader testing. No configured Supabase project or runtime `DATABASE_URL` is available for an authenticated provider journey. Those are external verification blockers, not hidden completion.
- The provider integration uses public/anon credentials only, provider-side user verification, local `app.users` mapping, middleware refresh, and explicit cookie-switch handling. It must still be exercised against a real configured provider before production use.

## Ordered milestones

| Order | Milestone | User-visible outcome | Scope and implementation sequence | Acceptance criteria / verification | Status |
|---:|---|---|---|---|---|
| 0 | Interface evidence and architecture map | A durable, auditable decision record exists before any UI code changes. | Inspect executable/runtime entry points; map roles/screens/states; rationalize routes; select data patterns/templates/components/forms; document safe sequence. | Documents exist in `docs/`; state the verified lack of current rendered UI; all PRD §9.3 screens, nested surfaces and role boundaries are covered; no application source changes in mapping phase. | `VERIFIED COMPLETE` |
| 1 | Web host and safe UI foundation | The repository has a renderable Arabic RTL application shell with no fabricated financial record or permission bypass. | Added Next.js 16.3.4/React 19/Tailwind 4 host and `dev`/`build`/`start` scripts; root RTL layout; centralized Arabic copy; logical CSS; shells, form/display/status primitives, public states and development-only `/ui-preview`. | Latest evidence: `git diff --check`, `npm run lint`, `npm run test:ui` 11/11, `npm test` 167/167, `npm run build`, production dependency audit 0; development HTTP checks show root redirects to `/login` and login renders `<html dir="rtl" lang="ar">`. Full browser viewport/visual inspection remains required. | `IMPLEMENTED BUT NOT VERIFIED` |
| 2 | Trusted web session and read-model seam | Login/session routing and role-scoped read data can power a real page without exposing owner data to operators. | Implemented operator opaque-cookie validation plus Supabase browser cookie refresh/verification/local owner mapping; protected pages wait for `/api/session`; stale owner cookies cannot fall back to a shared-device operator identity; explicit logout/switch clears the appropriate session. | Auth/role shape and stale-cookie fallback tests pass; operator stock serialization is real-Postgres tested without cost/value fields. A live Supabase sign-in/refresh and authenticated browser route remain externally unverified. | `IMPLEMENTED BUT NOT VERIFIED` |
| 3 | Representative critical journey: Materials → Purchase → record/receipt | Owner/operator can safely choose an active material and record one purchase through real server data, then inspect a scoped record or receipt. | Materials API/list/create/update/deactivate and Purchase form/API result are implemented. The form sends raw fields, CSRF and idempotency key; server computes results. Posted results link to a guarded printable receipt which reuses the scoped detail response; pending sales cannot issue it. | Real-Postgres material create/update/replay/audit and posting tests pass; receipt static/eligibility tests pass. Draft/outbox, interaction-count proof, share target/thermal-specific print testing, and authenticated browser/viewport journey remain unimplemented or unverified. | `IMPLEMENTED BUT NOT VERIFIED` |
| 4 | Representative high-risk journey: Sale safe recovery | A real sale never publishes negative stock, and the owner/operator branches remain comprehensible. | Sale reuses the real transaction form/API; pending stock resolution is preserved. Record detail lets the owner either retry when stock is now sufficient or create one linked positive physical-stock `adjustment` for a material in that held sale, with an enum reason and optional note, then post atomically using the original sale data and stable retry key. The adjustment now has its own immutable header/line/audit instead of being only a projection change. | Atomic real-Postgres tests cover linked adjustment → pending sale posted transition/replay, one cash-row flip, zero/unrelated-adjustment rejection, and no duplicate adjustment. Missing-purchase and multi-material recovery UIs, pending-cash owner workspace, and authenticated rendered shortfall branches are not complete. | `IMPLEMENTED BUT NOT VERIFIED` |
| 5 | Owner daily decision and inventory | Owner can start from action-oriented Today and make basic stock decisions; operator gets an action-first private view. | Role-adaptive shell, Today action/list surface, inventory quantity/owner-value list, and owner-only material detail are implemented from scoped read APIs. The detail contains a bounded movement chronology plus immutable opening/adjustment forms; active zero-balance materials are visible to the owner solely to launch a first opening. | Owner/operator stock output boundary and owner-only detail/adjustment service are real-Postgres tested. Planned attention prioritization, indicators, buyer link, history material filter, and authenticated rendered verification remain incomplete. | `IMPLEMENTED BUT NOT VERIFIED` |
| 6 | Money, party and correction foundation | Owner can begin party, history and drawer reconciliation without false financial summaries. | Parties list/create and a bounded scoped History list/detail link are implemented. Owner History now uses server-validated text/type/status/date filters with opaque keyset paging; operator History stays own/current-day scoped. Owner Cash reads server-Cairo current-day opening/posted/pending/total values separately, movements, and pending close blockers. A clean current day can be closed through a server-date-only, CSRF/idempotency protected transaction that locks the yard against posting, writes the immutable zero-pending close and audit snapshot, and rejects pending work/cash. Owner and operator can create focused current-day expense and payment actions. Payment selects an active scoped party, has explicit cash direction, atomically writes posted transaction/cash/audit records, and detects recent matching payments until a human explicitly confirms independence. Owner-only party detail derives an explicit-direction balance and a capped linked chronology; neither that endpoint nor its balance reaches an operator. | Party/user/material/amount history filters, party filter/paging/edit/export, reports, and rendered role-flow evidence remain absent. Historical correction is now tracked in milestone 7. | `IMPLEMENTED BUT NOT VERIFIED` |
| 7 | Remaining owner operations | Owner can manage supported catalogue and correct a closed purchase value without changing historical identity. | Catalogue reference edits/deactivation and owner opening/adjustment records are implemented. Historical purchase cost correction is now an owner-only detail CTA and focused route: it selects a server-rendered closed purchase line, submits only a corrected final value/reason/note with CSRF/idempotency, and shows an immutable limited receipt. The server writes a current-period value-only `cost_adjustment` record; owner history/detail/inventory movement views render its signed delta, while operator contracts omit it. Regrade, reports, users, settings, directory and admin work remain unstarted. | Service/API/real-PostgreSQL/PGlite migration tests cover the new ledger boundary and static UI output covers its initial owner/operator states; authenticated browser verification remains outstanding. | `IMPLEMENTED BUT NOT VERIFIED` |
| 8 | Resilience and PWA hardening | The installed shell opens safely, drafts/retries survive interruption, and cache never leaks restricted data. | Add manifest/service worker, scoped caches, IndexedDB draft/outbox, connection/pending UI, logout/switch cleanup, connection-drop tests. | Five interrupted saves post exactly once after reconnect; no operator cache holds cost/profit/cash; update preserves drafts; install/cached shell verified on primary browser targets. | `NOT STARTED` |
| 9 | Systematic route migration and retirement | Every canonical route uses the shared component/template system; obsolete implementation is removed only after proof. | Migrate remaining route consumers by risk; remove duplicated CSS/one-off fields/legacy components; add redirects only if legacy paths exist in deployed environment. | Route inventory checklist is complete; no legacy component has consumers; full unit/API/E2E/build suite plus browser log review passes. | `NOT STARTED` |
| 10 | Production/staging gate | Deployment has evidence for real staging security and pilot readiness. | Run existing staging gate with production-like Supabase roles and configured environment; rehearsals for backup/restore and user journeys. | `STG-1…STG-9`, RLS direct probes, full browser E2E and operational runbook rehearsal pass. | `BLOCKED BY OWNER OR EXTERNAL ACTION` — required staging credentials are not in this repository and must remain outside it. |

## Next safe milestone

**Regrade proposal and allocation resolution (D33) — `NOT STARTED`.** It is the next bounded owner-only vertical slice because it can first expose a read-only allocation preview before it creates a new immutable record. Build the server-side source/output conservation and locked allocation snapshot before the focused form; any deferred allocation must retain an explicit unresolved status and cannot fabricate cost/profit. Reuse the existing owner-only detail/read-model boundary, add real-PostgreSQL atomicity/RLS/conservation tests, then add the route/UI. Do not combine it with reports or historical open-day replay.

## Vertical delivery detail

### Milestone 1 — foundation first

**User-visible outcome:** a legible Arabic RTL shell and public entry surface are rendered at every target viewport, with real focus/error/permission/offline component states—not a decorative dashboard.

**Why first:** no current frontend exists. It is the highest-value reversible layer and does not touch money, database writes, transactions or permissions.

**Do before route-specific page work:**

1. Add only the approved framework/build host and essential React/Tailwind/Radix dependencies.
2. Establish `lang="ar" dir="rtl"`, logical CSS guard compatibility, responsive tokens and copy module.
3. Implement safe shells, layout/nav primitives, buttons, form field/error primitives, status/state panels and display formatters.
4. Render a real `/login` skeleton and route-safe error/offline/permission examples wired to no privileged data.
5. Test/build/render before calling the foundation complete.

**Explicit non-goals:** no mock ledger, no fake transaction success, no browser-side authorization, no schema change, no financial endpoint rewrite.

### Milestones 2–4 — prove one end-to-end core loop

1. Create trusted session/read adapters and output schemas first.
2. Build Materials only as much as the transaction picker requires, then a complete real Purchase journey.
3. Verify the Purchase receipt/detail and retry path before starting Sale.
4. Build Sale on the same line/picker/summary primitives; test the owner/operation shortfall divergence through real API contracts.
5. Do not duplicate calculation code: pre-save preview is a display-only adapter over the shared pure domain rules, while server posting remains authoritative.

### Milestones 5–9 — broaden after architecture proof

- Introduce each template through a representative high-risk page, then migrate sibling routes.
- Add no broad visual cleanup while changing unverified business logic.
- Mark a route/component only after its data shape, normal and exceptional state, responsive rendering, keyboard and appropriate direct-permission test are complete.
- Delete old code only after a repository-wide consumer search and rendered regression check.

## Verification matrix per milestone

| Check | Required evidence |
|---|---|
| Current behaviour capture | For baseline: command evidence records that no web runtime/route exists. For each later route: screenshot or browser capture of before/after state plus route/console log review. |
| Rendering | 320px mobile, 768px tablet, 1024px laptop, 1440px wide desktop; 200% browser zoom; long Arabic content and mixed numerals. |
| RTL | Root direction, logical spacing, table/card transformations, icons/navigation direction, receipt/print document. |
| Keyboard | Natural tab order, visible focus, Enter/Escape behavior, overlay focus trap/restore, table/filter/pagination semantics. |
| Screen reader | Landmarks, heading order, form label/error association, live status restraint, status text beyond colour, safe names for every action. |
| Data/permissions | Route guard + direct API test, output schema inspection, tenant isolation, no client-side trust for role/yard/totals. |
| Failure states | Loading, skeleton, empty, no results, validation, error, retry/offline, disabled, success, permission denied, expired session. |
| Quality gates | `npm run lint`, type check, relevant unit/API/component/journey tests, production build, browser/runtime logs and complete Git diff. |

## Current blockers and rollback

| Item | Status | Impact | Safe response / rollback |
|---|---|---|---|
| Browser application host | `IMPLEMENTED BUT NOT VERIFIED` | Safe public routing, guarded authenticated routes, real scoped API consumers, material mutations and record detail now exist; the limitation is missing authenticated visual proof, not absence of a route. | Rollback remains additive-file/dependency removal or routing rollback without altering applied Stage 0 database foundations. |
| Browser viewport capture | `BLOCKED BY OWNER OR EXTERNAL ACTION` | This sandbox has no installed browser binary; Playwright Chromium and Debian Chromium downloads both failed because the external network reset/was unavailable. HTTP rendering, build and server-side component tests passed, but that is not a substitute for visual 320/768/1024/1440 checks. | Keep the dev live preview available; run browser viewport/keyboard/zoom capture as the first action when a browser-capable environment is available. |
| Web auth/API wiring | `IMPLEMENTED BUT NOT VERIFIED` | Operator opaque sessions and provider-verified owner cookie sessions are wired to scoped APIs. Live owner provider configuration and a full authenticated browser exercise are unavailable here. | Keep provider credentials outside the repository; verify sign-in, refresh, logout and role mapping on staging before production. |
| Supabase staging credentials | `BLOCKED BY OWNER OR EXTERNAL ACTION` | Existing Stage 0 staging security gate cannot be run against a real Supabase environment. | No credentials are requested/stored in code; local real-Postgres evidence remains valid but does not close staging gate. |
| Current web route compatibility | `VERIFIED COMPLETE` as no-route baseline | There are no existing browser URLs or UI consumers to break. | Re-audit deployment configuration before first production release; add compatibility redirects only when a legacy route actually exists. |

## Documentation update rule

After each milestone, update this plan and the affected route/component/form/template documents with one of the four status labels above, the exact tests/build commands run, rendered viewport evidence, known limitation and next safe milestone. Do not describe an unrendered or untested route as complete.
