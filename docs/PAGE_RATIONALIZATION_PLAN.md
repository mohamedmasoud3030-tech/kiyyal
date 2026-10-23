# Page Rationalization Plan

**Decision status:** recommended target route structure with an implemented subset. See the 2026-09-10 checkpoint below; rows not listed there remain `NOT STARTED` target architecture.
**Evidence:** `docs/PRD.md` §9.3, `docs/FRONTEND_RULES.md`, baseline runtime inspection, 2026-09-10 route/build evidence, and real-PostgreSQL security/service tests.

## Recommended route structure

```text
/                                  safe session/setup redirect
/login                             owner sign-in and operator PIN mode
/setup                             first-run owner setup
/today                             role-adaptive daily start
/purchase | /sale                  high-speed transaction entry
/transactions/[id]                 immutable record detail
/transactions/[id]/receipt         share/print document variant
/transactions/[id]/cost-adjustment fixed-source closed-day value correction
/parties | /parties/[id]           party register and owner ledger detail
/directory/buyers | /directory/buyers/[id]
/materials                         catalogue management
/inventory | /inventory/[materialId]
/regrade | /regrade/[id]
/cash + /expense + /payment        owner reconciliation; focused shared expense/payment actions; close
/reports?report=[name]             all report types in one query workspace
/history                           full owner movement log
/users | /settings                 owner control/configuration
/admin/directory                   separate platform administration
```

Routes above are canonical in the first implementation. High-frequency contextual work remains in a sheet/dialog/inline section rather than creating fragile standalone routes: party create/select, daily close, material edit, stock opening/adjustment, reversal/void, safe stock recovery and buyer report/private relation edit. The implemented `/expense` and `/payment` are deliberate focused exceptions: both roles need a safe direct/retry entry without embedding an operator mutation in owner-only cash or party-balance context.

## Current implementation checkpoint — 2026-09-15

| Rationalized decision | Status | Delivered boundary |
|---|---|---|
| Root and login remain a small public entry boundary | `VERIFIED COMPLETE` for anonymous redirect/RTL shell | `/` redirects to `/login`; public login has no yard data and separates operator PIN from provider owner credentials. |
| A role-adaptive `/today` and split `/purchase`/`/sale` are retained | `IMPLEMENTED BUT NOT VERIFIED` | All use the same verified server-session bootstrap and real API contracts. No client role toggle or calculated financial result was introduced. |
| `/materials` merges catalogue list, create, reference edits, favourite and deactivation | `IMPLEMENTED BUT NOT VERIFIED` | The implementation deliberately keeps type, grade and default pricing unit immutable after creation. The deactivation path is confirmed in place; no material DELETE exists. |
| `/inventory` + `/inventory/[materialId]` retain stock context and merge opening/adjustment into material detail | `IMPLEMENTED BUT NOT VERIFIED` | The owner starts at a responsive inventory list and moves to a focused material detail; opening and adjustment forms remain in that context instead of becoming fragile standalone routes. Every save emits a ledger header/line/audit, and a pending-sale correction is linked to the held sale. Operator quantity listing has no detail/API path. |
| Transaction presentation is split between entry, immutable detail, receipt document, and fixed-source correction | `IMPLEMENTED BUT NOT VERIFIED` | Posted success now has an eligible receipt link as well as a detail link. `/transactions/[id]`, `/transactions/[id]/receipt` and `/transactions/[id]/cost-adjustment` remain data-free guarded routes until the scoped API response arrives. Only an owner viewing a posted closed-day purchase gets the correction CTA; its nested route cannot change source identity and returns a limited immutable value-delta receipt. The receipt rejects pending, voided, reversed, unnumbered, and directionless-payment data. Pending-sale retry remains in record context. |
| `/history` uses a responsive list and detail drill-down rather than an unbounded dashboard/table | `IMPLEMENTED BUT NOT VERIFIED` | Owner filtering/keyset paging and operator current-day scoping remain server-enforced. |
| `/cash` remains one owner reconciliation workspace instead of a dashboard or separate close route | `IMPLEMENTED BUT NOT VERIFIED` | The current server date, separate posted/pending/total lines, chronological movements and pending blockers precede an inline, explicitly acknowledged atomic close. It launches the implemented expense/payment actions without adding summary metrics. |
| `/expense` and `/payment` are focused guarded actions rather than Cash/party-detail subviews | `IMPLEMENTED BUT NOT VERIFIED` | This deliberately preserves the operator boundary: an operator can record permitted cash-out or party cash movement without loading an owner drawer total or party balance. Today/Cash links preserve practical context; an owner ledger deep link retains a selected party. |
| `/parties/[id]` is an owner-only detail paired with the balance-free shared index | `IMPLEMENTED BUT NOT VERIFIED` | It derives balance direction server-side from posted credit/payment facts and uses a bounded chronology/card pattern; the shared `/parties` API never adds a balance to its operator-capable response. |
| Unlisted canonical routes | `NOT STARTED` | No compatibility redirect or placeholder action has been added. |

