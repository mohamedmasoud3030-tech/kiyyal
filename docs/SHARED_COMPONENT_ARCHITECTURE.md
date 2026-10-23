# Shared Component Architecture

**Decision status:** the former frontend component inventory was empty. The implemented component set is `IMPLEMENTED BUT NOT VERIFIED`: `PublicShell`, `AppShell`, `PageContainer`, `PageHeader`, `Section`, `Button`, `FormField`, `TextInput`, `NumericInput`, `FormActions`, `ValidationSummary`, `StatusBadge`, `Amount`, `Weight`, `PriceWithUnit`, `Alert`, `StatePanel`, `ProtectedScreen`, `SignOutButton`, `TransactionReceiptDocument`, `InventoryDetailContent`, and the focused route compositions listed in the checkpoint below. Higher-order picker/table/overlay abstractions remain `NOT STARTED`. Existing TypeScript domain/auth/service modules are deliberately **not UI components** and remain independent of React.
**Architecture constraint:** follow the approved Next.js/React/Tailwind/Radix direction in `docs/ARCHITECTURE.md`; do not add a broad component library or a second state/calculation system.

## Existing inventory and migration classification

| Current item | Classification | Canonical replacement / disposition | Usage locations | Migration priority | Deprecation plan |
|---|---|---|---|---|---|
| Foundation UI host and primitives | IMPLEMENTED BUT NOT VERIFIED | `src/app/**` and the listed `src/ui/**` primitives establish the canonical base; use them rather than route-local styles. | Safe public routes and development-only visual preview. | Foundation | No legacy component removal is needed; browser viewport verification remains open. |
| `src/domain/**` | KEEP | Remains framework-free domain logic. UI uses typed API/preview adapters; components must not recreate money/weight calculations. | Future transaction/regrade presentation only. | Foundation dependency | Never import React/Next into these modules. |
| `src/auth/**` | KEEP | Trusted session/capability services remain server-side; build route guards/adapters around them rather than placing auth logic in UI. | Login, app shell. | Foundation dependency | Do not expose token/PIN methods to client components. |
| `src/services/postTransaction.ts` | KEEP | Server mutation adapter/route handler invokes it; UI displays returned values/status only. | Purchase, sale, pending resolution. | Critical journey dependency | No UI wrapper may bypass it. |
| `src/services/postStockMovement.ts` | KEEP | Owner-only financial service emits immutable opening/adjustment ledger facts and updates the stock projection only inside its protected transaction. | Inventory material detail; pending-sale recovery. | Critical stock-integrity dependency | No UI wrapper may mutate `stock_balances` or recreate moving-average arithmetic. |
| Existing visual/design system | No current item | Do not preserve/invent legacy wrappers. | None. | N/A | No legacy component removal is needed. |

## Current composition checkpoint — 2026-09-15

| Component / composition | Status | Boundary |
|---|---|---|
| `OwnerLoginForm`, `OperatorLoginForm`, `SignOutButton`, `src/ui/ownerProvider.ts` | `IMPLEMENTED BUT NOT VERIFIED` | PIN stays uncontrolled and owner password is sent only to the Supabase browser client. Server-side provider verification/local identity mapping and explicit shared-device session clearing remain authoritative. |
| `ProtectedScreen` + `useSession` | `IMPLEMENTED BUT NOT VERIFIED` | It mounts no yard content until `/api/session` returns a server-verified role; page-entry cookie recognition permits only a data-free loading boundary. |
| `TransactionEntryContent`, `TransactionDetailContent`, `TransactionReceiptContent`, `TransactionReceiptDocument` | `IMPLEMENTED BUT NOT VERIFIED` | Entry preserves raw values and server authority; detail renders API-shaped facts. Stock-only records use weight/cost facts rather than meaningless zero cash totals, and the receipt composition refuses stock-only/pending/voided/reversed/unnumbered data. Cost/profit, cash-drawer and party-ledger values are never synthesized for an operator. |
| `MaterialsContent`, `PartiesContent`, `HistoryContent`, `InventoryContent`, `InventoryDetailContent`, `TodayContent` | `IMPLEMENTED BUT NOT VERIFIED` | Each consumes a real scoped API and uses responsive list/fact patterns, with no fabricated zero data. `InventoryDetailContent` composes only low-level form/display primitives with two focused local forms (`OpeningBalanceForm`, `StockAdjustmentForm`); it does not create a universal financial form or directly write stock. `PartiesContent` only adds an owner ledger link; it does not receive balances. |
| `PaymentContent`, `PartyLedgerContent` | `IMPLEMENTED BUT NOT VERIFIED` | Route-specific compositions deliberately reuse `FormField`, `NumericInput`, `FormActions`, `Amount`, `Section` and `StatePanel` rather than introducing a universal financial form/timeline. Payment preserves the explicit server duplicate-confirmation state; ledger data is owner-shaped at its API boundary. |
| Proposed generic `DataTable`, `ActionMenu`, overlays, picker controllers | `NOT STARTED` | Do not introduce them until a route needs their verified behaviour; current small collections deliberately use focused route code. |

