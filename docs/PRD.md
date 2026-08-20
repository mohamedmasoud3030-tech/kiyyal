# PRD — Scrap Yard Operations System (Egypt)

**Working name:** Kayyal (كيّال)
**Version:** 2.2 (final, approved) — product definition
**Date:** 2026-08-20
**Status:** APPROVED by the owner. Technology selection may proceed. No code written yet.
**Supersedes:** v2.1 (which superseded v2.0 and v1.0)
**Audience:** the owner (review), and an AI coding agent (implementation without guessing).
**Change log:** see `docs/PRD-changelog.md` for the 2.0 → 2.1 and 2.1 → 2.2 diffs.

> **Closing corrections (approved).** Two accounting fixes before final approval: pending sales now record a
> **pending cash movement** that counts toward the physical drawer but not toward revenue or profit, converting
> atomically on posting (D32) · deferred regrade cost is held as **unallocated regrade cost** and, on resolution,
> split between quantities already sold (historical unattributed cost, sales stay `غير محسوب`) and quantities
> still in stock (inventory only) — never loading the whole cost onto remaining stock (D33). Central buyers
> directory approved for the MVP with a defined rollout order (D31).

> **Revision 2.2 summary — three corrections only, no other scope change.**
> (1) The buyers directory is redesigned as **two layers**: a central, platform-curated business directory plus a
> private per-yard relationship layer. (2) Regrade allocation now **snapshots the reference sell prices it used**,
> stores the method with the entry, and never re-derives a past regrade from today's prices; a missing price
> defers allocation instead of inventing one. (3) The hard block on selling above stock is replaced by a
> **short safe-recovery flow** that never loses a real sale and never publishes negative stock.

> **Revision 2.1 summary.** Nine owner-requested corrections: buyers directory added as an internal service
> (not a marketplace) · pricing unit overridable per transaction line · regrade costing changed from weight
> allocation to relative sales value · negative stock prohibited and replaced by opening balance / adjustment ·
> full offline capability downgraded to resilient-online pending field validation · stock age redefined so it is
> computable without lot tracking · privacy wording corrected · a defined mechanism for correcting historical
> purchases and their effect on weighted-average cost · "global standard" softened to "a proven, widely-used
> pattern in specialist systems".

---

## PART 0 — EVIDENCE SEPARATION

This document separates three different kinds of statements. Every requirement later in the document traces
back to one of them. This is deliberate: it lets the owner see exactly where confidence is high and where it is not.

### 0.A — What research established (verifiable facts)

| # | Finding | Source evidence | Product consequence |
|---|---|---|---|
| **F1** | **Pricing units differ by material.** Iron scrap is quoted **per ton** (7,500–8,500 EGP/ton, and 18,000–20,000 EGP/ton in other listings depending on grade and date). Copper, aluminium and plastic are quoted **per kilogram** (copper 350–450 EGP/kg, aluminium 150–250 EGP/kg, plastic 12–25 EGP/kg). | Egyptian daily price listings, Jan–Aug 2026 (vetogate, egyptke, unitedmetals) | **Each material must carry its own pricing unit (kg or ton).** A single-unit system would be rejected on day one. Store canonically in kg; display and price in the material's own unit. |
| **F2** | **Prices are volatile and grade-dependent.** The same metal shows wide daily ranges "حسب الجودة"; copper alone splits into red (350–470) and yellow (280–340). | Same listings; multiple dates showing movement | Confirms the owner's requirement: every transaction stores its own price; the catalogue price is a reference only. Confirms grade — not just type — is the pricing unit. |
| **F3** | **The supply chain is genuinely informal at the bottom.** Street collectors (`سريحة`) work for cash or on advances from collection warehouses, which provide them a cart and money; the warehouse sorts what they deliver. Margins per collector are small and daily. | Al Borsa field reporting on the scrap trade | Suppliers frequently have no ID, no company, no fixed name. Party records must work with a name **or** a phone, nothing more. Advances are a real mechanism. |
| **F4** | **Yards already run on weighing infrastructure and manual accounting roles.** Dealers use a `بسكول` (weighbridge) for truck loads plus small scales (2–3 ton capacity) for kilo weighing; larger yards employ staff whose only job is "weights, prices and accounts". | Al Bawabh News field reporting from the Gisr/Sabtia scrap district | Both weighing modes are real and coexist. A dedicated data-entry person exists in medium yards — supporting the operator role. |
| **F5** | **Sorting is where margin is created; holding stock is discouraged.** Egyptian Ministry of Environment / SWM-programme guidance to scrap investors: sort precisely and sell by type and grade rather than mixed by the kilo; add value before selling; **do not freeze capital in large stock waiting for prices to rise** — the trade needs daily liquidity and short buy-sell cycles. | CNN Business Arabic reporting on the Egyptian Ministry of Environment / SWM study | Justifies grade-level inventory and justifies making **stock age and cash position** first-class information. Confirms sorting matters, but also that stock is meant to turn over fast. |
| **F6** | **Specialist scrap systems converge on one recurring pattern.** The serious products we reviewed (ScrapWare, ScrapRight, Scrap Dragon, Scraplytics, WeighPay, ReSpark) are each built from the same primitives: a weigh ticket carrying gross/tare/net, grade assignment, deductions, supplier settlement, and perpetual weighted-average cost for inventory valuation. | Product documentation of six independent vendors | This is **a proven, widely-used pattern in specialist systems** — not a formal standard, and not proof that it fits Egypt. It gives reasonable confidence that the proposed core is sound, and it is corroborated by nothing else; the fit to an Egyptian yard remains subject to V5 and V11. |
| **F7** | **No Egypt-specific scrap product exists; the available Arabic alternatives are a poor fit.** Arabic options (Daftra, DEXEF, AccFlex, Phenix, SalesUp) are general accounting/ERP systems built around barcodes, piece counts, formal accounting cycles, and ZATCA/ETA e-invoicing. Egyptian scrap-adjacent apps (Big Scrappers, Khorda) are consumer collection/marketplace products, not yard operations systems. | Vendor sites and Egyptian market reporting | **The gap is real.** Positioning: weight-native, grade-native, informal-tolerant, Arabic-first, phone-first. Explicitly *not* an accounting package and *not* a marketplace. |
| **F8** | **The activity is legally regulated.** Law 202/2020 and its executive regulation require a licence from the Waste Management Regulatory Authority for non-hazardous waste handling activities, and impose record-keeping obligations on facilities. | Law 202/2020, Art. 24 & 55 and executive regulation | The product is an **internal record-keeping tool** and makes no compliance claims. Good internal records are an incidental benefit. No regulatory features without legal advice. See R-12. |

### 0.B — What the owner decided (product direction, taken as given)

| # | Owner decision |
|---|---|
| D1 | Target customer: owner of a **small-to-medium scrap yard in Egypt** that buys from suppliers, traders and `سريحة`; collects, sorts and stores; then sells to larger traders, factories, foundries and recyclers. |
| D2 | **No marketplace. No consumer/household collection app.** The product is an internal operations system for the yard itself. |
| D3 | **Single yard** in the MVP. |
| D4 | **Arabic, RTL, very simple.** Must work excellently as a **PWA on mobile and equally on desktop**. |
| D5 | **Materials are user-defined.** No fixed taxonomy may be assumed; the owner creates his own types and sub-classifications (نحاس أحمر/أصفر، حديد ثقيل/خفيف). |
| D6 | **Purchase** captures: supplier, material, weight, deduction/impurities if any, net weight, price per kg **or per ton**, total, payment method. Must be very fast — entry happens during weighing. |
| D7 | **Sale** captures: buyer, material, outgoing weight, unit price, total, collection method; deducts from stock immediately. |
| D8 | **Inventory is weight-based, not piece-based.** Quantity, weight and approximate value of every material must be visible at any moment. |
| D9 | **Every transaction stores the price it happened at.** A current reference price may exist per material but must never alter historical transactions. |
| D10 | **Parties keep a ledger:** total dealings, paid, remaining (owed to/by), payments, credit, advances if used. |
| D11 | **Cash box and daily journal:** every cash movement from purchases, sales, payments and expenses appears in the cash box; a simple daily close showing balance, movement and difference. |
| D12 | **Profitability is the owner's most important question** — "did I profit or lose", not only "how many tons do I have". Use the simplest defensible cost model (e.g. average cost per material) to show: inventory cost, sales value, approximate gross profit, and profit/margin per material. |
| D13 | **Do not invent accounting precision** for sorting/conversion of one material into several. Advanced processing is a separate topic requiring validation. |
| D14 | **Minimum practical roles:** Owner (full control), Operations/Scale staff (records permitted movements), Manager/Accountant **only if it creates a real permissions difference**. |
| D15 | **No silent deletion** of financial or weight movements. Corrections are explicit reversals with a log of who did what and when. |
| D16 | Reports required: today's purchases · today's sales · cash movement · current inventory by weight · approximate inventory value · suppliers with balances · customers with balances · approximate profit by period and material · full movement log. |
| D17 | Out of scope: marketplace · consumer app · GPS/vehicle tracking · direct scale/weighbridge hardware integration · AI · multi-branch · large ERP/general accounting · payroll/HR · advanced manufacturing · recycling-plant management · government/tax integration · e-invoicing · hazardous waste · any cosmetic feature that does not solve a real daily problem. |
| D18 | The Egyptian market is largely informal. **Success must not depend on the user having a formal accounting system or clean data.** The product replaces the notebook and the calculator gradually; it must not demand that the owner change how he works from day one. |

#### Owner decisions added in Revision 2.1

| # | Owner decision |
|---|---|
| **D19** | *(revised in 2.2)* The buyers directory is **two separate layers**: **(A) a central directory that we curate and operate as part of the service** — factories, foundries, recyclers, large wholesalers, specialist buyers — visible to every yard and **not editable by yard users**; and **(B) a private per-yard relationship layer** on top of the same buyer, visible only to that yard. It is a **business directory plus a relationship tool** that helps the owner build a selling network. Still not a marketplace: no in-app quotes, no negotiation, no payment, no purchase orders, no commission, no deal guarantee. |
| **D20** | The **kg/ton pricing unit is a per-material default that must be changeable on the individual transaction line**, because a dealer may quote the same material per ton on one deal and per kilo on the next. |
| **D21** | **Revise the regrade cost model.** Allocating cost by weight alone can produce misleading profits. |
| **D22** | **Prohibit negative stock in the MVP.** Replace it with an opening balance and a stock adjustment mechanism. |
| **D23** | **Reduce the full-offline requirement** until the field need is verified. |
| **D24** | **Do not use "age of oldest stock"** unless it can be computed without lot tracking. |
| **D25** | **Correct the privacy wording.** |
| **D26** | **Define a correct mechanism for correcting historical purchases** and its effect on weighted-average cost. |

#### Owner decisions added in Revision 2.2

| # | Owner decision |
|---|---|
| **D27** | Relative-sales-value regrade allocation is accepted **as an MVP approximation, not as accounting truth.** Every regrade must snapshot the reference sell prices it used, show them to the owner before saving, and store the allocation method with the entry so the number can be explained later. **A past regrade must never change because today's prices changed.** |
| **D28** | If an output material has no trustworthy reference price, **do not invent an allocation.** Ask the owner for a value, or leave that output's profit as `غير محسوب` until it is resolved. Keep labelling the result "approximate cost and profit". |
| **D29** | Replace the hard block on selling above stock with the **shortest possible safe-recovery flow**. Three things must hold simultaneously: negative stock never becomes a normal published state · a sale that really happened is never lost · the operator never re-enters the transaction from scratch. This scenario must appear explicitly in the acceptance criteria and the Definition of Done. |
| **D30** | The central directory's **information source and verification date must be retained for administration**, even though the source is not shown to the end user. |

#### Owner decisions and corrections closing Revision 2.2