## Keep

| Surface | Decision and evidence | Affected roles | User impact | Technical dependencies | Migration risk | Verification requirement |
|---|---|---|---|---|---|---|
| Role-adaptive `/today` | **KEEP as one route with two deliberately different layouts.** PRD §9.3 names a shared Today screen but owner questions (cash/profit/attention) and operator question (buy/sell now) are fundamentally different. | Owner, operator | Prevents a dashboard from slowing the scale operator while avoiding duplicate entry points for owners. | Trusted session/capability middleware; separate response schemas. | Medium: accidental data leak if UI only hides values. | Direct operator API probe plus DOM test confirms no cost/profit/cash/history data; owner sees action-prioritized attention list. |
| `/purchase` and `/sale` | **KEEP as distinct routes.** Their arithmetic is mirrored, but incoming/outgoing stock and the D29 safe recovery have different mental models and permissions. | Owner, operator | Faster and less error-prone than one “transaction type” form. | Shared transaction-line form foundation; material/party/stock APIs; local draft/outbox. | High: core money/stock workflow. | One-line purchase within six interactions; owner and operator sale-shortfall branches; idempotent save/retry. |
| `/parties` + `/parties/[id]` | **KEEP as an index/detail pair.** PRD FR-6 requires both fast lookup and a ledger with running balance/history. | Owner; constrained operator picker | Separates quick selection from financial investigation. | Role-scoped party APIs; payment service; transaction links. | Medium: balance visibility and national-ID privacy. | Operator picker response excludes balances/history; owner detail shows direction and chronological balance-after. |
| `/directory/buyers` + `/directory/buyers/[id]` | **KEEP as an index/detail pair.** Browse/filter/call is a different task from managing private negotiated terms. | Owner | Makes `material → governorate → call` fast while retaining the private relationship layer. | Central directory APIs, owner-only relation APIs, response schemas. | High: central/private data boundary and marketplace risk. | Status/date/disclaimer always visible; admin metadata absent; tenant B cannot access tenant A relation. |
| `/materials` | **KEEP as owner configuration.** Materials, default units and reference prices are essential reference data but not daily navigation. | Owner | Keeps fast form choices clean and avoids accidental catalog changes under pressure. | Material CRUD, inactive/history guard. | Medium: historical pricing/unit preservation. | Old transactions retain their own units/prices after material edit/deactivation. |
| `/inventory` + material drill-down | **KEEP.** Inventory is the source of “what can I sell?” and exposes correct owner actions without direct balance editing. | Owner; operator has a separate quantity-only list with no drill-down | Supports real stock decisions and directs safe correction. | Implemented stock detail/movement API and `postStockMovement`; indicators/directory remain future dependencies. | High: cost visibility and no-negative invariant. | Mobile list-to-detail flow; owner-only values/actions; server rejects direct/negative changes and preserves an immutable linked adjustment for pending-sale recovery. |
| `/regrade` + immutable detail | **KEEP.** FR-9 needs a focused multi-line flow and later auditability of frozen prices/allocation. | Owner | Prevents approximation from becoming unexplained magic. | Regrade preview/post/detail/resolve APIs. | High: allocation snapshot and deferred-cost correctness. | Pre-save snapshot visible; historic detail unaffected by price changes; deferred split is exact. |
| `/cash` | **KEEP as the single cash-workspace route.** PRD FR-7 requires movements, expenses, pending cash and close to be understood together. | Owner | Eliminates false drawer reconciliation caused by separating pending cash. | Cash/day endpoints; pending-item query; expense/close mutation. | High: cash duplication/close boundary. | Three cash lines stay distinct; pending blockers block close but difference does not. |
| `/history` | **KEEP as owner-only operational audit.** It answers a broad, high-density lookup task that Today should not become. | Owner | Enables correction/audit without bloating the dashboard. | Filtered/paginated transaction/audit query. | Medium: scope/pagination/data leakage. | 50k-row strategy, deep-link detail, operator route/API denial. |
| `/users` and `/settings` | **KEEP separate.** Access control is safety-critical; yard configuration is infrequent. | Owner | Avoids hiding destructive access actions among passive settings. | User/session and yard/export APIs. | Medium: session revocation / privacy actions. | Deactivation preserves history and revokes session; settings does not expose operator controls. |
| `/admin/directory` | **KEEP separate from all yard routes and navigation.** It is a platform operation, not a third yard role. | Platform admin only | Stops admin data/curation work from confusing a yard owner or widening ledger access. | Separate admin auth/capability/API boundary. | High: privilege escalation/reputational curation data. | Admin cannot read ledger; yard users cannot access metadata/edit central entries. |