## System boundaries

- **Server / feature adapters:** authorization, API calls, preview calculation orchestration, draft/outbox policy and route-data shaping. They are not presentational components.
- **Canonical UI components:** render one clear interaction or information pattern; receive already-scoped view models; emit user intent.
- **Route templates:** compose canonical components. They own page-level loading/error boundaries and no reusable business calculation logic.
- **Copy:** all user-facing Arabic strings come from a localization module. Components receive keys/children; they do not hard-code Arabic text.
- **Domain display:** `Amount`, `Weight`, `PriceWithUnit` and `StatusBadge` are small, domain-aware display primitives. They format strings only and never calculate or parse values for posting.

## Baseline behaviour shared by canonical components

| Concern | Required implementation rule |
|---|---|
| States | Interactive components support normal, hover (where pointer exists), visible focus, active/pressed, disabled and loading states. Selection controls additionally support selected/unselected. Status-bearing components support success/warning/error/pending through textual labels and non-colour signals. Not every component receives every semantic state as a prop. |
| RTL | `dir="rtl"` at root; use logical CSS properties only; arrow/order/icons mirror only when direction conveys navigation. Numeric values preserve readable Western-digit order with `dir="ltr"` isolation where needed. |
| Accessibility | Native element first; semantic names/labels, keyboard operation, focus visibility, focus restoration after overlays, status text/live regions only for meaningful dynamic change, 48px touch targets for primary operational controls. |
| Long content | Names wrap up to a defined two-line summary limit where scanning is needed; use `title`/detail view for full content. Notes preserve line breaks. Amount/weight never truncate; columns reflow or drill down. |
| Responsive | Components use intrinsic layouts. Page templates decide content regions; no component assumes a fixed viewport. Tables have an explicit mobile alternative supplied by `DataTable`, not accidental CSS shrinking. |
| Permission | A component never authorizes an action from a raw role claim. It may choose safe presentation from a server-verified session role or already-scoped view model; the server remains the enforcement point for every route and mutation. |
| Error handling | Fields bind errors with `aria-describedby`; mutations preserve input after recoverable failure; overlays do not close on failed save. |
| Test threshold | Component unit tests cover semantic state/keyboard/long-content behaviour for high-risk primitives. Journey/E2E tests cover composition, permissions and financial outcomes. |

## Canonical components

### Layout and navigation