| # | Owner decision |
|---|---|
| **D31** | **The central directory is approved for the MVP, together with the yard relationship layer** (FR-16A **and** FR-16B). We operate curation as an ongoing service. **Rollout order: (1) البحيرة, (2) الإسكندرية, (3) القاهرة والجيزة**, then the rest of the country gradually. **Starting materials:** iron, copper, aluminium, plastic, paper/cardboard. **An unverified entity must never be presented as if its data were confirmed.** |
| **D32** | **Pending stock resolution and cash.** If the operator physically received money, it cannot be ignored in the cash box until the owner posts the sale. Record a **pending cash movement** immediately, linked to the pending sale, shown to the owner as `نقدية مستلمة من عمليات معلقة`. It is **not** revenue, profit or a final party balance before posting, but it **must** be part of reconciling the physical cash in the drawer. On resolution it converts **atomically** from pending to the normal sale cash movement — no new amount created, no duplication. |
| **D33** | **Deferred regrade cost.** If a regrade is saved without complete reference prices and some outputs are sold before the cost is allocated, the later allocation must **not** load the whole cost onto the remaining inventory. Hold the source cost as **unallocated regrade cost** against the original regrade. When prices become available: allocate across the **original output quantities using the snapshots** · the share belonging to quantities already sold is recorded as **historical unattributed cost** and those sales keep showing `غير محسوب` · only the share belonging to quantities still in stock enters current inventory cost · **never rewrite past sales and never load their cost onto the remaining stock.** |

### 0.C — Assumptions still requiring validation from a real yard owner

These are stated as falsifiable claims. Each has a cheapest test. **None of them blocks building the MVP** —
the design keeps each one cheap to reverse.

| # | Assumption | Confidence | Cheapest test | Cost if wrong |
|---|---|---|---|---|
| **V1** | The scale operator will record on a phone during weighing rather than on paper. | Medium | 3 days of observation with a clickable prototype in one yard. | Fatal — pivot to owner-only end-of-day entry. |
| **V2** | ≤30 seconds per single-material purchase is achievable **and** is fast enough. | Medium | Stopwatch the prototype. | High — redesign the entry screen. |
| **V3** | The owner will maintain reference prices instead of quoting from memory. | Low–Medium | Ask him to write daily prices for 5 days. | Low — reference prices become optional; per-transaction price only. |
| **V4** | Deductions are expressed as a percentage or fixed kg (not purely "by eye"). | Medium | Look at the notebook. | Low — deduction becomes a free adjustment to net weight. |
| **V5** | Weighted-average cost produces a profit figure the owner believes. | Medium | Show one worked example and ask him to explain it back. | Medium — fall back to "sale price − last purchase price". |
| **V6** | Grade-level materials (not just type) match how they actually record. | High (F1, F2, F5 support it) | Copy the notebook's exact wording. | Low — grades are user-defined anyway. |
| **V7** | An internal, non-tax receipt is accepted by suppliers as proof. | Medium | Offer receipts for a week; count refusals. | Low — receipt becomes optional. |
| **V8** | The yard's mobile network is unreliable enough to justify a full offline queue. | **Unverified — now gating a requirement (D23)** | Open a phone inside the yard; log connectivity for 3 working days. | Low either way — the MVP ships resilient-online (FR-14) and the full queue is a SHOULD that this test unlocks. |
| **V9** | The owner accepts recording every pound (informal-economy trust barrier). | **Low — biggest risk** | Ask him directly, plainly. | Fatal — wrong customer; the data will be fiction. |
| **V10** | A single operator role is enough; no separate accountant permissions are needed. | Medium | Ask who touches the numbers besides the owner. | Low — the role model is designed to accept a third role. |
| **V11** | Sorting happens often enough that the simple regrade entry (§4, FR-9) is needed at all. | Medium | Ask how often a mixed pile is split. | Low — the feature is one screen and can be hidden. |
| **V12** | Yards will pay a monthly subscription. | Unknown | Do not test before 3 weeks of real daily usage. | Commercial, not product. |
| **V13** | The safe-recovery flow (D29) is used as an exception, not as a routine bypass, and the owner clears pending sales quickly. | **Unverified — reframed in 2.2** | In the pilot, count pending-resolution sales per week and measure how long each stays open. | Medium — if it becomes routine, the cause is bad stock discipline upstream, not the flow; address it with a guided stocktake (S-05). |
| **V14** | Owners will actually use a central buyers directory to find new buyers, and the entries are good enough to be worth trusting. | **Low–Medium — the whole of FR-16A depends on it** | Show one owner a paper list of 15 real buyers for his top material in his governorate. Does he call any of them? | Medium–High — the central layer is the expensive half; if unused, keep only the private relationship layer (FR-16B). |
| **V15** | The per-line kg/ton override (D20) is actually used, and is not itself a source of error. | Medium | Count overrides in the pilot; check for magnitude mistakes. | Low — if unused, hide the toggle behind the material default. |
| **V16** | Reference sell prices are maintained well enough for relative-sales-value regrade allocation to be meaningful (FR-9). | Medium | Same test as V3. | Medium — fall back to owner-entered manual allocation percentages. |

---

## PART 1 — PRODUCT DEFINITION

### 1. Value proposition

> **كيّال** is an Arabic, phone-first system that turns a scrap yard's notebook and calculator into a live
> record of weight, money and stock — so the owner knows at any moment what he has, who owes him,
> how much cash is in the box, and whether he is actually making money.

**Positioning against the alternatives (from F7):**

| Alternative | Why it loses |
|---|---|
| The paper notebook | No stock balance, no party balances, no profit, no search, easily lost. But it is **fast** — that is the bar we must beat. |
| Arabic ERP (Daftra / DEXEF / AccFlex) | Built for pieces and barcodes, not weight and grade. Assumes formal accounting and e-invoicing. Too many screens for a man standing at a scale. |
| Foreign scrap software (ScrapRight / Scrap Dragon) | Right model (F6), wrong reality: English, LTR, desktop scale-house, compliance features for US law, priced in dollars, integrated with hardware nobody here owns. |
| Egyptian scrap apps (Big Scrappers / Khorda) | Consumer collection and marketplace. They are the yard's *supplier channel*, not its operations system. |

**One-line positioning:** the only scrap-yard operations system that is weight-native, grade-native, Arabic-first,
tolerant of informal data, and fast enough to use while a truck is on the scale.

### 2. Target users and jobs-to-be-done

| User | Reality | Jobs to be done |
|---|---|---|
| **Owner (`صاحب المخزن`)** | Decision maker, holds the money, sets prices, often but not always on-site. Literate but not an accountant. Uses both phone and a desktop/laptop in the office. | "Did I profit today?" · "How much of each material do I have and what is it worth?" · "Who owes me and whom do I owe?" · "How much cash should be in the box right now?" · "What did my staff record while I was out?" · "Change today's price in seconds." |
| **Operator / scale staff (`الوزّان / موظف التشغيل`)** | Records purchases and sales at the scale. Cheap Android phone, dirty hands, a truck waiting. May be the owner's son, a clerk, or (in medium yards, per F4) a dedicated weights-and-accounts person. | "Record this load correctly and fast." · "Know today's price so I don't have to ask." · "Give the supplier something he accepts." · "Not be blamed for money I didn't take." |

**Not users in the MVP:** accountants (see §6), household sellers, factory buyers, drivers, regulators.

### 3. Pain points → outcomes

| # | Pain (grounded in F3, F4, F5 and the notebook reality) | Outcome |
|---|---|---|
| P1 | Cash flows all day with no record; the box never reconciles. | Every pound is tied to a transaction, a payment or a categorized expense. Daily close in under 2 minutes. |
| P2 | Deductions for rust, moisture and dirt are agreed verbally and forgotten → disputes. | Deduction is a recorded field; the receipt shows gross → deduction → net. |
| P3 | Stock by grade is unknown; the owner guesses what he can sell. | Live kg balance per material grade, plus approximate value. |
| P4 | "Money in vs money out" is mistaken for profit; a good day of buying looks like a loss. | Gross profit computed against weighted-average cost, independent of cash timing. |
| P5 | Open balances with suppliers and customers live in the owner's head. | Party ledger with running balance and clear "له / عليه". |
| P6 | Prices move daily (F2); staff quote yesterday's price. | Reference price editable in ≤3 taps; every transaction freezes its own price (D9). |
| P7 | Capital silently freezes in slow-moving piles — the exact mistake the Ministry study warns against (F5). | Stock age visible per material; slow movers surfaced. |
| P8 | The owner cannot see the yard when he is away. | Same live data on his own phone, anywhere. |
| P9 | Paper records can be altered or lost; no accountability. | Sequential immutable numbering, reversal-only corrections, full audit log (D15). |

---

## PART 2 — MVP SCOPE

**Scope rule:** the MVP replaces the notebook, the calculator and the cash drawer. Nothing else.
Any addition must displace something on the MUST list.

### 4. In scope

1. **Materials** — user-defined types and sub-grades (D5), each with a **default pricing unit (kg or ton)** that can be **overridden on any individual transaction line** (F1, D20), plus a reference buy price and a reference sell price (D9).
2. **Purchase** — supplier, multi-line materials, gross weight, deduction, net weight, unit price with its unit, total, payment (cash now / partial / credit) (D6).
3. **Sale** — buyer, materials, outgoing weight, unit price, total, collection (cash / partial / credit), immediate stock deduction (D7). **Blocked if stock is insufficient** (D22).
4. **Weighing modes** — direct net entry (kilo scale) **and** gross/tare entry (`بسكول`, per F4).
5. **Inventory** — live kg per material, weighted-average cost, approximate value, and **stagnation indicators computable without lot tracking** (D24, F5).
6. **Parties** — one register for suppliers and customers: dealings, paid, remaining, payments, credit, advances (D10).
7. **Buyers directory** — two layers: a **central curated directory** of factories, foundries, recyclers and large buyers that we operate and yards can only read, plus a **private per-yard relationship layer** on top of it (D19, FR-16). **Not a marketplace.**
8. **Cash box and daily close** — all cash movements, expenses with categories, expected vs counted, difference (D11).
9. **Profitability** — inventory cost, sales value, approximate gross profit, profit and margin per material (D12), using perpetual weighted-average cost (F6).
10. **Simple regrade (`فرز بسيط`)** — with **relative-sales-value cost allocation** (D21); see the decision note below.
11. **Opening balances and stock adjustment** — the only ways stock moves without a transaction; they replace negative stock entirely (D22).
12. **Historical purchase correction** — a defined mechanism with a hard boundary at the daily close (D26, FR-10).
13. **Receipts** — sequential, internal, non-tax; shareable to WhatsApp and printable.
14. **Reports** — the nine reports in D16.
15. **Roles** — Owner and Operator (see §6 for why not three).
16. **Corrections** — reversal only, never deletion, with a full audit log (D15).
17. **Arabic RTL**, responsive for phone **and** desktop, installable PWA, **resilient-online recording** — no data loss on a dropped connection (D4, D23, FR-14).
18. **Export** — the owner can export all of his own data (CSV).

#### Decision note on item 10 — regrade costing, revised in 2.1 (D21)

**The 2.0 model was wrong, and the owner is right to reject it.** Allocating the consumed cost pro rata by
weight produces actively misleading profit figures. Worked example:

> A yard buys 1,000 kg of `خردة مخلوطة` at 20 EGP/kg → cost 20,000 EGP.
> Sorting yields 100 kg of copper and 900 kg of iron.
> **Weight allocation (2.0):** every output carries 20 EGP/kg. Copper (market ≈400/kg) shows a fantasy profit of
> ~380/kg, while iron (market ≈8/kg) shows a guaranteed loss of ~12/kg on every future sale.
> The owner would conclude that iron is a losing business and that sorting copper is free money. **Both false.**

**The 2.1 model: allocate the consumed cost in proportion to the relative sales value of the outputs**, using
each output's reference sell price at the moment of the regrade. Same example:

> Copper 100 × 400 = 40,000 · Iron 900 × 8 = 7,200 · Total notional value = 47,200
> Copper share = 20,000 × 40,000/47,200 = **16,949 EGP → 169.49/kg**
> Iron share  = 20,000 ×  7,200/47,200 = **3,051 EGP → 3.39/kg**
> Both now sell at a sane, comparable margin. Neither is fictitious.

This is the standard treatment for splitting a joint cost, it is a single line of arithmetic, and it requires no
data the yard does not already have. Weight allocation is **removed**, not kept as an option.