## Merge

| Surfaces to combine | Recommended result | Evidence / user impact | Affected roles | Dependencies / migration risk | Verification |
|---|---|---|---|---|---|
| Eight analytical report screens | **Merge into `/reports?report=…`** with one filter bar and report-specific body; make the ninth required report, full movement log, canonical at `/history`. | FR-12 needs nine reports, not nine navigation destinations. The movement log has materially denser search/audit/correction needs, so duplicating it inside Reports would create two competing sources. | Owner | Report query contract; `/history` compatibility/deep link and URL query persistence. Medium risk to filter correctness. | The eight analytical reports are bookmarkable; the “full movement log” report link transfers valid filters to `/history`; CSV is scoped to the selected query. |
| Cash movements, expenses and daily close | **Keep the owner’s context in `/cash`; launch a focused `/expense` action for the shared owner/operator write, and use an inline close form in the cash workspace.** | The owner can compare the drawer before launching expense/closing; a standalone focused expense action is justified because the operator must never load the owner Cash context. | Owner; operator focused expense action | Cash day state; close uses the current page so no modal focus-management risk. Medium-high financial risk. | Expense success has a scoped record link; the owner returns to Cash for the updated list. Implemented close form shows the same total and named pending blockers before an explicit finality acknowledgement. |
| Payments and advances | **Merge into one focused payment form at `/payment`, optionally entered from an owner party detail with `?party=`.** | FR-6 defines an unlinked payment as an advance; a separate “advance” feature duplicates balance logic. A route—not a modal—also supports idempotent retry and lets the operator act without receiving an owner ledger. | Owner; permitted operator | Implemented payment endpoint has explicit cash direction, server-current Cairo date, active party scope, atomic transaction/cash/audit, and a scoped recent-match guard. Medium financial/privacy risk. | One form writes one payment record; same party/direction/amount within five minutes demands explicit native acknowledgement; owner sees derived direction only in party detail, operator sees neither balance nor drawer values. |
| Material create/edit and list | **Merge into `/materials` with deep-linkable create/edit sheet/page.** | Material management is short and contextual; no reason for a disconnected full route in routine use, but URL recovery matters after failure. | Owner | Modal-route or parallel-route implementation. Low risk. | Keyboard/URL/back behaviour works; form errors persist; historical data invariant holds. |
| Inventory opening/adjustment actions | **Merge into inventory contextual actions.** | These are stock explanations, not daily navigation destinations. The material/current quantity should remain visible. | Owner | Guarded ledger forms, stock API. High data risk. | No direct editable inventory total; all saves create a reasoned movement and return to changed detail. |
| Reversal, void, pending resolution and historical correction | **Merge into record detail/attention context.** The implemented cost correction uses the nested `/transactions/[transactionId]/cost-adjustment` route rather than a generic standalone page, so the source record stays fixed and visible. | The selected record’s status/history determines which action is legal; generic correction pages invite wrong-record changes. | Owner | Transaction state/correction APIs. High risk. | Implemented cost route re-derives the source line and closes over its route id; its form/receipt names the current-period value-only effect. Future reverse/void confirmation must name record/effect/reason and recheck state server-side. |
| Privacy notice | **Merge into signup/setup acknowledgement and Settings subsection; retain a static deep link if legally required.** | Privacy must be visible at account start and reachable later, but does not justify daily nav. | Public owner/owner | Static content versioning. Low risk. | Required approved wording renders verbatim in both contexts. |