| Component | One responsibility | Variants / supported states | Responsive, RTL and accessibility rules | Usage rules / anti-patterns | Initial consumers |
|---|---|---|---|---|---|
| `PublicShell` | Provide the minimal public/authentication frame. | `auth`, `setup`, `system`; loading/error. | Centered readable width; no app nav; Arabic landmarks; full viewport without fixed visual chrome. | Do not render authenticated summaries or cached yard data. | Login, setup, expired session. |
| `AppShell` | Provide authenticated landmarks, role-scoped navigation and connection status. | `owner`, `operator`; navigation selected; network pending/offline. | Mobile bottom navigation for permitted frequent destinations; tablet compact rail; desktop sidebar; `nav` labels never icon-only for operational destinations. | Do not put platform administration or owner-only routes in operator navigation; do not fetch data itself. | All authenticated yard routes. |
| `AdminShell` | Isolate platform directory administration from yard operations. | `platformAdmin`; selected/error/loading. | Separate nav/landmarks; desktop data-workspace priority; responsive list fallback. | Never reuse `AppShell` with a hidden admin link; never include yard ledger navigation. | `/admin/directory`. |
| `PageContainer` | Constrain line length and page width. | `form`, `standard`, `wide`, `document`; no interactive state. | Logical inline padding; fluid width; max widths prevent wide-desktop stretching. | Do not use arbitrary per-page paddings. | Every route template. |
| `PageHeader` | Name the page, explain brief context and place primary action. | `compact`, `standard`, `withBack`, `withStatus`; loading action state. | Mobile title/action stack; desktop inline logical action end; exactly one visually primary action. | Do not use it as a second dashboard; no hidden destructive action. | All route-level pages. |
| `Section` | Group a meaningful labelled content region. | `plain`, `outlined`, `critical`, `muted`; no generic card decoration. | Uses heading level passed by template; logical padding; status/description can wrap. | Do not wrap every field in a section/card; use only semantic groups. | Detail, Today, settings, forms. |
| `Stack` / `Inline` / `ResponsiveGrid` | Supply predictable layout primitives without semantic or business behaviour. | Gap/align/wrap values constrained by token scale. | Logical inline/block behaviour; grid reflows at template-defined queries. | No visual styles, data fetching or one-off breakpoints inside. | All components. |
| `SidebarNavigation` | Render desktop role-authorized route choices. | owner/operator selected/disabled. | Hidden below laptop breakpoint; current route uses `aria-current="page"`; Arabic labels. | Do not render inaccessible navigation then hide it with CSS. | `AppShell`. |
| `MobileNavigation` | Render three-to-five highest-frequency permitted destinations. | owner/operator selected; pending indicator. | Fixed safe-area-aware bottom bar; labels plus icons; 48px targets; state badge has text alternative. | Do not expose every settings/report destination; use “more” route only when justified. | `AppShell`. |
| `Breadcrumbs` | Explain a deep detail route’s path. | normal/current; long-name truncation with accessible full label. | Mobile may reduce to Back link; RTL separator direction correct. | Use only on depth ≥2 owner/admin routes; never replace a page title. | Party, buyer, inventory, transaction, regrade detail. |

### Actions, navigation and query controls

| Component | One responsibility | Variants / supported states | Responsive, RTL and accessibility rules | Usage rules / anti-patterns | Initial consumers |
|---|---|---|---|---|---|
| `Button` | Trigger a named user action. | `primary`, `secondary`, `tertiary`, `danger`; `sm`, `md`, `lg`; normal/hover/focus/pressed/disabled/loading. | Uses native `<button>`; Arabic action verb; loading preserves accessible action name; full-width option on phone. | Exactly one primary page action; danger only for explicit irreversible effect; never use textless icon for financial/destructive action. | All routes. |
| `IconButton` | Trigger a compact, non-financial auxiliary action. | `neutral`, `danger`; normal/focus/pressed/disabled/loading. | Requires visible tooltip and `aria-label`; 48px touch target on touch layouts. | Prohibited for save, payment, delete/reverse, sale/purchase, daily close. | Dismiss banner, compact search/close only. |
| `ActionMenu` | Contain low-frequency contextual row actions. | normal/open/disabled; item `default`/`danger`. | Native/menu-button semantics; arrow/escape support; focus returns to trigger; mobile opens labelled sheet. | Never hide the only primary action or record status; dangerous item opens `SafeActionDialog`, not immediate mutation. | Materials, users, history rows. |
| `ButtonGroup` / `SegmentedControl` | Choose one small mutually exclusive option. | `single`; selected/unselected/focus/disabled/error. | Radio-group semantics; horizontal scroll avoided; labels retain units. | Only 2–4 stable choices; do not use for long material list. | Login mode, kg/ton, weight mode, payment direction. |
| `Link` | Navigate without mutation. | `standard`, `quiet`, `dangerousExternal`; focus/visited. | Native anchor; external call/WhatsApp announces destination; text wraps. | Do not make mutation look like a link; no `javascript:` URL. | Detail links, buyer contacts, help. |
| `Tabs` | Switch closely related content within one retained route/state. | selected/unselected/disabled; horizontal overflow only within tablist region. | WAI-ARIA tab pattern when panel swap is immediate; mobile scrollable labelled tablist. | Use for report type/settings subareas only; do not use as primary app navigation. | Reports, settings. |
| `FilterBar` | Display active query controls and reset state. | compact/expanded; loading/has-filters. | Mobile opens a labelled filter sheet; desktop inline; active count/clear control accessible. | A filter has a URL/API meaning; avoid decorative chips. | Inventory, history, reports, directory. |
| `SearchInput` | Submit/clear a text query. | idle, focused, loading, with-value, error. | `<input type="search">`, clear button labelled, debounce controlled outside component. | No client-side filtering of data that should be server scoped; no unlabeled magnifier-only field. | Parties, materials, directory, history. |
| `Pagination` | Navigate a stable server result set. | first/prev/next/last, current, disabled/loading. | RTL visual order respects reading direction while labels state destination; current page announced. | Use cursor/page metadata supplied by route; never fake total pages. | History, reports, directory/admin. |