**Scope discipline is unchanged (D13).** Still excluded: processing cost, labour, yields, work-in-progress,
baling, cutting, shredding. The regrade entry moves weight and splits the cost that already exists — nothing more.
It remains labelled `توزيع تقريبي بقيمة البيع` and V11/V16 test whether it is needed and whether it works.

### 5. Out of scope — explicitly excluded

All of D17, restated as binding, with the reason each is excluded:

| Excluded | Reason |
|---|---|
| Marketplace / buyer matching | Owner decision. Different product, different business model. **Note the boundary with the buyers directory (D19, FR-16):** the directory is the owner's private notebook of his own buyers, visible only to him. It becomes a marketplace the moment data crosses between yards, buyers get accounts, listings are published, or the platform matches parties — none of which is in scope, now or in the MVP's successor. |
| Consumer / household collection app | Owner decision. That is Big Scrappers' territory (F7). |
| GPS, vehicle tracking, dispatch, routes | Not a single-yard problem. |
| Direct weighbridge / scale hardware integration | Owner decision. Requires on-site hardware work per yard; manual entry is faster to ship and cheaper to support. |
| AI / ML / forecasting | No data exists yet. Cosmetic at this stage. |
| Multi-branch, inter-yard transfers | Owner decision (D3). *The data model must allow it later; the UI must not show it.* |
| Full ERP / general ledger / double-entry accounting | Owner decision + D18: the target user has no accountant. |
| Payroll, HR, attendance | Different product. |
| Advanced processing: baling, shearing, shredding, yields, processing cost | Owner decision (D13). Needs real validation. |
| Recycling-plant / factory management | Different customer. |
| Government or tax integration, ETA e-invoicing | Owner decision. Requires tax registration and e-signature; in an informal market it actively repels the customer (V9). |
| Hazardous waste | Owner decision. Legally distinct regime under Law 202/2020 (F8) requiring separate licensing. |
| Barcodes, RFID, piece counting | The unit is weight (D8). |
| Multi-currency | EGP only. |
| English UI | Arabic only at launch; strings externalized so English is later configuration, not a rewrite. |
| Notifications, dashboards, gamification, loyalty | Cosmetic. Fails the D17 test. |

### 6. Roles and permissions — and why two, not three

**Decision: two roles in the MVP.** D14 permits a third "Manager/Accountant" role *only if it creates a real
permissions difference*. It does not, at this scale:

- The target yard (D1) is small-to-medium. Per F4, dedicated accounts staff appear in the **larger** yards.
- A third role would be defined as "everything the owner can do except manage users and change prices" — a
  distinction with almost no operational consequence in a one-yard business, at the cost of a whole permissions
  matrix, extra QA surface, and a more confusing setup screen.
- **The role model is built to accept a third role without migration** (permissions are checked per capability,
  not hard-coded to two roles). V10 tests whether it is needed. If yes, it is a configuration change, not a rewrite.

| Capability | Owner | Operator |
|---|:---:|:---:|
| Record purchase / sale | ✅ | ✅ |
| Record a cash expense | ✅ | ✅ — category required; shown in owner's daily summary |
| Record a party payment (قبض/صرف) | ✅ | ✅ — cash only, requires party |
| View own transactions, current day | ✅ | ✅ |
| View all history, any date, any user | ✅ | ❌ |
| See cost, profit, margin | ✅ | ❌ |
| See cash box total | ✅ | ❌ — can add and remove cash, cannot see the balance |
| Create / edit materials and reference prices | ✅ | ❌ — read-only, sees today's reference price |
| Transact at a price differing from the reference | ✅ | ⚠️ allowed, recorded as an override, flagged to the owner |
| Create a party | ✅ | ✅ |
| Buyers directory: browse central entries (FR-16A) | ✅ | ❌ |
| Buyers directory: edit central entries | ❌ — platform administration only | ❌ |
| Buyers directory: report a problem with a central entry | ✅ | ❌ |
| Yard relationship layer (FR-16B): view and edit | ✅ | ❌ — contains negotiated prices and terms |
| Resolve a `pending_stock_resolution` sale | ✅ | ❌ — may create one, cannot clear it |
| Override the pricing unit on a line (kg ↔ ton) | ✅ | ✅ — recorded; magnitude check applies (E17, R13) |
| Regrade (`فرز بسيط`) | ✅ | ❌ |
| Opening balances and stock adjustment | ✅ | ❌ |
| Historical purchase correction / cost adjustment | ✅ | ❌ |
| Reverse a transaction | ✅ | ❌ — may request; owner approves |
| Daily close | ✅ | ❌ |
| Manage users, export data, settings | ✅ | ❌ |

**Invariants:** exactly one active owner at all times · nothing is ever hard-deleted · every record stores actor,
server time and device time · deactivating a user preserves all their history.

---

## PART 3 — FUNCTIONAL REQUIREMENTS

Format: requirement, then Given/When/Then acceptance criteria. These are binding.

### FR-1 — Materials (D5, F1, F2, D20)
The owner defines his own material tree: a **type** (حديد) and an optional **grade** (ثقيل). No taxonomy is
imposed. Each material carries a **default pricing unit**, a reference buy price, a reference sell price, and an
active flag.

- Given the owner creates a material "حديد – ثقيل" with **default pricing unit = ton**, buy 8,000 and sell 8,600, then purchase and sale screens default to prices per ton and accept weights in kg.
- Given a material has **default pricing unit = kg**, then its prices default to per kg.
- **Given any transaction line, when the user taps the unit control, then the unit switches between `كجم` and `طن` for that line only** (D20). The material's default is unchanged, the entered price is **not** auto-converted (the user is quoting a different price, not the same one), and the line recomputes immediately so the total is visible before saving.
- Given a line's unit differs from the material default, then the line is visibly marked, the unit is printed on the receipt, and the plausibility check (E17) is applied against the line's own unit.
- Given a purchase of 1,250 kg of a ton-priced line at 8,000 EGP/ton, then the line total is 10,000.00 EGP and the receipt shows both the per-ton price and the kg weight.
- Given the owner changes a reference price, then **no existing transaction changes** (D9); only subsequent transactions default to the new price.
- Given a material has non-zero stock or any history, when deletion is attempted, then it is blocked; only deactivation is allowed (hidden from new transactions, preserved in history).
- Given first-time setup, then the app offers an **optional, fully editable** starter list (Appendix A) which the owner may accept, edit wholesale, or skip entirely. It is a suggestion, never a constraint.
- Materials can be reordered and marked as favourites so the most-used appear first in the entry grid.

### FR-2 — Purchase (D6)
- Given a purchase line of 100 kg at 20 EGP/kg with a 5% deduction, then net = 95.00 kg and total = 1,900.00 EGP, both visible **before** saving.
- Given the deduction is entered as fixed kg instead of a percentage, then net = gross − kg.
- Given deduction ≥ gross, then saving is blocked with a clear Arabic message.
- Given a multi-line purchase, then the grand total is the sum of line totals, and the receipt itemizes each line.
- Given the payment is "cash, full", then it is the **default** and requires no extra input.
- Given the payment is partial or on credit, then the remainder posts to the party balance automatically.
- On save: stock increases per line · weighted-average cost recalculates · cash box decreases by cash paid · party balance updates · a sequential receipt number is assigned.
- Given the operator enters a price different from the reference, then the transaction is saved with a price-override flag and appears in the owner's daily summary.
- **Performance requirement: a single-line cash purchase must be completable in ≤30 seconds** (V2), and in ≤6 interactions after opening the screen.

### FR-3 — Sale, and the safe-recovery flow (D7, D22, D29)
- Same arithmetic as FR-2, in the opposite direction, with the same per-line unit handling.
- Given a sale is posted, then each line stores a **cost snapshot** = the material's weighted-average cost at that moment, and gross profit = line total − (net kg × cost snapshot).
- Given the user is an operator, then no cost, profit or margin figure appears anywhere on the screen or on the receipt.

**Selling above the recorded balance — safe recovery, revised in 2.2 (D29).**
2.1 blocked the sale outright. That was wrong in the one situation that matters: the material has physically left
the yard, the buyer has paid, and the only thing missing is a bookkeeping entry. **The truck must never wait for
the software.** The flow below satisfies all three of the owner's constraints at once.

*Common to both roles:* the shortfall is shown plainly — material, required kg, available kg, the difference — never a generic refusal.

| Signed-in user | Behaviour |
|---|---|
| **Owner** | An inline shortcut on the same sale screen: choose `تسوية مخزون` (reason required) or `تسجيل شراء ناقص`, enter the quantity and cost, and the sale **posts immediately** in the same interaction. No navigation away, nothing re-entered. |
| **Operator** | Cannot invent stock. The sale is **saved in full** with status `pending_stock_resolution` — every line, weight, deduction, price, party and cash amount preserved exactly as entered. The operator hands over the goods and continues working. |

Rules for `pending_stock_resolution` — it reuses the `pending_tare` pattern already in the product (FR-4), so it is
one more status, not a new subsystem:
- It affects **no posted figure**: no stock movement, no revenue, no profit, no final party balance, no sequential sale number. Therefore **no negative stock is ever created or published** (D22 holds).
- It appears at the top of the owner's attention list and **blocks the daily close** until it is resolved or voided with a reason.
- **Cash actually received is recorded immediately as a `pending` cash movement linked to the sale (D32).** It is shown to the owner under `نقدية مستلمة من عمليات معلقة`, it is **excluded** from revenue, profit and the party's final balance, and it is **included** in reconciling the physical drawer (FR-7). Money that is in the drawer must be visible in the drawer's expected total — anything else guarantees a false shortage at close.
- **On resolution the same movement converts atomically from `pending` to the sale's normal cash movement.** No new amount is created, the identifier is preserved, and the amount can never appear twice. If the conversion fails, the whole posting fails and nothing changes.
- The operator may print a **provisional slip** (`إذن تسليم مبدئي`) showing weights and total, explicitly **not** a numbered receipt. The numbered receipt is issued on posting and can be sent by WhatsApp afterwards.
- The owner resolves it in one tap from the attention list: he sees the same shortfall, picks adjustment or missing purchase, and the sale posts atomically with **the original data, the original device timestamp, and the original business date** if that day is still open.
- Given the day it happened has already closed, then the sale posts to the current open day with an automatic note naming the original date (consistent with E11).
- Given the sale was not real, the owner voids it with a reason; it remains visible as voided, never deleted (D15). **If a pending cash movement exists, voiding requires stating what happened to the money** — returned to the customer (the pending movement is reversed, with the reversal visible) or retained (the sale must be posted properly instead). The money can never disappear silently.
- Repeated use is visible: every pending-resolution sale is in the audit log with its operator, so the owner can see if it is becoming a routine bypass rather than an exception (R19).

**Acceptance criteria for this flow (D29 — explicitly required):**
- Given an operator sells 500 kg of a material with 300 kg recorded, then the sale is saved with all details intact, the operator is not blocked from continuing, stock remains 300 kg, and no posted balance changes.
- **Given that sale collected 12,000 EGP in cash, then a pending cash movement of 12,000 exists immediately, appears under `نقدية مستلمة من عمليات معلقة`, is excluded from revenue and profit, and is included in the drawer's expected total (D32).**
- Given the owner then resolves it with a 200 kg adjustment, then the sale posts atomically, stock becomes 0 kg, **the same 12,000 movement converts from pending to the sale's cash movement without creating or duplicating any amount**, the party balance updates, the receipt is numbered, and **no field was re-entered by anyone**.
- Given the owner attempts a daily close while a pending-resolution sale exists, then the close is blocked and the sale is named.
- Given the owner is the one selling, then the shortfall, the adjustment and the sale are completed in a single screen without navigation.
- At no point, in any path, does any material's published balance go below zero, and at no point is a received amount counted twice or lost.

### FR-4 — Weighing modes (F4)
- **Direct mode:** the user enters the net weight from the kilo scale.
- **Gross/tare mode (`بسكول`):** gross-in and tare-out are entered; net = gross − tare, displayed prominently.
- Given tare ≥ gross, then saving is blocked.
- Given a net weight is split across several materials, then the split must sum exactly to the net; otherwise saving is blocked, showing the remaining difference.
- Given a truck has been weighed in but not out, then the transaction may be saved as **pending tare**; it does not affect stock, cash or balances until completed, it is listed prominently, and it **blocks the daily close** until completed or voided by the owner.
- The mode is remembered per user as a default, and switchable in one tap.