## Split

| Overloaded concept | Recommended split | Evidence / user impact | Affected roles | Dependencies / migration risk | Verification |
|---|---|---|---|---|---|
| “Today dashboard” | Owner decision workspace **vs** operator action launcher, under one URL. | Owner needs decision summary; operator needs two large actions and own status. One blended layout would either leak money or delay weighing. | Owner, operator | Server capability output schemas. High security risk. | Role-switch visual and direct API tests; no sensitive nodes/data for operator. |
| Buyers directory | Central public-to-yard reference facts **vs** private yard relationship data, within clearly separated buyer detail regions. | D19/D30 requires two ownership models and prevents marketplace drift. | Owner/platform admin | Separate APIs/cache scopes. High privacy risk. | Central panel never exposes admin fields; private form only owner/tenant. |
| Transaction display | Fast entry page **vs** immutable record detail/receipt document. | A high-speed scale form cannot also contain audit, print and correction detail without violating the 30-second target. | Owner, operator | Transaction/receipt endpoints and route scope. Medium risk. | Saving returns to a clear success/detail/receipt path without slowing entry. |
| Inventory | Cross-material comparison index **vs** one-material decision detail. | Stable columns belong in an owner table; contextual adjustments/buyers/recent movements need one record’s context. | Owner, optional operator quantity-only | Stock aggregate/detail APIs. Medium risk. | Mobile never squeezes table; drill-down carries correct material context. |
| Regrade | Editable proposal **vs** read-only frozen historical allocation/resolution. | D27 forbids re-deriving history from current prices. | Owner | Snapshot detail/resolution API. High financial risk. | Historic route is read-only except allowed resolution/reversal action. |

## Move

| Capability | From / to | Rationale | Affected roles | Dependencies / risk | Verification |
|---|---|---|---|---|---|
| Buyer discovery from a material | From a generic directory-only destination → contextual link in inventory material detail plus directory filters. | The owner often asks “who can buy this pile?” after seeing stock, not from a blank directory. | Owner | Query parameter mapping; no private relation leak. Low risk. | Deep link preselects material and preserves ability to change filters. |
| Pending attention | From an imagined separate “alerts dashboard” → top of owner Today and relevant record/cash context. | Pending stock/tare is a blocking operational exception, not a notification product. | Owner | Pending query and priority sort. Medium risk. | First blocker is actionable from Today; cash close names same item. |
| Reference price change | From transaction form as a hidden edit → Materials management quick edit, while transaction remains allowed to override/flag a price. | Keeps catalogue changes deliberate and preserves fast operator flow. | Owner, operator | Materials mutation and price override flag. Medium risk. | Operator can use override without catalog permission; owner sees flag on Today/detail. |
| Opening balance and stock adjustment | From Settings / standalone page → Inventory material context. | These actions change stock and need stock/indicator context. | Owner | Stock posting guard. High risk. | Server audits reason; no stock amount direct editing exists. |
| Expense creation | From a hypothetical finance settings area → focused action launched from Today/Cash. | Expense happens during operational day and needs a cash category now; a direct route protects the operator from owner drawer context. | Owner, operator | Expense authorization. Medium risk. | Operator sees no total; owner sees immediate cash movement after save. |

## Replace