### Form primitives and transaction-specific composition

| Component | One responsibility | Variants / supported states | Responsive, RTL and accessibility rules | Usage rules / anti-patterns | Initial consumers |
|---|---|---|---|---|---|
| `FormField` | Bind label, hint, control, required marker and error to one input. | `default`, `error`, `disabled`, `readOnly`, `success`; no input-type mega-prop. | Uses `<label>`/described-by IDs; error is text and icon/colour; mobile labels remain above controls. | Does not own validation rule/calculation. | All forms. |
| `TextInput` | Collect short text/phone values. | text/phone/password; normal/focus/error/disabled/readOnly. | Correct `autocomplete`, `inputMode`, `dir` isolation for phone; 48px height. | PIN uses dedicated `PinInput`; never render a money field as generic text. | Login, party, material, settings. |
| `NumericInput` | Collect decimal string input without converting it to a JS number. | `weight`, `price`, `money`, `percent`; normal/error/disabled; unit adornment. | `inputMode="decimal"`; accepts Arabic-Indic/Western digits via adapter; unit is visible and programmatically associated. | Returns raw string only; domain/preview adapter validates/calculates. | Transaction, cash, regrade, adjustment forms. |
| `PinInput` | Collect 4–6 digit operator PIN securely. | normal/focus/error/locked/disabled/submitting. | Numeric keypad hint; one accessible labelled input or correctly grouped cells; value never persisted/logged/autofilled. | Never reuse for a price/code; clear on mode/session change. | Login, user reset. |
| `SelectField` | Choose a small stable option set. | native/enhanced when necessary; normal/error/disabled. | Native select preferred on mobile; Radix accessible select only for searchable or richer desktop option use. | Not for material picking or party lookup. | Category, reason, status, unit. |
| `DateField` | Capture/display Cairo business date. | date; normal/error/disabled/readOnly. | Localized text input fallback with explicit DD/MM/YYYY hint; keyboard accessible; no inaccessible calendar-only interaction. | Does not silently use browser timezone for business-date mutation. | Reports, transactions, close, settings. |
| `Textarea` | Capture notes/reasons that can be long. | normal/error/disabled; auto-grow. | Preserves line breaks; character guidance where needed. | Use when “other” requires explanation; not for a structured field. | Adjustment, reversal, buyer relation. |
| `Checkbox` / `Switch` / `RadioGroup` | Express binary or small categorical form intent. | checked/unchecked/indeterminate where valid; focus/error/disabled. | Native control semantics, label target ≥48px. | Switch only for immediate settings, never a required confirmation; radio/segmented control for transactional choice. | Favourites, active, payment method, acceptance acknowledgement. |
| `MaterialPicker` | Select active material using favourite/frequency-first grid. | loading/empty/search/no-result/offline/stale. | Sheet on mobile, popover/command panel desktop; grid keyboard navigation; shows unit. | Never generic `SelectField`; no owner-only cost in operator data. | Purchase, sale, regrade, filters. |
| `PartyPicker` | Select recent party or create a minimally valid party in context. | loading/recent/search/no-result/duplicate/error. | Sheet/popover; accessible “create party” route/sheet; phone formatted LTR-isolated. | Operator variant excludes balance/history. | Purchase, sale, payment. |
| `TransactionLineEditor` | Compose one editable transaction line without own arithmetic. | purchase/sale; valid/invalid/stock-warning/unit-override/price-override; add/remove unsaved. | Fieldset per line; mobile stack; desktop grid; focus moves predictably on add/remove. | It receives preview view model and user intents; never imports domain math or posts data itself. | Purchase, sale. |
| `TransactionSummary` | Keep server/preview-derived net weights and totals visible. | normal/previewing/stale-preview/error/pending; owner profit extension. | Uses live region only for confirmed calculation changes; mobile sticky summary/action area. | Never displays an unconfirmed result as posted; operator variant has no profit/cost/cash total aggregate. | Purchase, sale, pending resolve. |
| `FormActions` | Standardize submit/cancel/draft status placement. | normal/submitting/success/error/offline pending/disabled. | Mobile sticky bottom action above keyboard/safe area; desktop logical inline end. | One submitting form/action owner; do not duplicate Save at page top and bottom without shared state. | All mutation forms. |
| `ValidationSummary` | Present a concise list of invalid fields after submit. | hidden/visible. | `role="alert"` only after attempted submit; links target the correct field. The route/controller moves focus to the summary, then the first invalid field. | Do not replace inline errors; do not list hidden/unauthorized fields. | Complex forms. |