### FR-5 — Inventory, opening balances and adjustments (D8, D22, D24)
- Stock is **derived**, never edited directly: Σ purchase net − Σ sale net ± regrade ± adjustments ± opening balance, counting posted entries only, with reversals netted out.
- Given any posting or reversal, then affected balances update immediately.
- **Stock can never go negative** (D22). Every operation that would drive a material below zero is blocked at save time, server-side, with the offending material and the shortfall named.
- **Opening balance:** at setup, or at any later time for a newly added material, the owner may enter a starting quantity in kg with a cost per kg. It posts as an `opening` entry, is visible in the movement log, and seeds the weighted-average cost. Entering a cost is optional; if omitted, see E19.
- **Stock adjustment (`تسوية مخزون`):** owner only, with a mandatory reason — physical count / loss / theft / weighing error / correction — and an optional note. It may increase or decrease stock. A decrease is capped at the available quantity. An increase requires a cost per kg (defaulting to the current average) so that valuation stays coherent.
- Together, opening balance and adjustment are the **complete replacement** for negative stock: any real-world situation that used to produce a negative balance is now expressed as an explicit, attributable, reasoned entry.

**Stock age without lot tracking (D24).** The MVP does not track lots, so "age of the oldest remaining stock" is
not computable and has been removed. It is replaced by three indicators that are computable from the movement
ledger alone:

| Indicator | Definition | Purpose |
|---|---|---|
| `آخر توريد` | Days since the last inbound movement for this material. | Is anything still coming in? |
| `آخر صرف` (stagnation) | Days since the last outbound movement for this material. **This is the headline "stagnation" figure.** | The pile nobody has touched — the F5 warning about frozen capital. |
| `تغطية المخزون` | Current kg ÷ average daily outbound kg over the trailing 30 days, expressed in days. Shown as `—` when there were no outbound movements in the window. | How long the current pile would last at the recent rate. |

- All three are labelled as indicators, not as inventory age, and none implies FIFO or lot-level accuracy.
- The inventory screen shows per material: kg on hand · weighted-average cost per unit · approximate total value · the three indicators above · default pricing unit.
- Totals per material type and a grand total inventory value are shown.

### FR-6 — Parties (D10, F3)
- One register serves suppliers and customers; a party may be both (default).
- **Name or phone is sufficient** — both are optional individually, at least one required (F3). Optional: national ID, address, notes.
- Given a phone is entered that already exists, then the app offers the existing party rather than creating a duplicate.
- The party screen shows: total dealings · total paid · **running balance with an explicit direction label (`له` we owe / `عليه` they owe)** · full chronological history with the balance after each entry.
- **Payments and advances use one mechanism:** a payment entry with no linked transaction is an advance and simply moves the running balance. No separate advance feature, no separate ledger. Advances are therefore supported from day one (D10, F3) at near-zero complexity.
- Given a payment is recorded, then the cash box and the party balance both move and a payment receipt is produced.
- Duplicate-payment guard: warn when an identical amount is recorded for the same party within 5 minutes.

### FR-7 — Cash box and daily close (D11)
- Opening balance = the previous day's counted closing amount (or a value the owner sets at first use).
- Every cash-affecting event appears in the day's movement list with type, amount, party or reason, and user.
- Expenses require a category (وقود / أجور / أكل / نقل / إيجار / صيانة / أخرى) and an amount; "أخرى" requires a note.
- Given the owner closes the day with expected 45,000 and counted 44,600, then a difference of −400 is recorded and permanently visible. **The close is never blocked by a difference** (D18: reality is messy), but the difference cannot be hidden or edited afterwards.

**Pending cash from unresolved sales (D32).** Money received against a `pending_stock_resolution` sale is real
money sitting in the drawer, so it must appear in the drawer's expected total — otherwise every close shows a
false shortage.
- The cash box shows two lines, never merged: `الرصيد المتوقع من العمليات المرحّلة` and `نقدية مستلمة من عمليات معلقة`, then `إجمالي المتوقع في الدرج` as their sum.
- Only the first line feeds revenue, profit and party balances. The **sum** is what the counted amount is compared against.
- A pending cash movement carries `status = pending`, is linked to its sale, and is listed in the day's movements marked as pending.
- On resolution the movement flips to `posted` **atomically with the sale** — the same record, the same amount, no new movement created (see FR-3).
- In practice a pending sale blocks the daily close anyway, so this state is short-lived; the two-line presentation exists so the drawer reconciles correctly at any moment during the day.
- Given a day is closed, then it is immutable; later entries are dated to the current open day with a note.
- The owner may operate without ever closing a day; the cash box still works. Closing is encouraged, not enforced.

### FR-8 — Profitability (D12, F6)
- Costing model: **perpetual weighted moving average per material**, the industry standard (F6).
- Displayed figures: inventory cost · sales value · approximate gross profit · profit and margin **per material** · all filterable by period.
- Every profit figure in the UI is labelled **approximate** (`تقريبي`) and is accompanied by a one-line, plain-Arabic explanation of how it was computed, reachable in one tap. The owner must be able to see the arithmetic (V5).
- Gross profit excludes operating expenses by default; a secondary line shows "profit after expenses" for the same period so the owner sees both.