| Avoid / replace | Recommended replacement | Evidence | Affected roles | Dependencies / risk | Verification |
|---|---|---|---|---|---|
| Generic “transaction” mega-form with type selector | Separate purchase/sale templates sharing transaction-line primitives. | Incoming/outgoing stock, owner profit and D29 recovery are materially different. | Owner, operator | Shared form controller without duplicated calculations. High core-flow risk. | Both preserve shared unit/deduction rules; different stock behaviour is explicit. |
| Generic dashboard card wall | Owner Today decision workspace and operator launcher; plain summary/list patterns only where decision-supporting. | D17 rejects cosmetic dashboards; PRD gives exact owner questions. | Owner, operator | Summary API. Low risk. | No decorative chart/card without a user decision rationale. |
| Desktop-only tables compressed to mobile | Responsive data-table policy: priority summary card + drill-down for inventory/history/parties; contained horizontal table only where comparison is essential. | Frontend rules require a real phone workflow. | Owner, operator | Responsive components and accessible row expansion. Medium risk. | No clipped columns or horizontal body scroll; semantic table still accessible on desktop. |
| Overloaded edit dialogs for records/buyers/party ledger | Route-level detail pages with contextual, focused sheets for short mutations. | Long audit/relationship content needs deep links and safe back navigation. | Owner | Detail APIs and modal-route recovery. Low risk. | Refresh/back/deep-link works; overlay focus restores correctly. |
| Silent delete/archive action | Explicit reversal, void, deactivation or unpublish flows based on record type. | D15 and migration/database rules forbid financial/weight deletion. | Owner, platform admin | State transitions/audit. High risk. | Original remains visible/attributed; no DELETE endpoint invoked. |

## Remove or avoid after migration

No working web capability exists today, so **nothing can be removed now**. The following are deliberately excluded from the target navigation and must not be introduced as substitute pages:

| Surface to avoid | Why it must not exist | Replacement / safeguard |
|---|---|---|
| Marketplace, quotes, buyer order/payment screens | Explicitly out of scope; creates commercial/legal commitments and violates D2/FR-16 boundary. | Central directory read-only cards with call/WhatsApp links and disclaimer. |
| Operator reports, profit, cash box, all-history, buyer relationship and settings pages | Violates the two-role permission model and exposes sensitive data. | Operator Today + fast entry + own-current-day record scope. |
| “Negative stock” repair screen | Negative stock must never be published. | Owner inline adjustment/missing purchase; operator pending stock resolution. |
| Direct inventory edit grid | Bypasses audit/cost/no-negative rules. | Opening/adjustment form from inventory detail. |
| Separate advance feature | Duplicates party-payment logic. | One payment/advance form. |
| Separate charts/analytics dashboard | Not justified by product decisions and adds noise/slow load. | Query-specific reports/tables and concise Today summary. |
| A third yard manager role UI | PRD says no real permission difference currently. | Capability architecture remains extensible but has no navigation/screen for a role that does not exist. |

## Redirect and compatibility policy

| Situation | Policy | Risk and verification |
|---|---|---|
| Current repository | There are no current URLs, so no compatibility redirect is implemented or claimed. | Recheck deployment/reverse-proxy routes before first production release. |
| Root entry | `/` currently performs the conservative server-side redirect to `/login`; session-aware `/today` or `/setup` routing is not implemented. | Anonymous redirect is HTTP-verified. Authenticated/root-state variants remain `NOT STARTED`; no protected content is flashed. |
| Future legacy individual report URLs | Redirect to `/reports?report=<canonical-name>` while preserving valid date/filter query parameters. | Add integration tests before any reorganization; invalid parameters fall back safely. |
| Future standalone cash/expense/opening/adjustment URLs | Redirect to `/cash`, `/inventory`, or scoped record detail with an explicit contextual-action state only if a target record is authorized. | Never use a redirect to bypass authorization or expose a record ID. |
| Future material/buyer edit modal URLs | Resolve to canonical detail/list route with modal/deep-link state, or the underlying route if the item is not viewable. | Browser back/forward and refresh must preserve safe state. |
| Receipt URLs once shared | Keep `/transactions/[id]/receipt` stable indefinitely; version print layout internally rather than moving it. | A receipt must remain printable and scoped after UI reorganization. |

## Migration decision

Build the remaining canonical hierarchy in small vertical slices; do not delete/merge any capability until the replacement route, permission checks, state handling and browser journey are verified. The implemented routes remain reversible additions over the Stage 0 foundation; authenticated browser validation is still required before any production retirement or redirect claim.