### Data display and domain-specific information

| Component | One responsibility | Variants / supported states | Responsive, RTL and accessibility rules | Usage rules / anti-patterns | Initial consumers |
|---|---|---|---|---|---|
| `StatusBadge` | Give a text-first compact status signal. | transaction, directory, connection, account, allocation; success/warning/error/pending/neutral. | Text is always visible; contrast/non-colour distinction; wraps safely. | Do not turn every metadata label into a badge; never use status colour without label. | Lists, detail, Today. |
| `Amount` | Format/display a server-provided EGP amount. | `default`, `emphasis`, `positive`, `negative`, `approximate`, `unavailable`. | Uses `bdi` / LTR number isolation within RTL; currency announced/readable; never truncates. | Presentation only; no input/calculation; do not imply profit to operator. | Summary, receipts, tables. |
| `Weight` / `PriceWithUnit` | Format/display weight and unit-aware price. | default/emphasis/approximate/overridden-unit. | Unit stays adjacent; tonnes secondary hint when applicable; values are never visually reversed in RTL. | Do not display a price without `كجم`/`طن`; never auto-convert historic display. | Transaction, inventory, material, receipt. |
| `KeyValueList` / `DetailField` | Present grouped facts for one record. | `compact`, `standard`, `critical`; unavailable state. | Semantic `<dl>`; one/two column responsive grid; long values wrap. | For record inspection, not cross-record comparison. | Detail pages, cash summary, settings review. |
| `RecordList` / `ListItem` | Present scan-oriented chronological/reference collection. | `activity`, `movement`, `picker`, `buyer`; loading/empty/error handled by boundary. | List semantics; action positions use logical end; mobile-first. | Do not use where stable cross-row comparison drives a decision. | Today, cash mobile, buyer directory. |
| `DataTable` | Render comparable stable columns plus an explicit mobile summary-row renderer. | `standard`, `dense`, `selectable` only when a safe page needs selection; sort/loading/empty/error. | Semantic table/caption/scope; contained horizontal region at tablet; required `mobileRow` renderer below mobile breakpoint. | Never accept raw DB object; no financial bulk mutation; do not use for receipts/transaction editing. | Inventory, Materials, History, Reports, Users, Admin. |
| `SummaryMetric` | Render one bounded decision-supporting label/value/link. | `default`, `attention`, `approximate`, `unavailable`. | Description-list semantics; optional link names source; grid reflows. | Max six on Today; not a generic KPI/card wall. | Owner Today, Cash. |
| `Timeline` / `ActivityItem` | Explain chronological movement/change sequence. | `movement`, `audit`, `party`; pending/reversed/voided. | Ordered list; date/status/action text; no information conveyed only by a visual line. | Use for one record/party sequence, not 50k history. | Party, record, regrade detail. |
| `TransactionReceiptDocument` | Render a printable RTL document from an already scoped transaction detail model. | **Implemented:** posted/numbered; payment requires a supplied direction. Provisional/reversed variants and thermal tuning remain planned. | Article/heading semantics; print styles separate screen actions; line blocks on narrow width. | Never use for arbitrary reporting; no edit controls or owner-only cost/profit/drawer/ledger facts in print area. | Guarded receipt route. |
| `StockIndicator` | Explain last inbound/outbound/days cover without calling it lot age. | `lastIn`, `stagnation`, `cover`; available/unavailable. | Textual indicator and date; `—` has accessible explanation. | Do not label as FIFO/oldest stock; operator variant only receives permitted data. | Inventory index/detail. |
| `EmptyState` | Explain absence and route to one allowed next action. | `firstUse`, `noItems`, `filtered`, `permissionLimited`. | Heading/text/action, not illustration-dependent; screen reader coherent. | Do not use for loading/error; do not offer inaccessible actions. | Lists/forms. |
| `Skeleton` | Preserve layout during initial load. | text/list/table/form/detail. | `aria-busy` on parent; no fake semantic values. | Match target content shape; no endless skeleton after errors. | All route boundaries. |