### FR-9 — Simple regrade (`فرز بسيط`) — revised in 2.1 (D21), refined in 2.2 (D27, D28)
- Owner only. Input: source material and kg consumed; output: one or more materials with weights; an explicit loss line is permitted.
- Given outputs plus loss do not equal the input weight, then saving is blocked.
- Given the input quantity exceeds available stock, then saving is blocked (D22).
- **Cost allocation is by relative sales value at the moment of the regrade**, not by weight. The consumed value is split across outputs in proportion to (output kg × that output's reference sell price per kg). Loss carries no value of its own; its cost is absorbed by the outputs through the same proportions.

**Snapshot and explainability (D27).** The allocation is an approximation, and the product must be able to defend
the number months later:
- Given a regrade is saved, then it **stores with the entry**: the allocation method used (`relative_sales_value` or `weight_fallback`), and a **snapshot of every reference sell price and unit used in the calculation**, with the timestamp.
- Given the owner later changes a reference sell price, then **no past regrade changes** — not its allocation, not its cost per kg, not any downstream average cost. Past regrades are read from their snapshot, never re-derived.
- Given the owner opens a past regrade, then he sees the prices that were used, the method, and the resulting cost per kg per output — the full arithmetic, in one screen.
- **Before saving**, the screen shows the snapshot prices it is about to use and the resulting cost per kg for every output, so the owner can sanity-check them against what he knows the material is worth.
- Every resulting figure is labelled `تكلفة وربح تقريبي`.

**Missing or untrustworthy reference price (D28, D33).** Never invent an allocation. Two paths, both offered on the same screen:
- **Recommended:** the owner enters a reference value for the missing output inline, and the allocation completes normally.
- **Defer:** the regrade posts the **weight movement immediately** — stock is correct straight away, which is what operations need — while **the entire consumed value is held as `unallocated_regrade_cost` against the regrade entry** (D33). Allocation is all-or-nothing: partially allocating among the priced outputs only would push the whole cost onto them and reproduce exactly the distortion this design exists to prevent. All outputs of that regrade are flagged `تكلفة غير محددة`, any sale of them reports profit as `غير محسوب` (consistent with E19), and the unallocated amount appears in the owner's attention list until resolved.

**Resolving a deferred allocation later (D33) — the part that must not be got wrong.**
By the time the owner supplies the missing price, part of the output may already have been sold. Loading the whole
cost onto what is left would overstate the remaining inventory and understate nothing — a silent, compounding error.

1. Allocate across the **original output quantities** recorded at the regrade, using the **stored snapshots** for outputs that had a price and the newly supplied value for the one that did not. The newly supplied value is itself snapshotted at this moment and stored with the entry.
2. For each output, split its allocated value in proportion to how much of that original quantity has since left stock:
   - **Sold share → historical unattributed cost.** It is recorded against the regrade as `تكلفة فرز غير منسوبة`, reported as a named line in the **current** period, and **not** added to any inventory. The sales it relates to keep showing `غير محسوب` and are **never rewritten** (consistent with D26).
   - **Remaining share → current inventory cost.** Only this portion is added to the material's inventory value, and the weighted-average cost is recomputed over the quantity currently on hand.
3. Quantity sold since the regrade is measured from the movement ledger (outbound of that material between the regrade and the resolution, capped at the original output quantity). **This is an approximation** — the MVP has no lot tracking (D24) and stock is fungible — and it is labelled as such, like every other figure in this feature.
4. The screen shows, before confirming: original quantities, snapshot prices, allocated value per output, the sold/remaining split, and the two resulting amounts. Nothing is applied silently.

- Given every output has a reference sell price of zero, then allocation falls back to weight, the method is recorded as `weight_fallback`, and the screen says so explicitly.
- The entry appears in the movement log and is reversible like any other entry.

### FR-10 — Corrections, and correcting historical purchases (D15, D26)
- No entity that affects money or weight can be deleted. Correction = a reversal entry referencing the original.
- Reversal requires a reason from a short list: wrong weight / wrong price / wrong unit / wrong party / duplicate / deal cancelled / other (note required).
- The original remains visible, marked reversed; its receipt is marked cancelled. Reversal uses the **original** values, never current prices.
- Stock, cash, party balance and profit all reverse together, atomically.
- The audit log records actor, server time, device time, action, entity and before/after values. It is owner-visible and cannot be edited or cleared by anyone in the app.

**Correcting a historical purchase and its effect on weighted-average cost (D26).**
A purchase recorded at the wrong weight or price has already contaminated the material's average cost, and
possibly the cost snapshots of every sale made after it. The MVP resolves this with **one hard boundary: the
daily close.**

| Situation | Mechanism | Effect on weighted-average cost |
|---|---|---|
| **The purchase is in an open (not yet closed) day** | **Reverse and re-enter.** The system then **replays** that material's movements from the corrected entry forward, in deterministic order `(business_date, created_at, id)`, recomputing the running average cost and the cost snapshot of every subsequent sale in the open period. | Fully corrected. Profit figures for the open period become accurate. |
| **The purchase is in a closed day** | **No retrospective rewrite.** The owner records a **cost adjustment (`تسوية تكلفة`)** dated today, stating the corrected value. It moves the material's inventory value and average cost **from today forward**, and posts the difference as a named line in the current period's profit: `فروق تصحيح مشتريات سابقة`. | Corrected prospectively. Closed-day reports never change. |

Rules that make this safe and implementable:
- **A closed day is immutable.** No mechanism in the product may alter a figure the owner has already seen, counted and signed off. This is deliberate: silently changing last week's profit destroys trust faster than a known error.
- Replay is bounded to a single material and to entries at or after the corrected one — it is not a full-ledger recomputation, and on a single-yard MVP it is a small, fast operation.
- Given a replay would drive the material's running balance negative at any point in the sequence, then the reversal is **blocked** and the app directs the owner to the cost adjustment route instead (consistent with D22).
- Given a cost adjustment is posted, then it appears in the movement log, requires a reason and a reference to the original transaction where known, and is itself reversible.
- The owner is always told, in one plain-Arabic sentence, which of the two routes is being used and why.
- A purchase in an open day that has **not** yet been consumed by any sale is the simple case: reverse, re-enter, replay touches nothing else.

### FR-11 — Receipts (V7)
- Purchases, sales and payments produce a receipt: sequential number · date and time · yard name · party · itemized lines (material, gross, deduction, net, unit price and its unit, line total) · grand total · amount paid · remaining balance · recording user.
- Marked clearly `إيصال داخلي — غير ضريبي`.
- Shareable as an image or PDF (WhatsApp is the primary channel) and printable at A5 and 80 mm thermal widths.
- Receipts are optional per transaction — never a blocking step (D18).

### FR-12 — Reports (D16)
All nine, each filterable by date range and exportable to CSV:
today's purchases · today's sales · cash movement · current inventory by weight · approximate inventory value ·
suppliers with balances · customers with balances · approximate profit by period and material · full movement log.

- The full movement log is searchable by party, material, user, type, amount range and date, and paginates.
- The owner's home screen is the "today" view: purchases, sales, cash in, cash out, expenses, expected cash, approximate profit, and an **attention list** (price overrides, negative stock, pending tare, expenses above a threshold, unsynced items).
- Reports must render in under 2 seconds on a mid-range Android over 3G.

### FR-13 — Users and access (D14)
- Owner signs in with phone + password. Operators sign in with a display name + 4–6 digit PIN.
- 5 failed PIN attempts → 15-minute lock, owner notified in-app.
- Operator session re-authenticates after 12 hours idle.
- Fast user switching on a shared device (the realistic scenario) without a full logout.
- The owner can deactivate an operator instantly; history is preserved.

### FR-14 — Connectivity resilience — reduced in 2.1 (D23, V8)
**2.0 required a full offline-first queue. 2.1 does not.** The owner is right that this is unvalidated: it is one
of the most expensive things in the build (sync conflicts, number assignment, replay, merge testing), and nobody
has yet measured the network inside a real yard. The MVP therefore ships **resilient-online**, which delivers the
part that actually matters — *no lost entry* — at a fraction of the cost.

**In the MVP (MUST):**
- The app is an installable PWA whose shell loads from cache, so it opens instantly and does not show a browser error when the signal drops.
- Reference data (materials, reference prices, favourites, recent parties) is cached and readable offline, so the operator can always see today's price.
- **A save that is interrupted by a lost connection is never lost.** The entry is held locally, the user sees a clear `لم يتم الإرسال — جاري إعادة المحاولة` state, and it retries automatically with an idempotency key that guarantees it posts exactly once.
- A visible connection indicator and a pending count; a manual retry control.
- Drafts of in-progress entries survive an app close or a device restart (E8).
- Sequential numbers are assigned **by the server**, and every write carries a **client-generated idempotency key** — both kept in the MVP even though they are only strictly needed for the full queue, because they are cheap now and make the next step non-breaking.

**Deferred to SHOULD, unlocked by V8 (S-09):** a full offline queue — recording many transactions over hours with
no connectivity, batch sync, and conflict handling.

**Explicit trade-off the owner is accepting:** if the yard genuinely has no signal for long stretches, the MVP
will be frustrating there until S-09 ships. The V8 test costs one phone and three days and should be run during
the pilot, before that decision is locked.

### FR-15 — Setup (D18)
- First run must take under 10 minutes: yard name → optionally accept/edit the starter materials → set reference prices → set the opening cash balance → start recording.
- **No opening stock is required.** The yard can start from zero and let balances build; or the owner can enter opening stock per material with a cost, as a single optional step.
- No supplier or customer list needs to be prepared in advance; parties are created inline while recording.

### FR-16 — Buyers directory — **redesigned in 2.2** (D19, D30)

Two separate layers over the same buyer. Layer A is ours and is shared; Layer B is the yard's and is private.
Together they are a **business directory plus a relationship tool** that helps an owner build a selling network.

#### FR-16A — Kayyal Buyers Directory (central, curated by us)

A catalogue of real buying entities that we maintain and operate as part of the service: **factories · foundries ·
recycling companies · large wholesalers · specialist buyers.**

- Per entity, populated as far as information is available: name · entity type · governorates / areas served · materials purchased · phone · WhatsApp · address · minimum quantity if known · **whether they collect or the seller delivers to them** · verification status · date last verified.
- **Administrative-only fields, stored but never shown to yard users (D30):** the internal source of the information, who entered or last verified it, and the verification note.
- **Status vocabulary:** `active` (verified and current) · `unverified` (recorded but not yet confirmed) · `outdated` (verification is stale or the last contact attempt failed). Status and the last-verified date are **shown to the user** so he can judge how much to trust an entry.
- **Yard users can read but never edit central data.** Editing is restricted to a platform-side administrator; it is not a yard role and does not change the two-role model in §6.
- Any yard user can **report a problem** with an entry (wrong number, closed, no longer buys this material). The report goes to administration; it never mutates the central record directly.
- **Primary journey, exactly as the owner described it:** open `نحاس` → filter to `الإسكندرية والقاهرة` → see the buyers → **call or WhatsApp in one tap** (`tel:` and `wa.me` links). Reachable both from the directory itself and from a material in the inventory screen.
- Filtering is by material, governorate, entity type and status. Sorting puts `active` before `unverified` before `outdated`.
- The directory is read-only reference data and is **cached for offline reading** like other reference data (FR-14).

#### FR-16B — Yard relationship layer (private to each yard)

The yard's own knowledge about a buyer, layered on top of the same central entity — and also usable on a buyer the
yard added itself that is not in the central directory.

- Per buyer, per yard: has dealt with them before (derived from transactions, and manually settable) · purchasing contact's name · an additional direct number · date of last contact · last price offered, with its unit and date · **the materials they actually accept in practice** (which may differ from the central list) · the minimum quantity they told *this* yard · payment method · transport arrangement · private notes · `مفضّل` / `غير مناسب`.
- Given a sale is recorded to a buyer, then the app **offers** to update the last-price-offered and last-contact fields. It never updates them silently.
- Prices and contact dates are displayed with their age (`مسجّل من ١٢ يوم`) so stale information looks stale.
- **No other yard can see any of this, ever.** It is tenant-isolated at the data layer (Part 4, Security) and included in that yard's data export.
- Layer B is owner-only, because it contains negotiated terms and prices.

#### Boundaries — restated and binding (D2, D19, §5)

**Inside scope:** listing, filtering, contact details, one-tap call/WhatsApp, the yard's own private notes.

**Outside scope, and the line that must not be crossed:** no quotes inside the app · no negotiation inside the app ·
no payment · no purchase orders · no commission · **no deal guarantee of any kind** · no buyer accounts or
buyer-facing views · no notifications to buyers · no yard-to-yard visibility · no automated matching.
If any of these appear, it has become a marketplace and requires an explicit owner decision to change D2.

**What we are not promising.** The directory is contact information, not a recommendation, not a credit check and
not an endorsement. Entries carry a verification status precisely so the product never implies more confidence
than it has. This must be stated plainly in the UI (see R18).

---

## PART 4 — NON-FUNCTIONAL REQUIREMENTS

### Security
- HTTPS/TLS only. Passwords and PINs hashed (argon2/bcrypt class), never stored or logged in plain text.
- **Authorization enforced server-side, per capability.** An operator must be unable to read cost, profit, cash totals, other users' entries or other days even by calling the API directly. This is a release-blocking test.
- Tenant isolation enforced at the data layer from day one — so the later multi-yard step (D3 defers it, it is not forbidden) needs no rewrite.
- Server-side validation of every weight, price and total; the client is never trusted for arithmetic.
- Rate limiting on all authentication endpoints. No secrets in the client bundle or the repository.

### Performance
- First meaningful paint ≤3 s on a mid-range Android over 3G; ≤1.5 s on repeat visits.
- Saving a transaction: local confirmation ≤300 ms. The user never waits on the network to continue.
- Lists remain usable at 50,000 transactions (pagination or virtualization).
- Initial JS payload target < 300 KB gzipped.

### Accessibility and ergonomics
- Touch targets ≥48×48 px — gloves and dirty hands.
- Body text ≥16 px; weights and totals ≥24 px and bold.
- Contrast ≥4.5:1 and legible in direct sunlight; no low-contrast grey on grey.
- Every action reachable one-thumbed on a 5.5" screen.
- Icons always paired with an Arabic label — never icon-only for a financial or destructive action.
- Arabic screen-reader labels on all interactive elements.
- **Desktop (D4) is a first-class layout, not a stretched phone**: keyboard-first entry, Tab order following the natural sequence, Enter to add a line, multi-column tables, printing from the browser.

### Privacy — corrected in 2.1 (D25)
The 2.0 wording promised that the privacy notice would state the data "is not shared with any government or tax
authority". **That was wrong on two counts** and has been removed: no operator can promise to defy a lawful
order, and framing secrecy as a feature edges toward marketing the product as a tool for avoiding obligations.
It is also unnecessary — the honest version is more reassuring and defensible.

- Collect only what operations need. Never location, contacts, or unrelated device data.
- National ID, if entered, is masked in lists and visible only to the owner.
- **Accurate wording, to be used verbatim in the notice and in any sales conversation:**
  - The product **does not integrate with, and does not automatically send any data to, any tax or government system.** (Factual and verifiable — there is no such integration, by design, per D17.)
  - The data is **the yard's own operational record**, stored for the yard's use.
  - The owner can **export all of it at any time, and request its deletion**.
  - Access is limited to the users the owner creates.
  - **We operate within applicable Egyptian law.** No promise is made, or implied, about how any lawful request would be handled.
- The notice is short, in plain Arabic, shown at signup, and reachable from Settings at any time.
- **What must never be claimed** — in the app, the site, or a sales conversation: that the product hides income, is invisible to authorities, helps avoid tax, or guarantees confidentiality against the state. This is a hard rule, not a preference (see R12).
- The product makes **no compliance claim** under Law 202/2020 (F8), while good internal records remain an incidental benefit the owner may use as he sees fit.

### PWA (D4, D23)
- Installable: valid manifest, Arabic name, icons, standalone display.
- Service worker caches the shell and reference data (materials, prices, favourites, recent parties) so the app opens and shows today's prices without a network.
- **Resilient-online write behaviour per FR-14** — interrupted saves are held locally and retried with an idempotency key; they are never lost. A full offline queue is deferred (S-09).
- Primary target: Chrome on Android. Secondary: desktop Chrome/Edge. Tertiary: iOS Safari — degrade gracefully within iOS PWA limits.
- App updates must never discard locally held unsent entries or drafts.

### Localization
- Arabic (Egypt) only at launch. Full RTL: forms, tables, receipts, printed output, charts.
- All strings externalized; no hard-coded Arabic in components.
- Currency EGP `ج.م`, 2 decimals, thousands separators. Weights in kg, 2 decimals; **prices per kg or per ton according to the material (F1)**; tonnes shown as a secondary hint above 1,000 kg.
- Accept both Western and Arabic-Indic numeral input; store canonically; display Western by default with an owner toggle.
- Gregorian dates, `DD/MM/YYYY`, timezone Africa/Cairo.

---

## PART 5 — EDGE CASES AND FAILURE STATES

| # | Case | Required behaviour |
|---|---|---|
| E1 | Zero or negative weight | Block, inline Arabic message. |
| E2 | Deduction ≥ gross | Block. |
| E3 | Price = 0 | Allowed with explicit confirmation (free loads exist); flagged to the owner. |
| E4 | Sale exceeds available stock | **Never blocked outright** (D29). Owner: inline adjustment on the same screen, sale posts immediately. Operator: sale saved in full as `pending_stock_resolution`, affecting nothing, blocking the daily close until the owner resolves or voids it. No negative stock is ever published. |
| E5 | The yard physically holds material the system does not know about | Owner records an opening balance (new material) or a stock adjustment with reason "physical count". Negative stock never occurs. |
| E6 | Truck leaves without tare weighing | Stays "pending tare"; blocks the daily close until resolved or voided. |
| E7 | Same party entered twice with different spellings | Phone-based duplicate detection at creation; owner-only merge tool (v1.1 — detection is MVP). |
| E8 | Device dies mid-entry | Draft auto-saved locally; restored on reopening. |
| E9 | Two devices record offline simultaneously | Both sync; server assigns final numbers; nothing lost or overwritten. |
| E10 | Wrong device clock | Both times stored; server time authoritative; warn if the gap exceeds 10 minutes. |
| E11 | Late entry after the day is closed | Dated to the next open day with a mandatory note. Closed days are immutable. |
| E12 | Large unexplained expense by an operator | Category required; above the owner's threshold a note is required and it tops the daily summary. |
| E13 | Material has no reference price | Transaction still possible with a manually entered price; the owner is prompted to set one (V3 safety valve). |
| E14 | Server unreachable | Interrupted saves are held locally and retried with an idempotency key; a pending count and a clear message that the entry is safe on the device. Extended offline recording is out of MVP scope (FR-14, S-09) and the app says so honestly rather than appearing to accept entries it cannot keep. |
| E15 | Operator's device lost or stolen | Owner deactivates the user; that session is invalidated on next server contact; history retained. |
| E16 | Reversal after the material's price changed | Uses the original transaction's values, not current prices. |
| E17 | Implausible number (100,000 kg on a kilo scale; or a per-ton price typed into a per-kg line) | Soft warning above a configurable threshold, evaluated against **the line's own unit**; requires confirmation (R13). |
| E18 | Regrade outputs do not sum to the input | Block, showing the exact remaining difference. |
| E19 | Sale of a material whose average cost is zero (e.g. opening stock entered without a cost) | Allowed; profit for that line is shown as `غير محسوب` rather than a fake 100% margin, and the material is flagged so the owner can set an opening cost. |
| E20 | Owner changes a material's **default** pricing unit after transactions exist | Allowed; historical lines keep their own unit and price. The reference price must be re-entered in the new unit, with an explicit confirmation. Existing stock and average cost are unaffected (both are stored per kg). |
| E21 | A line's unit is overridden to `طن` but the price typed is a per-kg figure (a 1000× under-price) | The plausibility check in E17 evaluates the resulting line total against the material's reference value and requires confirmation. The unit is echoed next to the price, in the line summary, and on the receipt (R13). |
| E22 | A regrade output has no reference sell price | Two paths offered on the same screen (D28): the owner enters a value inline, **or** the weight movement posts now and that output's cost stays unallocated with profit `غير محسوب` until resolved. Never invent an allocation, never block the stock movement. |
| E23 | Correcting a purchase in a closed day | Retrospective rewrite is refused; the app routes the owner to a cost adjustment dated today and explains why in one sentence (FR-10). |
| E24 | Reversing a purchase in an open day whose material has since been sold | Replay recomputes subsequent cost snapshots for that material. If the replay would make the running balance negative at any point, the reversal is blocked and the cost-adjustment route is offered instead. |
| E25 | Directory entry is stale or wrong (closed factory, dead number) | Status (`unverified` / `outdated`) and the last-verified date are always visible; any user can report the entry; the report reaches administration and never mutates the central record directly (FR-16A). |
| E26 | Reference sell prices change after a regrade was saved | Nothing changes. The regrade is read from its stored price snapshot and allocation method, never re-derived (D27). |
| E27 | A pending-stock-resolution sale is still open at the end of the day | The daily close is blocked and the sale is named. The owner resolves it or voids it with a reason; voided entries stay visible. |
| E28 | The material for a pending sale arrives (a genuine purchase) before the owner resolves it | Recording that purchase raises the balance; the pending sale then posts with no adjustment needed — the app detects that the shortfall is gone and offers to post it directly. |
| E29 | A pending sale's original day closes before it is resolved | It posts to the current open day with an automatic note naming the original date (consistent with E11); the original device timestamp is preserved. |
| E30 | An operator uses pending-stock-resolution routinely instead of exceptionally | Every instance carries its operator in the audit log and the attention list, so the pattern is visible to the owner (R19). No silent tolerance, no automatic punishment. |
| E31 | A pending sale is voided but the customer's money was already taken | Voiding requires stating what happened to the money: returned (the pending cash movement is reversed, visibly) or retained (voiding is refused; the sale must be posted properly). Money never disappears silently (D32). |
| E32 | A deferred regrade is resolved after **all** of an output has been sold | That output's entire allocated share becomes `تكلفة فرز غير منسوبة` in the current period; **nothing** is added to inventory for it; the past sales keep showing `غير محسوب` (D33). |
| E33 | A deferred regrade is resolved when more of the material is now in stock than the regrade produced (later purchases) | The split still uses the **original** output quantity and the outbound measured since the regrade, capped at that quantity. The remaining share is added to the current inventory value and averaged over the quantity actually on hand. |
| E34 | The regrade's source material was itself later corrected | The regrade keeps its snapshot; a change in the source's cost does not re-derive a past allocation (D27). Any difference is handled through the cost-adjustment route (FR-10). |
| E35 | A pending sale's day rolls over while its pending cash is still outstanding | The pending sale blocks the close, so this only occurs if the owner leaves the day open. The pending cash stays visible on the drawer's expected total for whichever day is open, and posts to the day it is resolved in (E29). |

---

## PART 6 — SUCCESS METRICS

**Primary — proves the product works:**
- **M1 Capture rate:** ≥90% of the yard's real daily transactions recorded in the app (measured against one observed day in weeks 2 and 4). *Tests V1.*
- **M2 Speed:** median single-material purchase ≤30 seconds. *Tests V2.*
- **M3 Retention:** used on ≥6 of every 7 working days for 4 consecutive weeks, unprompted.

**Secondary:**
- **M4** Average absolute daily cash difference falls below 1% of daily cash flow by week 4.
- **M5** The owner opens the daily/profit view on ≥5 days a week.
- **M6** Owner reports fewer weight and price disputes (qualitative, weekly).
- **M7** Zero lost transactions; sync success ≥99.9%.
- **M8** The owner can correctly explain, unprompted, how the profit figure was calculated. *Tests V5.*

**Anti-metric:** do not optimize for feature count or screens shipped. If the operator goes back to the notebook,
every other number is meaningless.

---

## PART 7 — PRIORITIZED BACKLOG

### MUST — the MVP does not ship without these
| ID | Item |
|---|---|
| M-01 | Auth: owner account, operator PIN accounts, server-side per-capability authorization |
| M-02 | User-defined materials with a **default pricing unit (kg/ton), overridable per transaction line** |
| M-03 | Purchase: multi-line, deduction, direct and gross/tare weighing, cash/partial/credit |
| M-04 | Sale: stock sufficiency enforced (no negative stock), cost snapshot, profit calculation |
| M-05 | Parties: unified register, running balance, payments and advances |
| M-06 | Cash box: movements, categorized expenses, daily close with counted amount |
| M-07 | Inventory: derived balances, weighted-average cost, approximate value, **stagnation indicators (no lot tracking)** |
| M-08 | Profitability: inventory cost, sales value, gross profit, per-material margin, all labelled approximate with visible arithmetic |
| M-09 | Simple regrade with **relative-sales-value** allocation, **price snapshots and stored allocation method** |
| M-10 | Reversal-only corrections, **open-day replay and closed-day cost adjustment**, full audit log |
| M-11 | Opening balances, stock adjustments, and the **safe-recovery flow for selling above balance** (D29) |
| M-12 | Buyers directory: **central curated layer (read-only to yards) + private per-yard relationship layer** |
| M-13 | The nine reports (D16) + CSV export |
| M-14 | Sequential internal receipts: WhatsApp share + print |
| M-15 | Arabic RTL UI, phone-optimized entry **and** a real desktop layout |
| M-16 | PWA install + **resilient-online** recording (no lost entry, idempotent retry) |
| M-17 | Setup under 10 minutes, optional starter materials, optional opening stock |

### SHOULD — v1.1
S-01 Party merge tool · S-02 Photo attachment on transactions · S-03 Weekly/monthly comparison views ·
S-04 Price history per material with a trend line · S-05 Physical count workflow (guided stocktake) ·
S-06 Printable price list for the yard gate · S-07 Operator "request reversal" flow with owner approval ·
S-08 Configurable receipt header and logo · **S-09 Full offline queue with batch sync — unlocked by V8 (D23)** ·
**S-10 Directory: prompt to refresh a yard's own relationship prices older than N days** ·
**S-11 Minimal internal admin tool for curating the central directory (required to operate FR-16A; see R18)**

### COULD — later, if usage justifies
C-01 Multi-branch with transfers · C-02 Purchase and sale contracts with agreed quantities ·
C-03 Advanced processing: baling, cutting, yields, processing cost (needs validation per D13) ·
C-04 Manager/Accountant third role (per V10) · C-05 Daily summary sent to the owner on WhatsApp ·
C-06 English UI · C-07 Owner-controlled backup/restore

### LATER — only after product-market fit
L-01 Multi-tenant SaaS with subscription billing · L-02 ETA e-invoicing · L-03 Accountant-facing export ·
L-04 Scale/weighbridge hardware integration · L-05 Cross-yard price benchmarking · L-06 Native apps

---

## PART 8 — RISKS AND CHEAPEST VALIDATION

| # | Risk | Impact | Cheapest validation / mitigation |
|---|---|---|---|
| R1 | **The operator refuses to use it** (V1). | Fatal | 3 days of observation with a clickable prototype before heavy build. Design the purchase screen with the actual operator. |
| R2 | **Too slow at the scale** (V2). | Fatal | Stopwatch every flow. Hard budget 30 s. Cut fields until it fits; default everything. |
| R3 | **The owner will not record honestly** — informal-economy trust barrier (V9). | Fatal | Ask plainly, early. State in writing and in the app that it is internal, has no tax or government connection, and that his data is exportable and his own. If he still hesitates, he is the wrong first customer. |
| R4 | Weak connectivity in industrial areas (V8). | High | **Changed in 2.1:** the MVP is resilient-online, not offline-first (D23). Mitigation is that no entry is ever lost. Run the V8 test during the pilot; S-09 is ready to ship if it fails. |
| R5 | The owner distrusts the profit figure (V5). | High | Show the arithmetic on screen (FR-8). Fallback: "sale price − last purchase price". |
| R6 | Wrong material taxonomy. | Low | Materials are entirely user-defined (D5); the starter list is skippable. Risk largely designed out. |
| R7 | Shared device destroys accountability. | Medium | Fast PIN switching; measure whether attribution holds in the pilot. |
| R8 | Interrupted saves lose or duplicate transactions. | High | Server-assigned numbers + client idempotency keys, retained in the MVP even though the full queue is deferred. Connection-drop-during-save tested on every release. |
| R9 | Building for one unrepresentative yard. | Medium | Interview 3 more yards for 30 minutes each before v1.1 scope is locked. |
| R10 | Scope creep toward ERP. | Medium | §5 is binding. Additions must displace a MUST. |
| R11 | Data loss on a broken phone. | High | Server is the source of truth; aggressive pending indicator; export available. |
| R12 | **Legal and reputational exposure.** Scrap handling is licensed under Law 202/2020 (F8), and a product sold into an informal market can be perceived as facilitating concealment. | Medium–High | The product makes **no** compliance claim and **no** confidentiality claim against the state (corrected privacy wording, D25). Marketing must never imply that it hides income or avoids tax. **Owner approval required before any regulatory or tax feature.** |
| R13 | Ton/kg confusion causes a 1000× pricing error — **now larger, because the unit is overridable per line (D20)**. | **High and specific** | Unit shown next to every price field, in the line summary, and on the receipt; plausibility check evaluated against the line's own unit (E17, E21); the override is visibly marked; covered by automated tests. |
| R14 | **Blocking negative stock stops real work** while a truck waits (D22). | ~~Medium–High~~ **Largely resolved in 2.2** | The safe-recovery flow (D29, FR-3) removes the block: the owner fixes it inline, the operator's sale is preserved as pending. V13 now measures how often the pending path is used, not whether work stops. |
| R15 | **Relative-sales-value regrade allocation depends on reference sell prices being maintained** (V3, V16). | Medium | Regrade shows the snapshot prices and the resulting cost per kg before saving; a missing price defers allocation rather than inventing one (D28); past regrades are immune to later price changes (D27). |
| R16 | **The buyers directory drifts toward a marketplace** through incremental "small" additions. | Medium | The hard boundaries in FR-16 are binding; crossing any of them requires an explicit owner decision to change D2. |
| R17 | **The closed-day boundary frustrates the owner** who wants last week's number fixed. | Low–Medium | One-sentence in-app explanation plus a visible `فروق تصحيح مشتريات سابقة` line so the correction is never invisible — it is relocated, not hidden. |
| R18 | **The central directory is an ongoing operational and reputational commitment, not a feature that ships once** (new in 2.2). Stale entries make the product look careless; a bad buyer contacted through our directory reflects on us; listed businesses may ask to be removed. | **Medium–High, and new** | Statuses (`active` / `unverified` / `outdated`) and last-verified dates are visible so the product never implies more confidence than it has · in-app text states plainly that this is contact information, not a recommendation or endorsement · user reports feed administration · removal on request is honoured · **the recurring cost of curating this data needs an explicit owner decision before launch** (see the note under Part 10). |
| R19 | **`pending_stock_resolution` becomes a routine bypass** rather than an exception, hollowing out stock discipline. | Medium | Every instance is attributed in the audit log and surfaced in the attention list; it blocks the daily close, so it cannot quietly accumulate. Measure the rate in the pilot (V13). |

---

## PART 9 — IMPLEMENTATION CONTRACT

> Everything an implementing agent needs. Combined with Parts 3–5, no guessing should be required.

### 9.1 Domain model (technology-agnostic)

```
Yard                 id, name, phone, address, currency=EGP, timezone=Africa/Cairo,
                     settings { numeral_display, expense_alert_threshold,
                                plausibility_max_kg, default_weighing_mode }

User                 id, yard_id, name, role ∈ {owner, operator}, phone?,
                     password_hash?, pin_hash?, is_active, created_at
                     # exactly one active owner per yard

Material             id, yard_id, type, grade?, display_name,
                     default_pricing_unit ∈ {kg, ton},   # F1, D20 — a DEFAULT, overridable per line
                     ref_buy_price, ref_sell_price,      # expressed in default_pricing_unit
                     is_active, is_favourite, sort_order
                     # unique (yard_id, type, grade)

Party                id, yard_id, name?, phone?, kind ∈ {supplier, customer, both},
                     national_id?, address?, notes?, is_active,
                     central_buyer_id?                   # link to the shared directory, if any
                     # CHECK: name IS NOT NULL OR phone IS NOT NULL
                     # unique (yard_id, phone) where phone present

# ---- FR-16A: central directory. Platform-owned, NOT tenant-scoped, read-only to yards ----
CentralBuyer         id, name, entity_type ∈ {factory, foundry, recycler,
                                              wholesaler, specialist},
                     governorates[], phone?, whatsapp?, address?,
                     min_quantity_kg?, logistics ∈ {they_collect, deliver_to_them, both, unknown},
                     status ∈ {active, unverified, outdated},
                     last_verified_at?,
                     source_internal, entered_by, verified_by?, verification_note?,
                     is_published
                     # D30: source_internal / verified_by / verification_note are ADMIN-ONLY.
                     # They are stored and auditable but never returned to a yard user.

CentralBuyerMaterial id, central_buyer_id, material_type, material_grade?
                     # free text taxonomy, mapped to a yard's own materials by type/grade name

CentralBuyerReport   id, central_buyer_id, yard_id, reported_by, reason, note?, created_at
                     # a yard user reports a problem; never mutates the central record

# ---- FR-16B: private per-yard relationship layer ----
YardBuyerRelation    id, yard_id, central_buyer_id? , party_id?,   # one of the two is required
                     contact_person?, direct_phone?, last_contact_at?,
                     last_offered_price?, last_offered_unit ∈ {kg, ton}?, last_offered_at?,
                     accepted_materials[], min_quantity_told_kg?,
                     payment_method?, transport?, notes?,
                     flag ∈ {favourite, not_suitable, none}, has_dealt_before
                     # tenant-isolated. Never visible to another yard.

Transaction          id, yard_id,
                     type ∈ {purchase, sale, payment, expense,
                             opening, adjustment, cost_adjustment, regrade},
                     number,                    # sequential per yard per type, server-assigned, immutable
                     party_id?, business_date, created_at, device_created_at, created_by,
                     weighing_mode ∈ {direct, gross_tare}?,
                     vehicle_no?, gross_kg?, tare_kg?,
                     status ∈ {pending_tare, pending_stock_resolution, posted, reversed, voided},
                     total_amount, amount_cash, balance_amount,
                     expense_category?, adjustment_reason?, corrects_transaction_id?,
                     note?, photo_ref?,
                     reverses_id?, reversed_by_id?, reversal_reason?,
                     idempotency_key            # client UUID, unique per yard

TransactionLine      id, transaction_id, material_id, direction ∈ {in, out},
                     gross_kg, deduction_type ∈ {none, percent, kg}, deduction_value,
                     net_kg,
                     unit_price,
                     price_unit ∈ {kg, ton},        # snapshot of the LINE's unit, never re-derived
                     is_unit_override,              # D20 — differs from the material default
                     line_total, is_price_override,
                     cost_snapshot_per_kg?          # sales and regrade outputs
                     # cost_snapshot_per_kg is recomputed by replay only within an open day (FR-10)

RegradeAllocation    id, transaction_id, material_id, role ∈ {source, output, loss},
                     kg,                                                   # ORIGINAL quantity
                     ref_sell_price_snapshot?, ref_price_unit_snapshot?,   # D27 — frozen at save
                     allocated_value?, allocated_cost_per_kg?,
                     is_cost_unallocated,                                  # D28 — deferred
                     sold_kg_at_resolution?, unattributed_value?, to_inventory_value?  # D33
                     # Transaction (type=regrade) also stores:
                     #   allocation_method ∈ {relative_sales_value, weight_fallback}
                     #   allocation_snapshot_at, unallocated_regrade_cost, resolved_at?
                     # A past regrade is ALWAYS read from this snapshot, never re-derived (D27).
                     # INVARIANT: Σ(unattributed_value + to_inventory_value) == consumed value.

CashMovement         id, yard_id, business_date, direction ∈ {in, out}, amount,
                     source ∈ {purchase, sale, payment, expense, opening, adjustment},
                     status ∈ {pending, posted},          # D32 — pending only for unresolved sales
                     transaction_id?, note?, created_by, created_at, posted_at?
                     # A pending movement counts toward the DRAWER total but not toward
                     # revenue, profit or party balances. On resolution the SAME record
                     # flips to posted atomically with the sale — never a new amount.

DayClose             id, yard_id, business_date, opening_amount, expected_amount,
                     counted_amount, difference, note?, closed_by, closed_at
                     # a closed business_date is immutable

StockBalance         yard_id, material_id, quantity_kg, weighted_avg_cost_per_kg,
                     total_value, last_in_date, last_out_date, updated_at
                     # D24: last_in_date / last_out_date replace oldest_lot_date.
                     # No lot tracking. quantity_kg must never be negative (D22).

AuditLog             id, yard_id, actor_id, action, entity_type, entity_id,
                     before_json?, after_json?, created_at   # append-only
```

### 9.2 Calculation rules — implement exactly

```
# 1. Weight
deduction_kg   = (deduction_type == 'percent') ? gross_kg × deduction_value / 100
               : (deduction_type == 'kg')      ? deduction_value
               : 0
net_kg         = gross_kg − deduction_kg
# gross/tare mode: gross_kg := gross_in − tare_out, then deduction applies to that

# 2. Money — unit-aware, per LINE not per material (F1, D20)
price_per_kg   = (line.price_unit == 'ton') ? unit_price / 1000 : unit_price
line_total     = round(net_kg × price_per_kg, 2)
total_amount   = Σ line_total                 # round per line, then sum. Never the reverse.
balance_amount = total_amount − amount_cash
# The line's price_unit defaults from material.default_pricing_unit and may be overridden.
# Switching the unit on a line does NOT convert the entered price — the user is quoting anew.

# 3. Perpetual weighted moving average, on every posted purchase line (F6)
new_avg_cost_per_kg = (qty_kg × avg_cost_per_kg + net_kg × price_per_kg)
                      / (qty_kg + net_kg)
# if (qty_kg + net_kg) == 0 → avg_cost_per_kg unchanged

# 4. Sale
cost_snapshot_per_kg = avg_cost_per_kg at the moment of posting   # stored on the line
gross_profit         = line_total − (net_kg × cost_snapshot_per_kg)
margin_pct           = (line_total > 0) ? gross_profit / line_total × 100 : null
# if cost_snapshot_per_kg == 0 → profit reported as "غير محسوب" (E19), never as 100%

# 5. Regrade — RELATIVE SALES VALUE allocation (D21), snapshotted (D27, D28)
consumed_value = consumed_kg × source_avg_cost_per_kg
for each output i:
    snapshot ref_sell_price_per_kg_i AND its unit AT SAVE TIME    # D27 — frozen, never re-read
    notional_i   = output_kg_i × ref_sell_price_snapshot_i
notional_total   = Σ notional_i over ALL outputs        # loss contributes nothing
    # if ANY output lacks a snapshot price → do not allocate at all; defer (rule 5b)
for each priced output i:
    value_i          = consumed_value × notional_i / notional_total
    cost_per_kg_i    = value_i / output_kg_i
    then apply rule 3 to material i using cost_per_kg_i

# D28/D33 — missing price: never invent an allocation. Two paths:
#   (a) owner enters a reference value inline  → allocate normally
#   (b) DEFER (all-or-nothing) → post the WEIGHT movement now (stock is correct immediately);
#       hold the ENTIRE consumed_value as unallocated_regrade_cost on the regrade entry;
#       flag all outputs "تكلفة غير محددة", cost_per_kg = null;
#       any sale of them reports profit as "غير محسوب" (E19);
#       NEVER allocate only among the priced outputs — that reproduces the distortion.

# 5b. Resolving a deferred allocation later (D33)
#     Uses the ORIGINAL output quantities and the STORED snapshots.
for each output i:
    value_i        = consumed_value × notional_i / notional_total     # as in rule 5
    sold_kg_i      = min(Σ outbound of material i between regrade and resolution, output_kg_i)
    remaining_kg_i = output_kg_i − sold_kg_i
    unattributed_i = value_i × sold_kg_i      / output_kg_i   # → "تكلفة فرز غير منسوبة"
    to_inventory_i = value_i × remaining_kg_i / output_kg_i   # → inventory value only
# unattributed_i is reported as a named cost line in the CURRENT period.
# It is NOT added to inventory and NOT attributed to the profit of those past sales,
# which keep showing "غير محسوب" and are NEVER rewritten (D26).
# to_inventory_i is added to material i's inventory value; then:
#     new_avg_cost_per_kg = (current_value + to_inventory_i) / current_quantity_kg
# Σ(unattributed_i + to_inventory_i) over all outputs == consumed_value  (must hold exactly)
# sold_kg_i is a ledger approximation: no lot tracking (D24), stock is fungible. Label as such.
# store: allocation_method, allocation_snapshot_at, resolved_at, and every price snapshot (D27).
# No processing cost, no yields, no labour (D13). Label all results "تكلفة وربح تقريبي".

# 6. Stock
stock_kg = Σ(direction=in net_kg) − Σ(direction=out net_kg) ± adjustments ± opening
           # posted only; reversals netted
CONSTRAINT: stock_kg must never be < 0 for any material, at any point,
            including at every step of a replay (D22). Enforced server-side.
            Sales awaiting stock resolution are NOT posted, so they cannot breach this (D29).

# 7. Cash
expected_cash = opening_amount + Σ(cash in) − Σ(cash out)
difference    = counted_amount − expected_amount

# 8. Historical purchase correction (D26, FR-10)
if business_date of the original is in an OPEN day:
    reverse + re-enter, then REPLAY that material's postings from the corrected entry forward,
    ordered deterministically by (business_date, created_at, id):
        recompute running avg_cost_per_kg by rule 3
        recompute cost_snapshot_per_kg on every subsequent sale line of that material
        abort and block the whole operation if stock_kg would go < 0 at any step (E24)
else (CLOSED day — immutable):
    no rewrite. Post a cost_adjustment dated today:
        delta_value = corrected_value − originally_recorded_value
        new_avg_cost_per_kg = (quantity_kg × avg_cost_per_kg + delta_value) / quantity_kg
                              # if quantity_kg == 0 → avg unchanged; delta goes wholly to the P&L line
        report delta_value in the current period under "فروق تصحيح مشتريات سابقة"

# 9. Stagnation indicators — computable without lot tracking (D24)
days_since_last_in  = today − last_in_date
days_since_last_out = today − last_out_date          # headline stagnation figure
avg_daily_out_kg_30 = Σ(out net_kg over trailing 30 days) / 30
days_of_cover       = (avg_daily_out_kg_30 > 0) ? quantity_kg / avg_daily_out_kg_30 : null
# NOT inventory age. Implies no FIFO and no lot-level accuracy. Label accordingly.
```

**Mandatory:** money and weights use a decimal type, never binary floating point. Money 2 dp, weights 2 dp,
`avg_cost_per_kg` carried at ≥4 dp internally and displayed at 2.

### 9.3 Screen inventory

| Screen | Purpose | Notes |
|---|---|---|
| Login | Owner: phone + password. Operator: name + PIN keypad. | Fast user switch on shared devices. |
| Today (home) | Owner: purchases, sales, cash, approximate profit, attention list. Operator: two large buttons (شراء / بيع) + today's own entries. | Role-dependent content, same route. |
| Purchase | **The most important screen.** ≤30 s, ≤6 interactions, no scrolling for a single line on a 5.5" screen. | Material = grid of large labelled buttons ordered by favourite then frequency, never a dropdown. Party = recent list first, typing is the fallback. |
| Sale | Mirror of purchase + stock availability + owner-only profit preview. | On a shortfall: owner resolves inline and posts; operator's sale is saved as `pending_stock_resolution` (D29). |
| Receipt | View, share to WhatsApp, print (A5 / 80 mm). | A pending sale can print a provisional slip only — never a numbered receipt. |
| Parties · Party detail | Search, balance with direction label, history, record payment/advance. | |
| **Buyers directory** | Browse the central directory: filter by material → governorate → entity type; status and last-verified date always visible; one-tap call / WhatsApp. | FR-16A. Read-only to yards. Reachable from the directory and from a material in inventory. |
| **Buyer detail** | Central information on top, the yard's own private relationship layer below, clearly separated. | FR-16B. Owner-only. Includes "report a problem" for the central entry. |
| Materials | Create/edit type, grade, **default pricing unit**, reference prices, favourites. | Changing today's price must be ≤3 taps. |
| Inventory | kg, average cost, approximate value, **stagnation indicators**, per material and total. | Opening balance and adjustment entry points live here. |
| Regrade | Owner-only sorting entry. | Shows the **snapshot prices it will use** and the resulting cost per kg per output **before** saving; labelled `تكلفة وربح تقريبي`. A past regrade opens read-only from its snapshot. |
| Cash box | Movements, add expense, daily close. | |
| Reports | The nine reports (D16), date-filtered, CSV export. | |
| Movement log | Searchable, filterable, paginated audit of everything. | Includes openings, adjustments, cost adjustments and regrades. |
| Users | Add/deactivate operators, reset PINs. | |
| Settings | Yard name, receipt header, thresholds, numerals, export, opening balances, privacy notice. | |

**Binding design directives:** RTL everywhere including numeric fields, tables and printed output · weight and
total are always the largest elements on screen · **the unit (`كجم` / `طن`) is displayed adjacent to every price
field, in the line summary, and on the receipt, and an overridden unit is visibly marked** (D20, R13) ·
destructive and financial confirmations use Arabic verbs (`احفظ`, `ألغِ العملية`), never "OK" · desktop is
keyboard-first with a real table layout, not a stretched phone view · every blocked action must state the reason
and the legitimate way forward, never just refuse.

### 9.4 Definition of done for the MVP

1. Every MUST item implemented and meeting its acceptance criteria in Part 3.
2. **Authorization verified by direct API calls, not only through the UI:** an operator's credentials cannot retrieve cost, profit, cash totals, other users' entries or other days.
3. **Connection-drop test passes:** kill the network mid-save on 5 transactions, force-close the app, reconnect → all 5 post exactly once, with correct sequential numbers, no duplicates, no loss. *(Extended offline recording is explicitly not in the MVP — FR-14.)*
4. **Unit test passes:** a ton-priced line and a kg-priced line for the **same material** in one transaction both compute correctly on screen and on the receipt, and the unit override is visible in both places (F1, D20, R13).
5. **Negative stock is unreachable:** attempts via sale, regrade, adjustment and replay are all rejected server-side, and a `pending_stock_resolution` sale never moves stock (D22, D29).
6. **Safe-recovery flow verified end to end (D29 — release-blocking):** an operator sells above the balance → the sale is saved complete, nothing moves, the operator continues working → the owner resolves it with one adjustment → the sale posts atomically with **no field re-entered by anyone**, stock never goes negative at any moment, and the daily close is blocked while it is pending.
7. **Regrade allocation verified** against the worked example in §4: 1,000 kg mixed at 20/kg → 100 kg copper + 900 kg iron yields ≈169.49/kg and ≈3.39/kg, not 20/kg each (D21).
8. **Regrade snapshot verified (D27):** after saving a regrade, changing the reference sell prices does **not** alter that regrade's allocation, its cost per kg, or any downstream average cost; the stored prices and method are visible when the entry is reopened.
9. **Deferred allocation verified (D28):** a regrade with one unpriced output posts the weight movement, holds the entire consumed value as unallocated, reports profit on its sales as `غير محسوب`, and never allocates partially among the priced outputs only.
10. **Deferred allocation resolution verified — exact numeric test (D33, release-blocking):**
    - Given 1,000 kg of `مخلوط` in stock at 20.00/kg (value 20,000.00), regraded into 100 kg `نحاس` (no reference sell price) and 900 kg `حديد` (snapshot reference sell price 8.00/kg), and the owner defers the allocation,
    - and 50 kg of the copper and 400 kg of the iron are subsequently sold (both reporting profit `غير محسوب`),
    - when the owner later supplies a copper reference sell price of 400.00/kg and resolves the allocation,
    - then allocation over the **original** quantities gives copper 100×400 = 40,000 and iron 900×8 = 7,200, total notional 47,200 → **copper 16,949.15 (169.4915/kg)** and **iron 3,050.85 (3.3898/kg)**;
    - and the sold shares — **copper 8,474.58** (50/100) and **iron 1,355.93** (400/900), **total 9,830.51** — are recorded as `تكلفة فرز غير منسوبة` in the current period and added to **no** inventory;
    - and only the remaining shares — **copper 8,474.58** (50 kg) and **iron 1,694.92** (500 kg), **total 10,169.49** — are added to inventory value and folded into the weighted-average cost of the quantity on hand;
    - and 9,830.51 + 10,169.49 = **20,000.00** exactly;
    - and the four earlier sales are **not** rewritten and still report `غير محسوب`.
11. **Pending cash verified — exact test (D32, release-blocking):** an operator's above-balance sale collecting 12,000 creates one pending cash movement of 12,000; revenue, profit and the party balance are unchanged; the drawer's expected total includes it while `الرصيد المتوقع من العمليات المرحّلة` does not; on resolution the **same record** flips to posted atomically with the sale, the cash box total is unchanged by the flip, and the ledger contains exactly one 12,000 movement — never two.
12. **Directory separation verified:** a yard user cannot modify central data by any route including direct API calls; one yard's relationship layer is invisible to another yard; admin-only fields (source, verifier, verification note) are never returned to a yard user (D30). An `unverified` or `outdated` entity is never displayed as if confirmed (D31).
13. **Historical correction verified both ways:** an open-day correction replays and changes subsequent sale costs; a closed-day correction refuses to rewrite and produces a `فروق تصحيح مشتريات سابقة` line dated today (D26).
14. Arabic RTL verified on a real Android device **and** on a desktop browser, including printed and shared receipts.
15. A full day operable end to end: open → purchases → sales → expenses → payment → regrade → close with a counted amount → next day opens with the correct balance.
16. Automated tests cover §9.2 in full: deduction variants, per-line unit conversion, weighted average across multiple purchases, sale cost snapshot, relative-sales-value allocation with snapshots, **deferred allocation and its sold/remaining resolution split**, replay ordering, cost adjustment, reversals, **pending stock resolution and pending cash conversion**, blocked negative stock, zero-cost sale, stagnation indicators.
17. **Privacy notice matches the corrected wording in Part 4 verbatim**, and no screen, string or marketing asset claims concealment from any authority (D25, R12). The directory carries its "contact information, not a recommendation" statement (R18).
18. Performance budgets in Part 4 measured on a real device, not assumed.
19. Setup completed by a non-technical person in under 10 minutes, unaided.
20. No secrets in the repository; all configuration via environment variables.

### 9.5 Do not build in the MVP
Everything in §5, plus: multi-branch, advanced processing, third role, hardware integration, English UI,
e-invoicing, notifications, dashboards, analytics, marketplace, **a full offline queue (S-09), and any buyer-facing
surface whatsoever (FR-16 boundaries)**.

---

## PART 10 — WHAT STILL CANNOT BE SETTLED WITHOUT A REAL YARD OWNER

Short list, as requested. Everything else in this document has been decided by research or by product judgment.
Revision 2.1 added two items (5 and 6), both created by 2.1 decisions.
These four cannot be, because they are facts about a specific business's behaviour, not design choices:

1. **Will the person at the scale actually record on a phone while a truck waits, and is 30 seconds fast enough?**
   *(V1, V2 — the single biggest risk to the whole product. One yard, three days of observation answers it.)*

2. **Will the owner record every pound honestly in a cash, largely informal trade?**
   *(V9 — if the answer is no, the data is fiction and every report is worthless. Must be asked directly.)*

3. **Does the owner believe the average-cost profit figure, and does it match how he thinks about profit?**
   *(V5 — determines whether we keep weighted-average cost or fall back to "sale price − last purchase price".)*

4. **How often does sorting actually happen, is `فرز بسيط` needed on day one, and are reference sell prices kept current enough for the value-based allocation to work?**
   *(V11 + V16 — the only feature where we went beyond the owner's brief, and its new costing model depends on prices being maintained.)*

5. **Is the yard's connectivity bad enough to need a full offline queue?**
   *(V8 — newly decisive in 2.1, because the MVP now ships resilient-online. One phone, three days, inside the actual yard.)*

6. **Does blocking a sale on insufficient stock stop real work while a truck waits?**
   *(V13 — reframed in 2.2: the block is gone, so the question is now how often the pending-resolution path is used and how fast it clears.)*

---

### Owner decision — resolved

**The central buyers directory is approved for the MVP (D31).** Both layers ship together. We own curation as an
ongoing service. Rollout order: **البحيرة → الإسكندرية → القاهرة والجيزة**, then the rest of the country
gradually. Opening materials: iron, copper, aluminium, plastic, paper/cardboard. Every entity carries a
verification status and a last-verified date, and **an unverified entity is never presented as if its data were
confirmed** — this is a display requirement, not a preference (FR-16A, DoD #12).

The recurring curation cost and the reputational exposure in R18 are accepted by the owner. The mitigations in
R18 remain binding: visible statuses, the "contact information, not a recommendation" statement, user reports,
and removal on request.

---

## APPENDIX A — Optional starter materials (fully editable, skippable)

Offered as a suggestion at setup only. The owner may accept, edit, replace or skip it entirely (D5).
Suggested pricing units follow F1.

| Group | Materials | Suggested default unit (overridable per line, D20) |
|---|---|---|
| حديد | حديد ثقيل · حديد خفيف · صاج · صفيح · براده/نشارة · زهر (صب) · استانلس | **طن** (except استانلس: كجم) |
| نحاس | نحاس أحمر · نحاس أصفر · نحاس مخلوط/كسر · كابلات نحاس | **كجم** |
| ألومنيوم | ألومنيوم نظيف · ألومنيوم مخلوط · كانز · كابلات ألومنيوم | **كجم** |
| معادن أخرى | رصاص · بطاريات · موتور/دينامو · راديتير | **كجم** |
| بلاستيك | بلاستيك أبيض (PET) · بلاستيك ملون · جراكن (HDPE) · نايلون · مطحون | **كجم** |
| ورق وأخرى | كرتون · ورق أبيض · ورق مخلوط · زجاج · إلكترونيات/بوردات · إطارات | **كجم** |

---

## APPENDIX B — Research sources

- Egyptian daily scrap price listings, Jan–Aug 2026: vetogate.com, egyptke.com, unitedmetals.com.eg (F1, F2)
- Al Borsa, field report on the scrap trade and the `سريحة` network, 2020 (F3)
- Al Bawabh News, field report from the Gisr/Sabtia scrap district (F4)
- CNN Business Arabic, on the Egyptian Ministry of Environment / SWM programme study on scrap investment (F5)
- Vendor documentation: ScrapWare, ScrapRight, Scrap Dragon, Scraplytics, WeighPay, ReSpark (F6)
- Vendor sites: Daftra, DEXEF, AccFlex, Phenix, SalesUp; Enterprise AM on Big Scrappers (F7)
- Law 202/2020 on waste management regulation, Art. 24 and 55, and its executive regulation (F8)