### Feedback and overlays

| Component | One responsibility | Variants / supported states | Responsive, RTL and accessibility rules | Usage rules / anti-patterns | Initial consumers |
|---|---|---|---|---|---|
| `Alert` | Present inline contextual information/validation/safety condition. | info/success/warning/error; dismissible only when non-blocking. | Text first; associated to blocked control; errors use `role="alert"` sparingly. | Do not use toast for a stock shortfall or immutable consequence. | Sale recovery, form fields, directory disclaimer. |
| `Banner` | Present persistent route-wide system state. | offline/retrying/session/unsynced/maintenance. | Placed after header; labelled retry; does not cover form/save action. | Do not stack multiple banners without priority handling. | App shell, transaction forms. |
| `Toast` | Confirm a non-blocking completed action. | success/info/error; timed but accessible; undo only where safe. | `aria-live="polite"`; focus never moves to toast. | Not the sole success proof for financial posting; record/detail state remains source of truth. | Favourite/save relation/filter changes. |
| `Dialog` | Confirm a focused, consequential or short contextual action. | confirm/form/alert; open/submitting/error. | Radix focus trap, labelled title/description, Escape cancels only, focus returns. | Do not put long multi-line transaction entry inside; no irreversible action on Escape/overlay click. | Close day, reversal, void, payment desktop. |
| `Sheet` | Provide mobile-first contextual form/picker/action surface. | bottom/full-height/side desktop; open/submitting/error. | Safe-area, focus trap, draggable affordance only if keyboard alternative exists; stable sticky actions. | Avoid nesting sheets; route-level details remain pages. | Pickers, short forms, filters. |
| `Popover` / `Tooltip` | Provide supplementary, non-essential context. | open/closed/disabled. | Keyboard trigger/close, focus, accessible text. | Tooltip never contains a required action or error; popover not used for mobile financial form. | Help on approximate calculation, desktop picker. |
| `SafeActionDialog` | Make a destructive/irreversible ledger/access action explicit. | reversal/void/deactivate/unpublish/clear-draft; normal/submitting/error. | Names record, impact, required reason; danger action distinct; focus safe. | No generic reusable “Are you sure?” copy; use a typed action model with required consequence content. | Corrections, users, admin. |
| `ErrorState` | Explain route/content failure and safe recovery. | network/server/not-found/retryable; no raw error details. | Heading/action; preserves safe surrounding shell; status announced. | Must not disclose unauthorized resource existence. | Boundaries/data regions. |
| `PermissionState` | Explain missing capability without leaking data. | route/action; return link. | No hidden resource metadata; accessible heading. | Server must already have denied/omitted; this is not access control. | Direct route guard. |
| `OfflineState` / `ConnectionStatus` | Explain connection and locally safe retry/draft condition. | online/reconnecting/offline/safe-locally/pending-count. | Text status plus visual indicator; no colour-only dot; retry visible. | Never say posted until server confirms; operator cache excludes financial data. | App shell, transaction form. |

## Component migration order

| Milestone | Components to implement | Route adoption target | Completion evidence |
|---|---|---|---|
| Foundation | `PublicShell`, `AppShell`, `PageContainer`, `PageHeader`, layout primitives, `Button`, `FormField`, `TextInput`, `NumericInput`, `FormActions`, `ValidationSummary`, `StatusBadge`, `Alert`, state components, formatting primitives. | Login and safe empty-state shell. | RTL/responsive/keyboard component tests and rendered smoke capture. |
| Fast-record primitives | `MaterialPicker`, `PartyPicker`, `TransactionLineEditor`, `TransactionSummary`, `Sheet` and route-specific form composition. | Purchase then Sale. | One-line purchase journey and input-preservation/responsive tests. |
| Inspection primitives | `DataTable`, `RecordList`, `KeyValueList`, `Timeline`, `FilterBar`, `Pagination`, `SafeActionDialog`. | Inventory, Party, History, Cash, record detail. | Desktop table/mobile card/table semantics and scoped row action tests. |
| Specialist primitives | `ReceiptDocument`, `StockIndicator`, regrade allocation display, directory buyer cards/relation panels. | Receipts, Regrade, Directory. | Print/RTL snapshots; privacy/status tests. |
| Deletion after adoption | No legacy components currently exist. | N/A. | Confirm each future legacy consumer is migrated before removal. |

## Foundation implementation checkpoint

| Item | Status | Evidence / remaining verification |
|---|---|---|
| Next.js/React/Tailwind host, Arabic root layout and logical CSS | `IMPLEMENTED BUT NOT VERIFIED` | `npm run build` and `npm run lint` pass; production route checks confirm the safe public pages and production exclusion of `/ui-preview`. Full browser viewport/zoom inspection is blocked by the sandbox browser-download failure. |
| Shells, navigation, low-level form, state and formatting primitives | `IMPLEMENTED BUT NOT VERIFIED` | `tests/ui/foundation.test.tsx` server-renders labels, required/hint/error/unit associations, RTL numeric isolation, role-specific navigation, current state, alert/state semantics and loading button state; visual keyboard/touch tests remain open. `FormField`, `TextInput`, `NumericInput`, `FormActions` and `ValidationSummary` are presentation-only: they have no validation, calculation, draft or posting behaviour. |
| Table, overlay, picker and transaction-specific primitives | `NOT STARTED` | These must follow the trusted session/read model and the representative Purchase journey, not be created as unused abstractions. |

## Explicit anti-abstraction rules

1. Do not create a universal `Page`, `Card`, `Form`, or `Table` that conditionally implements every pattern via dozens of props.
2. Do not hide financial logic inside a generic input, table cell or summary card.
3. Do not make a reusable component fetch a wide data object then decide which fields to hide by role.
4. Do not add an icon library/dependency until the selected visual foundation actually needs it; text labels are primary.
5. Do not abstract a route-specific regrade/stock-recovery rule before two genuinely similar callers exist. Compose field/layout primitives around a typed route model instead.
6. A component may be marked `VERIFIED COMPLETE` only after its relevant normal, focus, disabled/loading, error, long-content, RTL and responsive behaviour has evidence—not merely after it renders once.
